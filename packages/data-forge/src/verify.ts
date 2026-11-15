/**
 * `pnpm --filter @blindrev/data-forge verify` — CI gate for data + assets (offline).
 *
 *  1. Schema validation of every data/**\/*.json (core-sim Zod contracts + data-forge schemas).
 *  2. Mission references: every URL a mission points at exists; mask .bin size + sha256 match.
 *  3. Asset manifest: sha256/bytes match, orphans both ways (on disk but unlisted / listed but missing),
 *     unreferenced mission-data files, Git LFS pointer files.
 *  4. Mandatory licence + attribution for every asset (nearest ASSET_LICENSE.json).
 *  5. Git LFS coverage: every binary asset resolves `filter: lfs` (git check-attr).
 *  6. Determinism: re-forge into a temp dir → identical sha256 for every deterministic artefact.
 *
 * Exit code 1 on any error. `--skip-reforge` skips step 6 (fast local loop only).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  type MissionManifest,
  parseCameraConfig,
  parseGameConstants,
  parseMissionManifest,
  parseQualityPresets,
  parseTleSnapshot,
} from "@blindrev/core-sim";
import { buildAssetsManifest, listPublicFiles } from "./assets-manifest";
import { ASSETS_MANIFEST_JSON, CONTEXT_LAYERS, layerDates, layerMaxZoom, MISSION_DATA_REL, PUBLIC_DIR } from "./config";
import { forge } from "./forge";
import { REPO_ROOT, toPosix } from "./paths";
import { AssetLicenseSchema, AssetsManifestSchema, BasemapPrefabSchema } from "./schemas";
import { classifyZoom } from "./tile-qa";

const BINARY_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bin",
  "f32",
  "gltf",
  "glb",
  "woff2",
  "mp3",
  "ogg",
  "wav",
  "ktx2",
  "hdr",
]);

export interface Check {
  name: string;
  errors: string[];
  warnings: string[];
  info: string[];
}

function newCheck(name: string): Check {
  return { name, errors: [], warnings: [], info: [] };
}

function listJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listJson(p));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out.sort();
}

function sha(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function isBinary(rel: string, abs: string): boolean {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  if (BINARY_EXT.has(ext)) return true;
  if (["json", "txt", "md", "css", "js", "mjs", "html", "svg", "xml", "csv"].includes(ext)) return false;
  const head = readFileSync(abs).subarray(0, 8192);
  return head.includes(0);
}

// ---------------------------------------------------------------------------

export function checkSchemas(root: string, missions: Map<string, MissionManifest>): Check {
  const c = newCheck("schema validation (data/**/*.json)");
  for (const abs of listJson(join(root, "data"))) {
    const rel = toPosix(relative(root, abs));
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(abs, "utf8"));
    } catch (e) {
      c.errors.push(`${rel}: invalid JSON (${(e as Error).message})`);
      continue;
    }
    try {
      if (rel.startsWith("data/missions/")) missions.set(rel, parseMissionManifest(json, rel));
      else if (rel === "data/prefabs/camera.json") parseCameraConfig(json, rel);
      else if (rel === "data/prefabs/quality.json") parseQualityPresets(json, rel);
      else if (rel === "data/prefabs/constants.json") parseGameConstants(json, rel);
      else if (rel === "data/prefabs/basemap.json") BasemapPrefabSchema.parse(json);
      else if (rel.startsWith("data/tle/")) parseTleSnapshot(json, rel);
      else if (rel === ASSETS_MANIFEST_JSON) AssetsManifestSchema.parse(json);
      else {
        c.errors.push(`${rel}: no schema registered for this file (add one in data-forge/src/verify.ts)`);
        continue;
      }
      c.info.push(`${rel}: OK`);
    } catch (e) {
      c.errors.push(`${rel}: ${(e as Error).message.split("\n").slice(0, 6).join(" | ")}`);
    }
  }
  return c;
}

/** Files a mission references (posix, relative to public/) + template prefixes for tiled layers. */
function missionRefs(m: MissionManifest): { files: Set<string>; prefixes: Set<string> } {
  const files = new Set<string>();
  const prefixes = new Set<string>();
  for (const s of m.steps) {
    if (s.tileUrlTemplate) files.add(s.tileUrlTemplate);
    if (s.qaMaskUrlTemplate) files.add(s.qaMaskUrlTemplate);
    if (s.evidenceMaskUrlTemplate) files.add(s.evidenceMaskUrlTemplate);
  }
  for (const mk of Object.values(m.masks)) {
    files.add(mk.binUrl);
    files.add(mk.pngUrl);
  }
  for (const l of m.contextLayers) prefixes.add(l.tileUrlTemplate.slice(0, l.tileUrlTemplate.indexOf("{")));
  return { files, prefixes };
}

