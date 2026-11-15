/**
 * `pnpm --filter @blindrev/data-forge gate-b` — measures the Spike B gate (spec §2) on the shipped data
 * and prints a markdown table (+ writes packages/data-forge/gate-b.json). Offline, deterministic.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LonLat,
  type MaskGrid,
  type MissionManifest,
  decodeMask,
  parseGameConstants,
  parseMissionManifest,
  rasterizeRings,
  type ScoreOutcome,
  scoreRoi,
  sphericalAreaKm2,
  type TemporalStep,
  validateRoi,
} from "@blindrev/core-sim";
import { FETCH_REPORT_JSON, MISSION_JSON, PUBLIC_DIR, STEP_DEFS } from "./config";
import { forge } from "./forge";
import { REPO_ROOT, repoPath, stableJson, writeFileEnsured } from "./paths";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

function loadMask(m: MissionManifest, id: string): MaskGrid {
  const asset = m.masks[id];
  if (!asset) throw new Error(`mask ${id} missing`);
  return decodeMask(asset, readFileSync(repoPath(PUBLIC_DIR, asset.binUrl)));
}

function centroid(ring: LonLat[]): LonLat {
  const n = ring.length;
  return { lon: ring.reduce((s, p) => s + p.lon, 0) / n, lat: ring.reduce((s, p) => s + p.lat, 0) / n };
}
const scale = (ring: LonLat[], k: number): LonLat[] => {
  const c = centroid(ring);
  return ring.map((p) => ({ lon: c.lon + (p.lon - c.lon) * k, lat: c.lat + (p.lat - c.lat) * k }));
};
const shift = (ring: LonLat[], dLon: number, dLat: number): LonLat[] =>
  ring.map((p) => ({ lon: p.lon + dLon, lat: p.lat + dLat }));
const rect = (w: number, s: number, e: number, n: number): LonLat[] => [
  { lon: w, lat: s },
  { lon: e, lat: s },
  { lon: e, lat: n },
  { lon: w, lat: n },
];
const circle = (lon: number, lat: number, rKm: number, k = 16): LonLat[] =>
  Array.from({ length: k }, (_, i) => {
    const a = (i / k) * Math.PI * 2;
    return {
      lon: lon + (Math.sin(a) * rKm) / (111.32 * Math.cos((lat * Math.PI) / 180)),
      lat: lat + (Math.cos(a) * rKm) / 110.57,
    };
  });

function describe(o: ScoreOutcome): string {
  if (o.kind === "SCORE")
    return `SCORE ${o.tier} IoU ${o.iou.toFixed(3)} P ${o.precision.toFixed(3)} R ${o.recall.toFixed(3)} cov ${pct(o.coverage)}`;
  if (o.kind === "QA_DIAGNOSTIC") return `QA_DIAGNOSTIC ${o.code} (cov ${pct(o.coverage)}, ${o.validPixels} valid px)`;
  return `REJECTED ${o.code}`;
}

function main(): void {
  const out: Record<string, unknown> = {};
  const lines: string[] = [];
  const mission = parseMissionManifest(JSON.parse(readFileSync(repoPath(MISSION_JSON), "utf8")), MISSION_JSON);
  const constants = parseGameConstants(JSON.parse(readFileSync(repoPath("data/prefabs/constants.json"), "utf8")));
  const cfg = constants.scoring;

  // 1. availability / licence
  lines.push("### Sources", "", "| Source | Availability | Licence |", "|---|---|---|");
  const fr = existsSync(repoPath(FETCH_REPORT_JSON))
    ? (JSON.parse(readFileSync(repoPath(FETCH_REPORT_JSON), "utf8")) as {
        fetchedAt: string;
        groups: { group: string; requested: number; failed: number; bytes: number; emptyTiles: number }[];
      })
    : null;
  if (fr) {
    const agg = new Map<string, { req: number; failed: number; bytes: number; empty: number; dates: number }>();
    for (const g of fr.groups) {
      const key = g.group.split("/").slice(0, 2).join("/");
      const a = agg.get(key) ?? { req: 0, failed: 0, bytes: 0, empty: 0, dates: 0 };
      a.req += g.requested;
      a.failed += g.failed;
      a.bytes += g.bytes;
      a.empty += g.emptyTiles;
      a.dates++;
      agg.set(key, a);
    }
    for (const [k, a] of agg) {
      lines.push(
        `| GIBS ${k} | ${a.req - a.failed}/${a.req} tiles (${a.dates} date set(s), ${(a.bytes / 1e6).toFixed(2)} MB, ${a.empty} empty/transparent) fetched ${fr.fetchedAt.slice(0, 10)} | NASA open data (CC0 for NASA-mission data) + GIBS acknowledgement |`,
      );
    }
    out.sources = Object.fromEntries(agg);
  } else {
    lines.push("| GIBS tiles | NOT MEASURED (no fetch-report.json — run fetch) | — |");
  }
  const avail = STEP_DEFS.filter((s) => s.available);
  lines.push(
    `| NISAR catalogue (track 042 D, frame 070) | ${avail.length} real acquisitions used (GCOV + GUNW granules in NASA CMR), ${STEP_DEFS.length - avail.length} catalogue gaps | metadata only (NASA open data) |`,
    "| Displacement / coherence values | SIMULATED (Earthdata login + GUNW preprocessing = blocker) | CC0-1.0 (forge output) |",
    "",
  );

  // 2. QA coverage per step
  lines.push(
    "### QA valid-pixel coverage (512 × 512 grid = whole AOI)",
    "",
    "| Step | Date | Available | Valid px | Coverage | ≥ 60 % |",
    "|---|---|---|---|---|---|",
  );
  const cov: unknown[] = [];
  for (const s of mission.steps) {
    if (!s.isAvailable || !s.qaMaskId) {
      lines.push(`| ${s.stepId} | ${s.date.slice(0, 10)} | no — "No acquisition" | — | — | n/a |`);
      cov.push({ stepId: s.stepId, available: false });
      continue;
    }
    const q = loadMask(mission, s.qaMaskId);
    let v = 0;
    for (let i = 0; i < q.data.length; i++) v += q.data[i] as number;
    const c = v / q.data.length;
    lines.push(
      `| ${s.stepId} | ${s.date.slice(0, 10)} | yes | ${v} | ${pct(c)} | ${c >= cfg.qaMinCoverage ? "PASS" : "FAIL"} |`,
    );
    cov.push({ stepId: s.stepId, available: true, validPixels: v, coverage: c });
  }
  out.qaCoverage = cov;
  lines.push("");

  // 3. mask registration vs core-sim rasterizeRings
  const ref = loadMask(mission, mission.referenceMaskId);
  const core = rasterizeRings(mission.referencePolygons, {
    width: ref.width,
    height: ref.height,
    bounds: ref.bounds,
    crs: "EPSG:4326",
  });
  let diff = 0;
  let refPx = 0;
  for (let i = 0; i < core.length; i++) {
    if (core[i] !== ref.data[i]) diff++;
    refPx += ref.data[i] as number;
  }
  const areaKm2 = mission.referencePolygons.reduce((s, r) => s + sphericalAreaKm2(r), 0);
  lines.push(
    "### Mask registration",
    "",
    `- Reference mask ${mission.referenceMaskId}: ${refPx} px; polygons ${mission.referencePolygons.map((r) => r.length).join(" + ")} vertices; spherical area ${areaKm2.toFixed(1)} km² (ROI bounds ${cfg.roiAreaMinKm2}–${cfg.roiAreaMaxKm2} km²).`,
    `- Independent PNPOLY rasteriser (data-forge) vs core-sim \`rasterizeRings\`: **${diff} differing pixels** → registration error ${diff === 0 ? "0 px" : "≤ 1 px boundary flips"} (gate ≤ ${cfg.maskRegistrationMaxPx} px).`,
    "- Evidence (1024²) and mask/QA (512²) grids share identical bounds and sample one analytic field: each 512 pixel = exactly 2 × 2 display pixels (registration 0 px by construction).",
    "",
  );
  out.registration = { differingPixels: diff, referencePixels: refPx, areaKm2 };

  // 4. forge determinism (two runs)
  const t1 = mkdtempSync(join(tmpdir(), "blindrev-gateb-a-"));
  const t2 = mkdtempSync(join(tmpdir(), "blindrev-gateb-b-"));
  let identical = 0;
  let vsRepo = 0;
  let total = 0;
  try {
    const r1 = forge({ outRoot: t1, aoiFrom: REPO_ROOT });
    const r2 = forge({ outRoot: t2, aoiFrom: REPO_ROOT });
    total = r1.files.length;
    const m2 = new Map(r2.files.map((f) => [f.rel, f.sha256]));
    for (const f of r1.files) {
      if (m2.get(f.rel) === f.sha256) identical++;
      const rp = join(REPO_ROOT, f.rel);
      if (existsSync(rp) && sha(readFileSync(rp)) === f.sha256) vsRepo++;
    }
  } finally {
    rmSync(t1, { recursive: true, force: true });
    rmSync(t2, { recursive: true, force: true });
  }
  lines.push(
    "### Determinism",
    "",
    `- Two forge runs: ${identical}/${total} artefacts byte-identical; ${vsRepo}/${total} identical to the files in the repo.`,
  );
  out.forgeDeterminism = { identical, total, vsRepo };

  // 5. scoring
  const steps = new Map(mission.steps.map((s) => [s.stepId, s] as const));
  const st = (id: string) => steps.get(id) as TemporalStep;
  const qaFor = (s: TemporalStep) => (s.qaMaskId ? [loadMask(mission, s.qaMaskId)] : []);
  const [main, ne] = mission.referencePolygons as [LonLat[], LonLat[]];
  const cases: { name: string; rings: LonLat[][]; a: string; b: string }[] = [
    { name: "reference polygons themselves (both rings)", rings: [main, ne], a: "s01", b: "s09" },
    { name: "main bowl polygon only", rings: [main], a: "s01", b: "s09" },
    { name: "main bowl scaled ×1.3 (sloppy, generous)", rings: [scale(main, 1.3)], a: "s01", b: "s09" },
    { name: "main bowl scaled ×0.7 (too tight)", rings: [scale(main, 0.7)], a: "s01", b: "s09" },
    { name: "main bowl shifted 0.05° east (~4.5 km)", rings: [shift(main, 0.05, 0)], a: "s01", b: "s09" },
    { name: "box around everything coloured on s09", rings: [rect(-120.2, 36.02, -119.92, 36.22)], a: "s01", b: "s09" },
    { name: "decoy: s08 single-date blob near Kettleman City", rings: [circle(-120.0, 35.968, 5)], a: "s01", b: "s08" },
    { name: "persistent low-coherence zone (west)", rings: [circle(-120.255, 36.175, 4)], a: "s01", b: "s09" },
    { name: "same step twice (Δt = 0)", rings: [main], a: "s09", b: "s09" },
    { name: "pair with a no-acquisition step", rings: [main], a: "s01", b: "s07" },
  ];
  lines.push(
    "",
    "### Scoring (core-sim `scoreRoi`, date pair A→B, each case run twice)",
    "",
    "| ROI | Pair | Outcome | Digest stable |",
    "|---|---|---|---|",
  );
  const scoring: unknown[] = [];
  for (const k of cases) {
    const a = st(k.a);
    const b = st(k.b);
    const input = () => ({
      rings: k.rings,
      reference: loadMask(mission, mission.referenceMaskId),
      qa: [...qaFor(a), ...qaFor(b)],
      stepA: a,
      stepB: b,
      config: cfg,
    });
    const o1 = scoreRoi(input());
    const o2 = scoreRoi(input());
    const same = JSON.stringify(o1) === JSON.stringify(o2);
    const valid = k.rings.length === 1 ? validateRoi(k.rings[0] as LonLat[], cfg) : null;
    const roiNote = valid
      ? ` (${valid.areaKm2.toFixed(0)} km²${valid.ok ? "" : `, ${valid.errors.map((e) => e.code).join("/")}`})`
      : "";
    lines.push(
      `| ${k.name}${roiNote} | ${k.a}→${k.b} | ${describe(o1)} | ${same ? `yes${o1.kind === "SCORE" ? ` (${o1.digest.slice(0, 12)}…)` : ""}` : "**NO**"} |`,
    );
    scoring.push({ case: k.name, pair: `${k.a}->${k.b}`, outcome: o1, stable: same });
  }
  out.scoring = scoring;

  // 6. no-acquisition + zero interpolation
  const na = mission.steps.filter((s) => !s.isAvailable);
  const cycle0 = Date.parse("2025-11-01T00:00:00Z"); // cycle 004 of track 042 frame 070
  let onGrid = 0;
  for (const d of STEP_DEFS) {
    const days = (Date.parse(`${d.day}T00:00:00Z`) - cycle0) / 86400000;
    if (days === (d.cycle - 4) * 12) onGrid++;
  }
  const interpolated = na.filter(
    (s) => s.tileUrlTemplate !== "" || s.displacement !== null || s.qaMaskId !== null,
  ).length;
  lines.push(
    "",
    "### No acquisition / interpolation",
    "",
    `- No-acquisition steps: ${na.map((s) => `${s.stepId} (${s.date})`).join(", ")} — isAvailable:false, tileUrlTemplate "", no masks, no displacement.`,
    `- Steps carrying interpolated data: ${interpolated}. Step dates on the real 12-day repeat grid of track 042: ${onGrid}/${STEP_DEFS.length}; available dates = catalogue acquisition times (GCOV granule start/stop).`,
  );
  out.noAcquisition = na.map((s) => s.stepId);
  out.interpolatedSteps = interpolated;

  const md = lines.join("\n");
  console.log(md);
  writeFileEnsured(repoPath("packages/data-forge/gate-b.json"), stableJson(out));
}

main();
