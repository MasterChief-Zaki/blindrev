/**
 * Tile quality control for fetched GIBS PNG tiles + mosaic rendering for visual checks.
 *
 * A tile is BAD when, over the part of it that should hold data (pixel centres inside the expected
 * footprint, inset), it is mostly transparent (a hole), near-uniform, or noise-like (high variance but
 * no spatial correlation: neighbour difference ≈ white noise). Outside the footprint transparency is fine.
 *
 *   tsx src/tile-qa.ts mosaic <tileRoot> <z> <out.png>      composite the window at zoom z
 *   tsx src/tile-qa.ts report <tileRoot> <zMin> <zMax>       classify every tile
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bounds, LonLat } from "@blindrev/core-sim";
import { PNG } from "pngjs";
import { CONTEXT_BOUNDS, FRAME_POLYGON } from "./config";
import { pointInPolygon } from "./field";
import { type TileXYZ, tilesForBounds } from "./tiles";

export type TileVerdict = "OK" | "MISSING" | "HOLE" | "UNIFORM" | "NOISE" | "UNDECODABLE";

export interface TileQa {
  tile: TileXYZ;
  bytes: number;
  verdict: TileVerdict;
  expectedPx: number;
  opaqueOfExpected: number;
  lumStd: number;
  neighbourRatio: number;
}

/** Mercator pixel-centre latitude for row r of a tile (256 px). */
function pixelLat(t: TileXYZ, row: number): number {
  const n = 2 ** t.z;
  const yy = t.y + (row + 0.5) / 256;
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
}
function pixelLon(t: TileXYZ, col: number): number {
  const n = 2 ** t.z;
  return ((t.x + (col + 0.5) / 256) / n) * 360 - 180;
}

/** Inside the footprint with an inset (GIBS valid-data masks are known to be slightly misaligned). */
function expectedData(lon: number, lat: number, footprint: LonLat[] | null, insetDeg: number): boolean {
  if (!footprint) return true;
  return (
    pointInPolygon(lon, lat, footprint) &&
    pointInPolygon(lon + insetDeg, lat, footprint) &&
    pointInPolygon(lon - insetDeg, lat, footprint) &&
    pointInPolygon(lon, lat + insetDeg, footprint) &&
    pointInPolygon(lon, lat - insetDeg, footprint)
  );
}

export function classifyTile(
  path: string,
  t: TileXYZ,
  window: Bounds,
  footprint: LonLat[] | null,
  insetDeg = 0.03,
): TileQa {
  const base: TileQa = {
    tile: t,
    bytes: 0,
    verdict: "MISSING",
    expectedPx: 0,
    opaqueOfExpected: 0,
    lumStd: 0,
    neighbourRatio: 0,
  };
  if (!existsSync(path)) return base;
  const buf = readFileSync(path);
  base.bytes = buf.length;
  let png: PNG;
  try {
    png = PNG.sync.read(buf);
  } catch {
    return { ...base, verdict: "UNDECODABLE" };
  }
  const W = png.width;
  const H = png.height;
  const lum = new Float64Array(W * H);
  const opaque = new Uint8Array(W * H);
  let expected = 0;
  let expOpaque = 0;
  const [w, s, e, n] = window;
  for (let r = 0; r < H; r++) {
    const lat = pixelLat(t, (r * 256) / H);
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      const o = i * 4;
      const a = png.data[o + 3] as number;
      opaque[i] = a > 200 ? 1 : 0;
      lum[i] =
        0.299 * (png.data[o] as number) + 0.587 * (png.data[o + 1] as number) + 0.114 * (png.data[o + 2] as number);
      const lon = pixelLon(t, (c * 256) / W);
      if (lon >= w && lon <= e && lat >= s && lat <= n && expectedData(lon, lat, footprint, insetDeg)) {
        expected++;
        if (opaque[i]) expOpaque++;
      }
    }
  }
  // texture statistics over opaque pixels
  let sum = 0;
  let sum2 = 0;
  let cnt = 0;
  let diff = 0;
  let dcnt = 0;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (!opaque[i]) continue;
      const v = lum[i] as number;
      sum += v;
      sum2 += v * v;
      cnt++;
      if (c + 1 < W && opaque[i + 1]) {
        diff += Math.abs(v - (lum[i + 1] as number));
        dcnt++;
      }
    }
  }
  const mean = cnt ? sum / cnt : 0;
  const std = cnt ? Math.sqrt(Math.max(0, sum2 / cnt - mean * mean)) : 0;
  const nr = dcnt && std > 0 ? diff / dcnt / std : 0;
  const q: TileQa = {
    ...base,
    verdict: "OK",
    expectedPx: expected,
    opaqueOfExpected: expected ? expOpaque / expected : 1,
    lumStd: std,
    neighbourRatio: nr,
  };
  if (expected > 0 && q.opaqueOfExpected < 0.97) q.verdict = "HOLE";
  else if (cnt > 256 && nr > 0.9)
    q.verdict = "NOISE"; // white noise: E|ΔL| ≈ 1.13 σ; imagery ≪ 1
  else if (cnt > 256 && std < 2) q.verdict = "UNIFORM";
  return q;
}