export function checkMissions(root: string, missions: Map<string, MissionManifest>): Check {
  const c = newCheck("mission references (URLs exist, mask size + sha256)");
  const pub = join(root, PUBLIC_DIR);
  for (const [rel, m] of missions) {
    const { files, prefixes } = missionRefs(m);
    for (const f of files) if (!existsSync(join(pub, f))) c.errors.push(`${rel}: missing ${f}`);
    for (const p of prefixes) {
      const dir = join(pub, p);
      if (!existsSync(dir) || readdirSync(dir).filter((n) => /^\d+$/.test(n)).length === 0) {
        c.errors.push(`${rel}: context layer folder ${p} has no tiles (run fetch)`);
      }
    }
    for (const mk of Object.values(m.masks)) {
      const p = join(pub, mk.binUrl);
      if (!existsSync(p)) continue;
      const buf = readFileSync(p);
      if (buf.length !== mk.width * mk.height)
        c.errors.push(`${rel}: ${mk.maskId} .bin is ${buf.length} B, expected ${mk.width * mk.height}`);
      if (sha(buf) !== mk.sha256) c.errors.push(`${rel}: ${mk.maskId} sha256 mismatch`);
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] as number;
        if (v !== 0 && v !== 1) {
          c.errors.push(`${rel}: ${mk.maskId} has non-binary value ${v} at ${i}`);
          break;
        }
      }
    }
    const unavailable = m.steps.filter((s) => !s.isAvailable);
    for (const s of unavailable) {
      if (s.tileUrlTemplate !== "" || s.qaMaskId !== null || s.displacement !== null) {
        c.errors.push(
          `${rel}: unavailable step ${s.stepId} carries data (must be explicit "No acquisition", never interpolated)`,
        );
      }
    }
    c.info.push(
      `${rel}: ${files.size} files + ${prefixes.size} tiled layers referenced; ${unavailable.length} no-acquisition step(s)`,
    );
  }
  return c;
}

