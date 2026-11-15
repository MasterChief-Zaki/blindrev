/**
 * Internal planar helpers shared by ROI validation, point-in-polygon and rasterisation.
 * Not re-exported from the package index (names would collide with geodesy helpers).
 */

/** ROI coordinates are snapped to a 1e-9° lattice (≈ 0.1 mm) so geometric predicates are exact. */
export const NANO_PER_DEG = 1e9;
export const LAT_LIMIT_DEG = 89.9;
const FULL_TURN_NANO = 360 * NANO_PER_DEG;
const HALF_TURN_NANO = 180 * NANO_PER_DEG;

/** Wrap degrees into (−180, 180]; −0 → 0. */
export function wrapLon180(lon: number): number {
  let x = lon % 360;
  if (x <= -180) x += 360;
  else if (x > 180) x -= 360;
  return x === 0 ? 0 : x;
}

/** Clamp to [−89.9, 89.9]. */
export function clampLat899(lat: number): number {
  return Math.max(-LAT_LIMIT_DEG, Math.min(LAT_LIMIT_DEG, lat));
}

/** Degrees → integer nanodegrees (Math.round: ties toward +∞, deterministic on every engine). */
export function toNano(deg: number): number {
  const v = Math.round(deg * NANO_PER_DEG);
  return v === 0 ? 0 : v;
}

export function fromNano(v: number): number {
  return v / NANO_PER_DEG;
}

/** Map an integer nanodegree longitude difference into (−180°, 180°]. */
export function wrapDeltaNano(d: number): number {
  let x = d % FULL_TURN_NANO;
  if (x <= -HALF_TURN_NANO) x += FULL_TURN_NANO;
  else if (x > HALF_TURN_NANO) x -= FULL_TURN_NANO;
  return x === 0 ? 0 : x;
}

export const FULL_TURN_NANO_CONST = FULL_TURN_NANO;
export const HALF_TURN_NANO_CONST = HALF_TURN_NANO;

export interface IPoint {
  x: number; // integer nanodegrees (unwrapped longitude)
  y: number; // integer nanodegrees (latitude)
}

/**
 * Exact sign of the orientation determinant (b − a) × (c − a) for integer coordinates.
 * Fast path in doubles with a conservative error bound; exact BigInt fallback near zero.
 */
export function orientSign(a: IPoint, b: IPoint, c: IPoint): -1 | 0 | 1 {
  const abx = b.x - a.x; // exact: |coords| < 2^53
  const aby = b.y - a.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const l = abx * acy;
  const r = aby * acx;
  const det = l - r;
  const bound = (Math.abs(l) + Math.abs(r)) * 1e-14;
  if (det > bound) return 1;
  if (det < -bound) return -1;
  const exact = BigInt(abx) * BigInt(acy) - BigInt(aby) * BigInt(acx);
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}

/** c lies within the closed axis-aligned box of segment ab (assumes collinearity was established). */
function onSegment(a: IPoint, b: IPoint, c: IPoint): boolean {
  return (
    Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y)
  );
}

/** Closed-segment intersection test (touching and collinear overlap count as intersecting). */
export function segmentsIntersect(p1: IPoint, p2: IPoint, q1: IPoint, q2: IPoint): boolean {
  // Bounding-box rejection first (cheap, exact on integers).
  if (Math.max(p1.x, p2.x) < Math.min(q1.x, q2.x) || Math.max(q1.x, q2.x) < Math.min(p1.x, p2.x)) return false;
  if (Math.max(p1.y, p2.y) < Math.min(q1.y, q2.y) || Math.max(q1.y, q2.y) < Math.min(p1.y, p2.y)) return false;
  const o1 = orientSign(p1, p2, q1);
  const o2 = orientSign(p1, p2, q2);
  const o3 = orientSign(q1, q2, p1);
  const o4 = orientSign(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, p2, q2)) return true;
  if (o3 === 0 && onSegment(q1, q2, p1)) return true;
  if (o4 === 0 && onSegment(q1, q2, p2)) return true;
  // A crossing where exactly one orientation is zero always passes through that endpoint,
  // which the onSegment cases above already caught.
  return false;
}

/**
 * Adjacent edges a→b, b→c fold back onto each other (collinear overlap beyond the shared
 * vertex b) — a zero-width spike.
 */
export function adjacentEdgesOverlap(a: IPoint, b: IPoint, c: IPoint): boolean {
  if (orientSign(a, b, c) !== 0) return false;
  // a−b and c−b are exactly parallel here, so both dot-product terms share the sign of the dot
  // product (no cancellation): the double-precision sign is exact.
  const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y);
  return dot > 0;
}

/**
 * x-coordinate where segment (ax,ay)–(bx,by) crosses the horizontal line y = cy. Endpoints are
 * put in canonical order (lower y first) so the floating-point result does not depend on the
 * ring's traversal direction or starting vertex. Caller guarantees `(ay > cy) !== (by > cy)`.
 */
export function crossingX(ax: number, ay: number, bx: number, by: number, cy: number): number {
  if (ay < by) return ax + ((cy - ay) * (bx - ax)) / (by - ay);
  return bx + ((cy - by) * (ax - bx)) / (ay - by);
}
