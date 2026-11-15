/**
 * `pnpm --filter @blindrev/data-forge fetch` — build-time GIBS tile fetch (network).
 *
 * Resumable (existing non-empty files are skipped), polite (≤ 6 parallel requests, retries with
 * back-off, an explicit User-Agent), caches straight into the runtime asset folders and records
 * every failure in packages/data-forge/fetch-report.json.
 *
 * Flags: --only basemap|context   --dry-run
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BASEMAP,
  CONTEXT_LAYERS,
  FETCH_REPORT_JSON,
  GIBS_3857,
  GIBS_ACK,
  GIBS_DOCS,
  layerDates,
  layerMaxZoom,
  MISSION_DATA_REL,
  NASA_OPEN_LICENSE,
  PUBLIC_DIR,
} from "./config";
import { repoPath, stableJson, writeFileEnsured } from "./paths";
import { fillTemplate, globalTiles, type TileXYZ, tilesForBounds } from "./tiles";

const MAX_PARALLEL = 6;
const RETRIES = 3;
const USER_AGENT = "blindrev-data-forge/0.1 (build-time tile fetch)";

interface Job {
  group: string;
  url: string;
  dest: string;
}

interface Failure {
  group: string;
  url: string;
  status: number | string;
}

export interface GroupReport {
  group: string;
  requested: number;
  fetched: number;
  cached: number;
  failed: number;
  bytes: number;
  emptyTiles: number;
}

function gibsUrl(layerId: string, date: string, tms: string, ext: string, t: TileXYZ): string {
  return `${GIBS_3857}/${layerId}/default/${date}/${tms}/${t.z}/${t.y}/${t.x}.${ext}`;
}

export function basemapJobs(): Job[] {
  const root = repoPath(PUBLIC_DIR, "offline-tiles", "bluemarble");
  const tiles = [
    ...globalTiles(0, BASEMAP.globalMaxZoom),
    ...tilesForBounds(BASEMAP.regionalBounds, BASEMAP.globalMaxZoom + 1, BASEMAP.regionalMaxZoom),
  ];
  return tiles.map((t) => ({
    group: "basemap/bluemarble",
    url: gibsUrl(BASEMAP.layerId, BASEMAP.date, BASEMAP.tileMatrixSet, BASEMAP.ext, t),
    dest: join(root, fillTemplate(`{z}/{y}/{x}.${BASEMAP.ext}`, t)),
  }));
}

export function contextJobs(): Job[] {
  const jobs: Job[] = [];
  for (const layer of CONTEXT_LAYERS) {
    for (const { date } of layerDates(layer)) {
      const tiles = tilesForBounds(layer.window, layer.minZoom, layerMaxZoom(layer, date));
      const root = repoPath(PUBLIC_DIR, MISSION_DATA_REL, "context", layer.folder, date);
      for (const t of tiles) {
        jobs.push({
          group: `context/${layer.folder}/${date}`,
          url: gibsUrl(layer.layerId, date, layer.tileMatrixSet, layer.ext, t),
          dest: join(root, fillTemplate(`{z}/{y}/{x}.${layer.ext}`, t)),
        });
      }
    }
  }
  return jobs;
}

/** Deterministic licence records for the fetched folders (no timestamps). */
export function writeFetchedLicenses(): void {
  writeFileEnsured(
    repoPath(PUBLIC_DIR, "offline-tiles", "bluemarble", "ASSET_LICENSE.json"),
    stableJson({
      license: NASA_OPEN_LICENSE,
      attribution: BASEMAP.attribution,
      source: `${GIBS_3857}/${BASEMAP.layerId}/default/${BASEMAP.date}/${BASEMAP.tileMatrixSet}/{z}/{y}/{x}.${BASEMAP.ext}`,
      notes:
        `GIBS layer ${BASEMAP.layerId} (${BASEMAP.title}), date ${BASEMAP.date}, EPSG:3857. ` +
        `Global z0–${BASEMAP.globalMaxZoom}; regional z${BASEMAP.globalMaxZoom + 1}–${BASEMAP.regionalMaxZoom} over ` +
        `[${BASEMAP.regionalBounds.join(", ")}]. Fetched at build time by data-forge; GIBS terms: ${GIBS_DOCS}`,
    }),
  );
  for (const layer of CONTEXT_LAYERS) {
    const layerRoot = repoPath(PUBLIC_DIR, MISSION_DATA_REL, "context", layer.folder);
    const dates = layerDates(layer).map((d) => d.date);
    const record = (date: string | null) => ({
      license: NASA_OPEN_LICENSE,
      attribution: layer.attribution,
      source: `${GIBS_3857}/${layer.layerId}/default/${date ?? "{date}"}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.ext}`,
      notes:
        `GIBS layer ${layer.layerId} (${layer.title}), ${date ? `date ${date}` : `dates ${dates.join(", ")}`}, ` +
        `EPSG:3857 z${layer.minZoom}–${layerMaxZoom(layer, date ?? undefined)} over [${layer.window.join(", ")}] (tile-QA clean: no holes/noise). ` +
        `Real imagery, fetched at build time. ${layer.citation} GIBS terms: ${GIBS_DOCS}. ${GIBS_ACK}`,
    });
    writeFileEnsured(join(layerRoot, "ASSET_LICENSE.json"), stableJson(record(null)));
    for (const date of dates) {
      writeFileEnsured(join(layerRoot, date, "ASSET_LICENSE.json"), stableJson(record(date)));
    }
  }
}

