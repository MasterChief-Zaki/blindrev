/**
 * `pnpm --filter @blindrev/data-forge manifest` — builds data/assets.manifest.json:
 * every file under packages/app-shell/public/ (except cesium/ and dotfiles) with path, bytes,
 * sha256 and the licence record of the nearest ASSET_LICENSE.json (same folder or an ancestor
 * below public/). New assets from any agent are picked up simply by re-running it.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { ASSETS_MANIFEST_JSON, PUBLIC_DIR } from "./config";
import { repoPath, stableJson, toPosix, writeFileEnsured } from "./paths";

export const EXCLUDED_TOP_DIRS = ["cesium"];

export interface LicenseRecord {
  license: string;
  attribution: string;
  source: string;
  notes?: string;
  deterministic?: boolean;
}

export interface AssetEntry {
  path: string; // relative to packages/app-shell/public, posix
  bytes: number;
  sha256: string;
  license: string | null;
  attribution: string | null;
  source: string | null;
  licenseFile: string | null; // which ASSET_LICENSE.json applied
  deterministic: boolean;
}

export interface AssetsManifest {
  schemaVersion: 1;
  root: string;
  excluded: string[];
  fileCount: number;
  totalBytes: number;
  files: AssetEntry[];
}

/** All asset files under public/ (posix paths relative to public/), sorted. */
export function listPublicFiles(publicRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // .gitattributes etc. are repo metadata, not assets
      const p = join(dir, e.name);
      const rel = toPosix(relative(publicRoot, p));
      if (e.isDirectory()) {
        if (!rel.includes("/") && EXCLUDED_TOP_DIRS.includes(rel)) continue;
        walk(p);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(publicRoot);
  return out.sort();
}

const licenseCache = new Map<string, LicenseRecord | null>();

function readLicense(path: string): LicenseRecord | null {
  if (licenseCache.has(path)) return licenseCache.get(path) ?? null;
  let rec: LicenseRecord | null = null;
  if (existsSync(path)) {
    try {
      rec = JSON.parse(readFileSync(path, "utf8")) as LicenseRecord;
    } catch {
      rec = null;
    }
  }
  licenseCache.set(path, rec);
  return rec;
}

/** Nearest ASSET_LICENSE.json at or above the file's folder (never above public/). */
export function findLicense(publicRoot: string, relFile: string): { file: string; record: LicenseRecord } | null {
  let dir = dirname(join(publicRoot, relFile));
  for (;;) {
    const candidate = join(dir, "ASSET_LICENSE.json");
    const rec = readLicense(candidate);
    if (rec) return { file: toPosix(relative(publicRoot, candidate)), record: rec };
    const rel = relative(publicRoot, dir);
    if (rel === "" || rel.startsWith("..")) return null;
    dir = dirname(dir);
  }
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function buildAssetsManifest(repoRoot: string): AssetsManifest {
  licenseCache.clear();
  const publicRoot = join(repoRoot, PUBLIC_DIR);
  const files: AssetEntry[] = [];
  for (const rel of listPublicFiles(publicRoot)) {
    const abs = join(publicRoot, rel);
    const buf = readFileSync(abs);
    const lic = findLicense(publicRoot, rel);
    const nonEmpty = (s: unknown) => (typeof s === "string" && s.trim() !== "" ? s : null);
    files.push({
      path: rel,
      bytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      license: nonEmpty(lic?.record.license),
      attribution: nonEmpty(lic?.record.attribution),
      source: nonEmpty(lic?.record.source),
      licenseFile: lic?.file ?? null,
      deterministic: lic?.record.deterministic === true,
    });
  }
  return {
    schemaVersion: 1,
    root: PUBLIC_DIR,
    excluded: EXCLUDED_TOP_DIRS.map((d) => `${d}/`),
    fileCount: files.length,
    totalBytes: files.reduce((s, f) => s + f.bytes, 0),
    files,
  };
}

function main(): void {
  const m = buildAssetsManifest(repoPath());
  writeFileEnsured(repoPath(ASSETS_MANIFEST_JSON), stableJson(m));
  const unlicensed = m.files.filter((f) => !f.license || !f.attribution);
  const byTop = new Map<string, { n: number; bytes: number }>();
  for (const f of m.files) {
    const top = f.path
      .split("/")
      .slice(0, f.path.startsWith("mission-data/") ? 2 : 1)
      .join("/");
    const e = byTop.get(top) ?? { n: 0, bytes: 0 };
    e.n++;
    e.bytes += f.bytes;
    byTop.set(top, e);
  }
  for (const [k, v] of [...byTop.entries()].sort())
    console.log(`  ${k.padEnd(36)} ${String(v.n).padStart(5)} files ${(v.bytes / 1e6).toFixed(2).padStart(7)} MB`);
  console.log(`manifest: ${m.fileCount} files, ${(m.totalBytes / 1e6).toFixed(2)} MB → ${ASSETS_MANIFEST_JSON}`);
  if (unlicensed.length > 0) {
    console.log(`WARNING: ${unlicensed.length} file(s) without licence/attribution (verify will fail):`);
    for (const f of unlicensed.slice(0, 20)) console.log(`  - ${f.path}`);
  }
}

if (process.argv[1] && /assets-manifest\.ts$/.test(process.argv[1])) main();
