/**
 * Grid helpers, independent rasteriser, mask/QA/evidence encoders (all deterministic).
 */
import type { Bounds, GridSpec, LonLat } from "@blindrev/core-sim";
import { pointInPolygon } from "./field";
import { encodeIndexedPng, hexToRgb, type PaletteEntry } from "./png";

export function makeGrid(bounds: Bounds, size: number): GridSpec {
  return { width: size, height: size, bounds: [...bounds] as Bounds, crs: "EPSG:4326" };
}

/** Pixel-centre lon/lat per the GridSpec contract (row 0 = north edge). */
export function centreLon(g: GridSpec, col: number): number {
  const [w, , e] = g.bounds;
  return w + ((col + 0.5) * (e - w)) / g.width;
}
export function centreLat(g: GridSpec, row: number): number {
  const [, s, , n] = g.bounds;
  return n - ((row + 0.5) * (n - s)) / g.height;
}

/**
 * Independent rasteriser: pixel-centre containment, even-odd over all rings (PNPOLY crossing test).
 * Deliberately NOT core-sim's `rasterizeRings` — the Spike B registration check diffs the two.
 */
export function rasterizePolygonsPnpoly(rings: LonLat[][], g: GridSpec): Uint8Array {
  const out = new Uint8Array(g.width * g.height);
  for (let r = 0; r < g.height; r++) {
    const lat = centreLat(g, r);
    for (let c = 0; c < g.width; c++) {
      const lon = centreLon(g, c);
      let inside = false;
      for (const ring of rings) if (pointInPolygon(lon, lat, ring)) inside = !inside;
      if (inside) out[r * g.width + c] = 1;
    }
  }
  return out;
}

export function countOnes(a: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === 1) n++;
  return n;
}

const rgba = (hex: string, a: number): PaletteEntry => ({ ...hexToRgb(hex), a });
const TRANSPARENT: PaletteEntry = { r: 0, g: 0, b: 0, a: 0 };

/** Evidence palette: 0 transparent, 1 LOW, 2 MID, 3 HIGH (flat, opaque, matte). */
export function evidencePalette(ramp: [string, string, string]): PaletteEntry[] {
  return [TRANSPARENT, rgba(ramp[0], 255), rgba(ramp[1], 255), rgba(ramp[2], 255)];
}

/** QA display: valid = transparent; invalid = Ink scrim with Pearl diagonal hatch (matte). */
export function encodeQaPng(valid: Uint8Array, g: GridSpec): Uint8Array {
  const idx = new Uint8Array(g.width * g.height);
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      const i = r * g.width + c;
      if (valid[i] === 1) continue;
      idx[i] = (c + r) % 6 === 0 ? 2 : 1;
    }
  }
  return encodeIndexedPng(g.width, g.height, idx, [TRANSPARENT, rgba("#0E1020", 140), rgba("#F3F5F7", 150)]);
}

/** Reference mask display: Amber fill at low alpha, opaque Amber 1-px outline. */
export function encodeMaskPng(mask: Uint8Array, g: GridSpec): Uint8Array {
  const idx = new Uint8Array(g.width * g.height);
  const at = (r: number, c: number) =>
    r < 0 || c < 0 || r >= g.height || c >= g.width ? 0 : (mask[r * g.width + c] as number);
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      if (at(r, c) !== 1) continue;
      const edge = at(r - 1, c) === 0 || at(r + 1, c) === 0 || at(r, c - 1) === 0 || at(r, c + 1) === 0;
      idx[r * g.width + c] = edge ? 2 : 1;
    }
  }
  return encodeIndexedPng(g.width, g.height, idx, [TRANSPARENT, rgba("#F2B441", 80), rgba("#F2B441", 255)]);
}

/** Float32 little-endian bytes (explicit endianness, independent of the host). */
export function float32LeBytes(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) dv.setFloat32(i * 4, values[i] as number, true);
  return out;
}
