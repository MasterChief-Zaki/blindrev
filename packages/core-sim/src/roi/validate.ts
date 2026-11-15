import type { LonLat, ScoringConfig } from "../contracts";
import { sphericalAreaKm2 } from "./area";
import {
  FULL_TURN_NANO_CONST as FULL,
  HALF_TURN_NANO_CONST as HALF,
  type IPoint,
  adjacentEdgesOverlap,
  clampLat899,
  fromNano,
  orientSign,
  segmentsIntersect,
  toNano,
  wrapDeltaNano,
  wrapLon180,
} from "./planar";
import type { RoiError, RoiErrorCode, RoiValidation } from "./types";

/** Player-facing messages — short, plain, warm (brand voice). */
export const ROI_MESSAGES = {
  offMap: "Some corners aren't on the map. Place them again.",
  tooFew: "Add at least three different corners to close a region.",
  collinear: "All the corners sit on one line, so the region has no area. Spread them out.",
  poleLoop: "This region loops around the pole. Draw it on one side of the pole instead.",
  wrapsGlobe: "This region wraps all the way around the globe. Keep it smaller.",
  selfIntersection: "The outline crosses itself. Move a corner so the edges don't cross.",
} as const;

function fmtKm2(a: number): string {
  if (a < 10) return a.toFixed(2);
  if (a < 100) return a.toFixed(1);
  return Math.round(a).toString();
}

export function areaTooSmallMessage(areaKm2: number, minKm2: number): string {
  return `This region is about ${fmtKm2(areaKm2)} km². Make it at least ${minKm2} km² so the change has room to show.`;
}

export function areaTooLargeMessage(areaKm2: number, maxKm2: number): string {
  return `This region is about ${fmtKm2(areaKm2)} km². Keep it under ${maxKm2} km² so the search stays focused.`;
}

const samePoint = (a: IPoint, b: IPoint): boolean => a.x === b.x && a.y === b.y;

/** Sutherland–Hodgman clip of a ring against the vertical line x = X (integer nanodegrees). */
function clipAtX(poly: ReadonlyArray<IPoint>, X: number, keepWest: boolean): IPoint[] {
  const inside = (p: IPoint): boolean => (keepWest ? p.x <= X : p.x >= X);
  const cut = (p: IPoint, q: IPoint): IPoint => {
    // Canonical endpoint order (lower x first) → identical cut point for both halves / windings.
    const [a, b] = p.x < q.x || (p.x === q.x && p.y <= q.y) ? [p, q] : [q, p];
    const y = a.y + ((X - a.x) * (b.y - a.y)) / (b.x - a.x);
    const yr = Math.round(y);
    return { x: X, y: yr === 0 ? 0 : yr };
  };
  const out: IPoint[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i] as IPoint;
    const prev = poly[(i + n - 1) % n] as IPoint;
    if (inside(cur)) {
      if (!inside(prev)) out.push(cut(prev, cur));
      out.push(cur);
    } else if (inside(prev)) {
      out.push(cut(prev, cur));
    }
  }
  return dedupeRing(out);
}

function dedupeRing(pts: ReadonlyArray<IPoint>): IPoint[] {
  const out: IPoint[] = [];
  for (const p of pts) if (out.length === 0 || !samePoint(out[out.length - 1] as IPoint, p)) out.push(p);
  while (out.length > 1 && samePoint(out[0] as IPoint, out[out.length - 1] as IPoint)) out.pop();
  return out;
}

function toLonLatRing(pts: ReadonlyArray<IPoint>, shiftNano: number): LonLat[] {
  return pts.map((p) => {
    const lon = fromNano(p.x + shiftNano);
    const lat = fromNano(p.y);
    return { lon: lon === 0 ? 0 : lon, lat: lat === 0 ? 0 : lat };
  });
}

/** Unwrapped ring → output rings within [−180, 180], split at the antimeridian when it crosses. */
function splitAtAntimeridian(u: ReadonlyArray<IPoint>): LonLat[][] {
  let minX = Number.POSITIVE_INFINITY;
  for (const p of u) if (p.x < minX) minX = p.x;
  // Shift the whole ring by a multiple of 360° so that minX ∈ [−180°, 180°).
  const shift = -FULL * Math.floor((minX + HALF) / FULL);
  const s = u.map((p) => ({ x: p.x + shift, y: p.y }));
  let maxX = Number.NEGATIVE_INFINITY;
  for (const p of s) if (p.x > maxX) maxX = p.x;
  if (maxX <= HALF) return [toLonLatRing(s, 0)];
  const west = clipAtX(s, HALF, true);
  const east = clipAtX(s, HALF, false);
  const rings: LonLat[][] = [];
  if (west.length >= 3) rings.push(toLonLatRing(west, 0));
  if (east.length >= 3) rings.push(toLonLatRing(east, -FULL));
  return rings;
}

function result(errors: RoiError[], areaKm2: number, rings: LonLat[][]): RoiValidation {
  return { ok: errors.length === 0, errors, areaKm2, rings };
}

function fail(code: RoiErrorCode, message: string): RoiValidation {
  return result([{ code, message }], 0, []);
}

