import type { GridSpec, LonLat } from "../contracts";
import { crossingX } from "../roi/planar";
import { LON_WINDOW_OFFSETS } from "../roi/pointInRings";

/** Throws a RangeError unless `grid` has positive integer size and finite, non-empty bounds. */
export function assertGridSpec(grid: GridSpec, what = "grid"): void {
  const { width, height, bounds } = grid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`${what}: width/height must be positive integers (got ${width}×${height})`);
  }
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every((b) => Number.isFinite(b))) {
    throw new RangeError(`${what}: bounds must be four finite numbers`);
  }
  const [west, south, east, north] = bounds;
  if (!(west < east) || !(south < north)) {
    throw new RangeError(`${what}: bounds must satisfy west < east and south < north`);
  }
}

/** Pixel-centre longitudes, exactly per the GridSpec contract: west + (col+0.5)*(east-west)/width. */
export function pixelCentreLons(grid: GridSpec): Float64Array {
  const [west, , east] = grid.bounds;
  const w = grid.width;
  const out = new Float64Array(w);
  for (let c = 0; c < w; c++) out[c] = west + ((c + 0.5) * (east - west)) / w;
  return out;
}

/** Pixel-centre latitudes, exactly per the GridSpec contract: north - (row+0.5)*(north-south)/height. */
export function pixelCentreLats(grid: GridSpec): Float64Array {
  const [, south, , north] = grid.bounds;
  const h = grid.height;
  const out = new Float64Array(h);
  for (let r = 0; r < h; r++) out[r] = north - ((r + 0.5) * (north - south)) / h;
  return out;
}

/** First index c in [0, n] with arr[c] + off >= x (arr non-decreasing). */
function lowerBound(arr: Float64Array, off: number, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((arr[mid] as number) + off >= x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Rasterise rings onto an EPSG:4326 grid by **pixel-centre containment, even-odd** (row 0 = north).
 * Returns `width*height` bytes, row-major, 1 = inside.
 *
 * Scanline implementation: for each row the crossings of every edge with the horizontal line through
 * the row's pixel centres are collected (half-open rule, canonical endpoint order — see
 * `pointInRings`, whose result it matches bit-for-bit), sorted, and each [x₂ⱼ, x₂ⱼ₊₁) span is filled
 * for pixel centres `x₂ⱼ ≤ lon < x₂ⱼ₊₁` (located by binary search on the exact centre values). Rings
 * are also matched at ±360° so unwrapped rings and grids meet. Only + − × ÷ and comparisons are used:
 * the output is bit-identical on every IEEE-754 platform, and independent of ring winding, starting
 * vertex and ring order. O(rows × edges + pixels filled).
 */
export function rasterizeRings(rings: LonLat[][], grid: GridSpec): Uint8Array {
  assertGridSpec(grid);
  const w = grid.width;
  const h = grid.height;
  const out = new Uint8Array(w * h);

  // Flatten non-horizontal edges (horizontal edges never straddle a scanline).
  const ax: number[] = [];
  const ay: number[] = [];
  const bx: number[] = [];
  const by: number[] = [];
  for (const ring of rings) {
    const n = ring.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = ring[i] as LonLat;
      const b = ring[(i + 1) % n] as LonLat;
      if (!Number.isFinite(a.lon) || !Number.isFinite(a.lat) || !Number.isFinite(b.lon) || !Number.isFinite(b.lat)) {
        throw new RangeError("rasterizeRings: ring coordinates must be finite");
      }
      if (a.lat === b.lat) continue;
      ax.push(a.lon);
      ay.push(a.lat);
      bx.push(b.lon);
      by.push(b.lat);
    }
  }
  const edgeCount = ax.length;
  if (edgeCount === 0) return out;

  const cxs = pixelCentreLons(grid);
  const cys = pixelCentreLats(grid);
  const firstCx = cxs[0] as number;
  const lastCx = cxs[w - 1] as number;
  const xs = new Float64Array(edgeCount);

  for (let r = 0; r < h; r++) {
    const cy = cys[r] as number;
    let m = 0;
    for (let e = 0; e < edgeCount; e++) {
      const y0 = ay[e] as number;
      const y1 = by[e] as number;
      if (y0 > cy !== y1 > cy) {
        xs[m++] = crossingX(ax[e] as number, y0, bx[e] as number, y1, cy);
      }
    }
    if (m < 2) continue;
    const row = xs.subarray(0, m).sort();
    const base = r * w;
    for (const off of LON_WINDOW_OFFSETS) {
      for (let j = 0; j + 1 < m; j += 2) {
        const x0 = row[j] as number;
        const x1 = row[j + 1] as number;
        if (x1 <= firstCx + off || x0 > lastCx + off) continue;
        const c0 = lowerBound(cxs, off, x0);
        const c1 = lowerBound(cxs, off, x1);
        for (let c = c0; c < c1; c++) out[base + c] ^= 1;
      }
    }
  }
  return out;
}

/** Number of non-zero bytes. */
export function countSet(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) n++;
  return n;
}