export function classifyZoom(
  root: string,
  ext: string,
  z: number,
  window: Bounds,
  footprint: LonLat[] | null,
): TileQa[] {
  return tilesForBounds(window, z, z).map((t) =>
    classifyTile(join(root, String(t.z), String(t.y), `${t.x}.${ext}`), t, window, footprint),
  );
}

/** Highest zoom in [zMin, zMax] whose every window tile is OK (and all lower zooms too); -1 if none. */
export function cleanMaxZoom(
  root: string,
  ext: string,
  zMin: number,
  zMax: number,
  window: Bounds,
  footprint: LonLat[] | null,
): { maxZoom: number; perZoom: Record<number, TileQa[]> } {
  const perZoom: Record<number, TileQa[]> = {};
  let maxZoom = -1;
  for (let z = zMin; z <= zMax; z++) {
    const qa = classifyZoom(root, ext, z, window, footprint);
    perZoom[z] = qa;
    if (qa.every((q) => q.verdict === "OK")) maxZoom = z;
    else break;
  }
  return { maxZoom, perZoom };
}

/** Composite the window's tiles at zoom z over a neutral grey into one opaque PNG. */
export function mosaic(root: string, ext: string, z: number, window: Bounds, out: string): void {
  const tiles = tilesForBounds(window, z, z);
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const W = (Math.max(...xs) - x0 + 1) * 256;
  const H = (Math.max(...ys) - y0 + 1) * 256;
  const img = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = 128;
    img.data[i * 4 + 1] = 0;
    img.data[i * 4 + 2] = 128; // magenta-ish = missing, so holes are obvious
    img.data[i * 4 + 3] = 255;
  }
  for (const t of tiles) {
    const p = join(root, String(t.z), String(t.y), `${t.x}.${ext}`);
    if (!existsSync(p)) continue;
    const png = PNG.sync.read(readFileSync(p));
    for (let r = 0; r < 256; r++) {
      for (let c = 0; c < 256; c++) {
        const so = (Math.floor((r * png.height) / 256) * png.width + Math.floor((c * png.width) / 256)) * 4;
        const a = (png.data[so + 3] as number) / 255;
        const o = (((t.y - y0) * 256 + r) * W + (t.x - x0) * 256 + c) * 4;
        // transparent → mid grey (expected outside the swath)
        for (let k = 0; k < 3; k++) img.data[o + k] = Math.round((png.data[so + k] as number) * a + 90 * (1 - a));
      }
    }
  }
  writeFileSync(out, PNG.sync.write(img));
}

function main(): void {
  const [cmd, root, a, b, c] = process.argv.slice(2);
  if (!cmd || !root)
    throw new Error("usage: tile-qa.ts mosaic <root> <z> <out.png> | report <root> <zMin> <zMax> [--no-footprint]");
  const ext = process.argv.includes("--ext") ? (process.argv[process.argv.indexOf("--ext") + 1] as string) : "png";
  const fp = process.argv.includes("--no-footprint") ? null : FRAME_POLYGON;
  if (cmd === "mosaic") {
    mosaic(root, ext, Number(a), CONTEXT_BOUNDS, b as string);
    console.log(`mosaic z${a} → ${b}`);
  } else {
    for (let z = Number(a); z <= Number(b); z++) {
      const qa = classifyZoom(root, ext, z, CONTEXT_BOUNDS, fp);
      const bad = qa.filter((q) => q.verdict !== "OK");
      console.log(
        `z${z}: ${qa.length} tiles, ${bad.length} bad ${bad.map((q) => `${q.tile.y}/${q.tile.x}:${q.verdict}(${q.opaqueOfExpected.toFixed(2)},nr ${q.neighbourRatio.toFixed(2)})`).join(" ")}`,
      );
    }
    void c;
  }
}

if (process.argv[1] && /tile-qa\.ts$/.test(process.argv[1])) main();