/**
 * Validate and normalise a player-drawn ROI outline (spec §10 geometry guards).
 *
 * Pipeline: finite check → normalise (lon wrapped to (−180, 180], |lat| clamped to 89.9°, snapped to
 * a 1e-9° lattice) → drop consecutive duplicates (incl. a closing vertex equal to the first) →
 * ≥ 3 distinct vertices → unwrap longitudes edge-by-edge (shortest way round) → reject pole loops
 * and ≥ 360° spans → reject all-collinear (zero area) → exact self-intersection test on the
 * lattice (proper crossings, touching, collinear overlaps, fold-back spikes) → spherical-excess
 * area within [roiAreaMinKm2, roiAreaMaxKm2] → rings split at ±180°.
 *
 * Edges are straight lines in lon/lat (the EPSG:4326 grid the score is rasterised on); the area uses
 * great-circle edges — a documented bounds-check approximation.
 */
export function validateRoi(
  vertices: LonLat[],
  cfg: Pick<ScoringConfig, "roiAreaMinKm2" | "roiAreaMaxKm2">,
): RoiValidation {
  const input: ReadonlyArray<LonLat> = Array.isArray(vertices) ? vertices : [];
  for (const v of input) {
    if (
      !v ||
      typeof v.lon !== "number" ||
      typeof v.lat !== "number" ||
      !Number.isFinite(v.lon) ||
      !Number.isFinite(v.lat)
    ) {
      return fail("DEGENERATE", ROI_MESSAGES.offMap);
    }
  }

  const pts: IPoint[] = input.map((v) => {
    let x = toNano(wrapLon180(v.lon));
    if (x <= -HALF) x += FULL; // rounding can land exactly on −180° → canonical +180°
    return { x, y: toNano(clampLat899(v.lat)) };
  });
  const ring = dedupeRing(pts);
  const distinct = new Set(ring.map((p) => `${p.x},${p.y}`));
  if (ring.length < 3 || distinct.size < 3) return fail("TOO_FEW_VERTICES", ROI_MESSAGES.tooFew);
  const n = ring.length;

  // Unwrap longitudes: each edge goes the short way round the globe.
  const u: IPoint[] = [{ x: (ring[0] as IPoint).x, y: (ring[0] as IPoint).y }];
  for (let i = 1; i < n; i++) {
    const prev = u[i - 1] as IPoint;
    const d = wrapDeltaNano((ring[i] as IPoint).x - (ring[i - 1] as IPoint).x);
    u.push({ x: prev.x + d, y: (ring[i] as IPoint).y });
  }
  const closing = wrapDeltaNano((ring[0] as IPoint).x - (ring[n - 1] as IPoint).x);
  if ((u[n - 1] as IPoint).x + closing !== (u[0] as IPoint).x) return fail("DEGENERATE", ROI_MESSAGES.poleLoop);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const p of u) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  if (maxX - minX >= FULL) return fail("DEGENERATE", ROI_MESSAGES.wrapsGlobe);

  const p0 = u[0] as IPoint;
  const p1 = u[1] as IPoint;
  let allCollinear = true;
  for (let k = 2; k < n; k++) {
    if (orientSign(p0, p1, u[k] as IPoint) !== 0) {
      allCollinear = false;
      break;
    }
  }
  if (allCollinear) return fail("DEGENERATE", ROI_MESSAGES.collinear);

  if (selfIntersects(u)) return fail("SELF_INTERSECTION", ROI_MESSAGES.selfIntersection);

  const areaKm2 = sphericalAreaKm2(toLonLatRing(u, 0));
  const errors: RoiError[] = [];
  if (areaKm2 < cfg.roiAreaMinKm2) {
    errors.push({ code: "AREA_TOO_SMALL", message: areaTooSmallMessage(areaKm2, cfg.roiAreaMinKm2) });
  } else if (areaKm2 > cfg.roiAreaMaxKm2) {
    errors.push({ code: "AREA_TOO_LARGE", message: areaTooLargeMessage(areaKm2, cfg.roiAreaMaxKm2) });
  }
  return result(errors, areaKm2, splitAtAntimeridian(u));
}

/** O(n²) exact test over all edge pairs of a closed ring (bbox-filtered). */
function selfIntersects(u: ReadonlyArray<IPoint>): boolean {
  const n = u.length;
  for (let i = 0; i < n; i++) {
    const a1 = u[i] as IPoint;
    const a2 = u[(i + 1) % n] as IPoint;
    for (let j = i + 1; j < n; j++) {
      const b1 = u[j] as IPoint;
      const b2 = u[(j + 1) % n] as IPoint;
      if (j === i + 1) {
        // e_i = (u_i, u_i+1), e_j = (u_i+1, u_i+2): share u_i+1
        if (adjacentEdgesOverlap(a1, a2, b2)) return true;
      } else if (i === 0 && j === n - 1) {
        // e_{n-1} = (u_{n-1}, u_0), e_0 = (u_0, u_1): share u_0
        if (adjacentEdgesOverlap(b1, a1, a2)) return true;
      } else if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}