async function fetchOne(
  job: Job,
): Promise<{ ok: true; bytes: number; cached: boolean } | { ok: false; status: number | string }> {
  if (existsSync(job.dest) && statSync(job.dest).size > 0) {
    return { ok: true, bytes: statSync(job.dest).size, cached: true };
  }
  let lastStatus: number | string = "unknown";
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(job.url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 200) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length === 0) {
          lastStatus = "empty-body";
        } else {
          writeFileEnsured(job.dest, buf);
          return { ok: true, bytes: buf.length, cached: false };
        }
      } else {
        lastStatus = res.status;
        await res.arrayBuffer().catch(() => undefined);
        if (res.status === 404 || res.status === 400) break; // not retryable
      }
    } catch (err) {
      lastStatus = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return { ok: false, status: lastStatus };
}

export async function runJobs(jobs: Job[]): Promise<{ groups: GroupReport[]; failures: Failure[] }> {
  const groups = new Map<string, GroupReport>();
  const failures: Failure[] = [];
  for (const j of jobs) {
    if (!groups.has(j.group)) {
      groups.set(j.group, { group: j.group, requested: 0, fetched: 0, cached: 0, failed: 0, bytes: 0, emptyTiles: 0 });
    }
    const g = groups.get(j.group);
    if (g) g.requested++;
  }
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (!job) break;
      const r = await fetchOne(job);
      const g = groups.get(job.group);
      if (!g) continue;
      if (r.ok) {
        g.bytes += r.bytes;
        if (r.bytes < 1024) g.emptyTiles++;
        if (r.cached) g.cached++;
        else g.fetched++;
      } else {
        g.failed++;
        failures.push({ group: job.group, url: job.url, status: r.status });
      }
      done++;
      if (done % 200 === 0) console.log(`  … ${done}/${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: MAX_PARALLEL }, worker));
  failures.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  return { groups: [...groups.values()], failures };
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

/** Delete cached tiles that are no longer in the job list (e.g. after lowering a maxZoom). */
export function pruneTiles(jobs: Job[], roots: string[]): number {
  const keep = new Set(jobs.map((j) => resolve(j.dest)));
  let removed = 0;
  for (const root of roots) {
    for (const f of listFiles(root)) {
      if (f.endsWith("ASSET_LICENSE.json")) continue;
      if (!keep.has(resolve(f))) {
        rmSync(f);
        removed++;
      }
    }
  }
  return removed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const dry = args.includes("--dry-run");
  const jobs = [
    ...(only === null || only === "basemap" ? basemapJobs() : []),
    ...(only === null || only === "context" ? contextJobs() : []),
  ];
  console.log(`data-forge fetch: ${jobs.length} tiles (≤ ${MAX_PARALLEL} parallel)`);
  if (dry) return;
  if (only === null) {
    const removed = pruneTiles(jobs, [
      repoPath(PUBLIC_DIR, "offline-tiles", "bluemarble"),
      repoPath(PUBLIC_DIR, MISSION_DATA_REL, "context"),
    ]);
    if (removed > 0) console.log(`pruned ${removed} cached tiles no longer in the job list`);
  }
  writeFetchedLicenses();
  const t0 = Date.now();
  const { groups, failures } = await runJobs(jobs);
  const report = {
    fetchedAt: new Date().toISOString(),
    durationS: Math.round((Date.now() - t0) / 100) / 10,
    userAgent: USER_AGENT,
    maxParallel: MAX_PARALLEL,
    groups,
    failures,
  };
  writeFileEnsured(repoPath(FETCH_REPORT_JSON), stableJson(report));
  for (const g of groups) {
    console.log(
      `  ${g.group.padEnd(42)} ${String(g.requested).padStart(5)} req  ${String(g.fetched).padStart(5)} new  ${String(g.cached).padStart(5)} cached  ${String(g.failed).padStart(3)} failed  ${(g.bytes / 1e6).toFixed(2)} MB  ${g.emptyTiles} empty`,
    );
  }
  console.log(`failures: ${failures.length} → ${FETCH_REPORT_JSON}`);
}

if (process.argv[1] && /fetch\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