export function checkAssets(
  root: string,
  missions: Map<string, MissionManifest>,
): { manifest: Check; license: Check; lfs: Check } {
  const manifest = newCheck("asset manifest (sha256, orphans both ways, LFS pointers)");
  const license = newCheck("licence + attribution (ASSET_LICENSE.json)");
  const lfs = newCheck("Git LFS coverage (git check-attr filter)");
  const pub = join(root, PUBLIC_DIR);
  const mPath = join(root, ASSETS_MANIFEST_JSON);
  if (!existsSync(mPath)) {
    manifest.errors.push(`${ASSETS_MANIFEST_JSON} missing (run: pnpm --filter @blindrev/data-forge manifest)`);
    return { manifest, license, lfs };
  }
  const listed = AssetsManifestSchema.parse(JSON.parse(readFileSync(mPath, "utf8")));
  const listedMap = new Map(listed.files.map((f) => [f.path, f]));
  const onDisk = listPublicFiles(pub);
  const diskSet = new Set(onDisk);
  for (const f of onDisk) if (!listedMap.has(f)) manifest.errors.push(`orphan on disk (not in manifest): ${f}`);
  for (const f of listed.files)
    if (!diskSet.has(f.path)) manifest.errors.push(`orphan in manifest (file missing): ${f.path}`);
  let pointerFiles = 0;
  for (const f of listed.files) {
    const abs = join(pub, f.path);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 40).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1")) {
      pointerFiles++;
      manifest.errors.push(`${f.path}: is a Git LFS pointer, not content (run git lfs pull)`);
      continue;
    }
    if (buf.length !== f.bytes || sha(buf) !== f.sha256)
      manifest.errors.push(`${f.path}: sha256/bytes differ from manifest (re-run manifest?)`);
  }
  // current licence resolution must match what the manifest recorded
  const fresh = buildAssetsManifest(root);
  for (const f of fresh.files) {
    if (!f.license || !f.attribution)
      license.errors.push(`${f.path}: no licence/attribution (add ASSET_LICENSE.json in its folder)`);
    const l = listedMap.get(f.path);
    if (l && (l.license !== f.license || l.attribution !== f.attribution))
      manifest.errors.push(`${f.path}: licence record changed since manifest was built`);
  }
  // every ASSET_LICENSE.json must itself be well-formed
  for (const f of onDisk.filter((p) => p.endsWith("ASSET_LICENSE.json"))) {
    try {
      AssetLicenseSchema.parse(JSON.parse(readFileSync(join(pub, f), "utf8")));
    } catch (e) {
      license.errors.push(`${f}: malformed (${(e as Error).message.split("\n")[0]})`);
    }
  }
  // unreferenced mission-data (orphans relative to the missions)
  const refFiles = new Set<string>();
  const refPrefixes: string[] = [];
  for (const m of missions.values()) {
    const r = missionRefs(m);
    for (const f of r.files) refFiles.add(f);
    refPrefixes.push(...r.prefixes);
  }
  for (const f of onDisk.filter((p) => p.startsWith("mission-data/"))) {
    const base = f.split("/").pop() ?? "";
    if (base === "ASSET_LICENSE.json" || base === "index.json") continue;
    if (refFiles.has(f) || refPrefixes.some((p) => f.startsWith(p))) continue;
    if (f.endsWith(".f32") && refFiles.has(f.replace(/\.f32$/, ".png"))) continue; // probe grid, listed in evidence/index.json
    manifest.errors.push(`unreferenced mission-data file: ${f}`);
  }
  manifest.info.push(`${listed.fileCount} files listed, ${onDisk.length} on disk, ${pointerFiles} LFS pointer files`);
  license.info.push(`${fresh.files.length - license.errors.length}/${fresh.files.length} files licensed`);

  // Git LFS coverage
  const binaries = onDisk.filter((f) => isBinary(f, join(pub, f))).map((f) => `${PUBLIC_DIR}/${f}`);
  const r = spawnSync("git", ["check-attr", "filter", "--stdin"], {
    cwd: root,
    input: binaries.join("\n"),
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (r.status !== 0) {
    lfs.errors.push(
      `git check-attr failed (${(r.stderr || "").trim() || `exit ${r.status}`}) — is this a git checkout?`,
    );
  } else {
    const attrs = new Map<string, string>();
    for (const line of r.stdout.split("\n")) {
      const m = /^(.*): filter: (.*)$/.exec(line.trim());
      if (m) attrs.set(m[1] as string, m[2] as string);
    }
    let covered = 0;
    for (const b of binaries) {
      if (attrs.get(b) === "lfs") covered++;
      else lfs.errors.push(`${b}: binary asset not covered by Git LFS (filter: ${attrs.get(b) ?? "?"})`);
    }
    lfs.info.push(`${covered}/${binaries.length} binary assets resolve filter=lfs`);
  }
  return { manifest, license, lfs };
}

export function checkDeterminism(root: string): Check {
  const c = newCheck("determinism (re-forge into a temp dir → identical sha256)");
  const tmp = mkdtempSync(join(tmpdir(), "blindrev-reforge-"));
  try {
    const res = forge({ outRoot: tmp, aoiFrom: root });
    let same = 0;
    for (const f of res.files) {
      const repoFile = join(root, f.rel);
      if (!existsSync(repoFile)) {
        c.errors.push(`${f.rel}: produced by forge but missing in the repo (run forge)`);
        continue;
      }
      if (sha(readFileSync(repoFile)) !== f.sha256)
        c.errors.push(`${f.rel}: re-forged sha256 differs from the committed file`);
      else same++;
    }
    c.info.push(`${same}/${res.files.length} forge artefacts reproduced byte-identically`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return c;
}

/** Every bundled PNG context layer must be hole-/noise-free over its window at every advertised zoom. */
export function checkContextTiles(root: string): Check {
  const c = newCheck("context tile QA (no holes / noise / uniform tiles up to the advertised maxZoom)");
  for (const layer of CONTEXT_LAYERS) {
    if (layer.ext !== "png") {
      c.info.push(`${layer.folder}: ${layer.ext} tiles not decodable here — skipped`);
      continue;
    }
    for (const { date } of layerDates(layer)) {
      const tileRoot = join(root, PUBLIC_DIR, MISSION_DATA_REL, "context", layer.folder, date);
      let n = 0;
      for (let z = layer.minZoom; z <= layerMaxZoom(layer, date); z++) {
        for (const q of classifyZoom(tileRoot, layer.ext, z, layer.window, layer.qaFootprint)) {
          n++;
          if (q.verdict !== "OK") {
            c.errors.push(
              `${layer.folder}/${date}/${z}/${q.tile.y}/${q.tile.x}: ${q.verdict} (opaque ${q.opaqueOfExpected.toFixed(2)}, nr ${q.neighbourRatio.toFixed(2)})`,
            );
          }
        }
      }
      c.info.push(`${layer.folder}/${date}: ${n} tiles z${layer.minZoom}–${layerMaxZoom(layer, date)} checked`);
    }
  }
  return c;
}

export function runVerify(root: string, opts: { reforge: boolean }): Check[] {
  const missions = new Map<string, MissionManifest>();
  const checks: Check[] = [checkSchemas(root, missions), checkMissions(root, missions), checkContextTiles(root)];
  const a = checkAssets(root, missions);
  checks.push(a.manifest, a.license, a.lfs);
  if (opts.reforge) checks.push(checkDeterminism(root));
  else checks.push({ ...newCheck("determinism"), warnings: ["skipped (--skip-reforge)"] });
  return checks;
}

function main(): void {
  const reforge = !process.argv.includes("--skip-reforge");
  const t0 = performance.now();
  const checks = runVerify(REPO_ROOT, { reforge });
  let errors = 0;
  for (const c of checks) {
    const status = c.errors.length > 0 ? "FAIL" : c.warnings.length > 0 ? "WARN" : "PASS";
    console.log(`[${status}] ${c.name}`);
    for (const i of c.info) console.log(`        ${i}`);
    for (const w of c.warnings) console.log(`   warn ${w}`);
    for (const e of c.errors.slice(0, 40)) console.log(`  error ${e}`);
    if (c.errors.length > 40) console.log(`  … ${c.errors.length - 40} more errors`);
    errors += c.errors.length;
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(errors === 0 ? `verify: PASS (${secs} s)` : `verify: FAIL — ${errors} error(s) (${secs} s)`);
  if (statSync(REPO_ROOT).isDirectory() && errors > 0) process.exit(1);
}

if (process.argv[1] && /verify\.ts$/.test(process.argv[1])) main();
