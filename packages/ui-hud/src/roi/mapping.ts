// Pure, deterministic lon/lat ↔ editor mapping for RoiEditor2D (ARCHITECTURE §6: linear over `bounds`).
import type { Bounds, LonLat } from "../coreTypes";

export interface EditorSize {
  width: number;
  height: number;
}
export interface EditorPoint {
  x: number;
  y: number;
}

/** Editor canvas size for `bounds`: fixed width, height chosen so one km reads the same both ways
 *  (aspect corrected by cos(mid-latitude)). Mapping inside the canvas stays linear in lon/lat. */
export function editorSizeForBounds(bounds: Bounds, width = 1000): EditorSize {
  const [west, south, east, north] = bounds;
  const dLon = east - west;
  const dLat = north - south;
  if (!(dLon > 0) || !(dLat > 0)) return { width, height: width };
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const k = Math.max(0.05, Math.cos(midLat));
  const height = (width * dLat) / (dLon * k);
  return { width, height };
}

/** lon → x linear west→east over [0,width]; lat → y linear north→south over [0,height]. */
export function lonLatToEditor(p: LonLat, bounds: Bounds, size: EditorSize): EditorPoint {
  const [west, south, east, north] = bounds;
  return {
    x: ((p.lon - west) / (east - west)) * size.width,
    y: ((north - p.lat) / (north - south)) * size.height,
  };
}

/** Exact inverse of {@link lonLatToEditor}. */
export function editorToLonLat(pt: EditorPoint, bounds: Bounds, size: EditorSize): LonLat {
  const [west, south, east, north] = bounds;
  return {
    lon: west + (pt.x / size.width) * (east - west),
    lat: north - (pt.y / size.height) * (north - south),
  };
}

/** Clamp a lon/lat into `bounds`. */
export function clampToBounds(p: LonLat, bounds: Bounds): LonLat {
  const [west, south, east, north] = bounds;
  return { lon: Math.min(east, Math.max(west, p.lon)), lat: Math.min(north, Math.max(south, p.lat)) };
}

/** Round to `dp` decimal places (display + deterministic vertex placement). */
export function roundDeg(v: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** "Nice" graticule step in degrees giving roughly `target` lines across `span`. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const nice = n < 1.5 ? 1 : n < 2.25 ? 2 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10;
  return nice * mag;
}

/** Graticule line positions (degrees) strictly inside [min,max]. */
export function graticuleLines(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  if (!(step > 0) || !(max > min)) return out;
  const first = Math.ceil(min / step - 1e-9) * step;
  for (let v = first; v < max - 1e-9; v += step) {
    if (v > min + 1e-9) out.push(roundDeg(v, 9));
    if (out.length > 64) break;
  }
  return out;
}

/** Signed decimal-degree label in Plex Mono style: 36.25°N / 119.80°W. */
export function formatLat(lat: number, dp = 4): string {
  return `${Math.abs(lat).toFixed(dp)}°${lat >= 0 ? "N" : "S"}`;
}
export function formatLon(lon: number, dp = 4): string {
  return `${Math.abs(lon).toFixed(dp)}°${lon >= 0 ? "E" : "W"}`;
}
