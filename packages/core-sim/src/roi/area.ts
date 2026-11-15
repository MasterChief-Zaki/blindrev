import type { LonLat } from "../contracts";
import { wrapLon180 } from "./planar";

/** Authalic (equal-area) sphere radius for WGS84, metres. */
export const AUTHALIC_RADIUS_M = 6_371_007.2;

const DEG = Math.PI / 180;

/**
 * Signed spherical excess (steradians) of a ring with great-circle edges. Each edge contributes
 * the excess of the quadrilateral between the edge and the equator:
 *   E = 2·atan2( tan(Δλ/2)·(tan(φ1/2) + tan(φ2/2)), 1 + tan(φ1/2)·tan(φ2/2) )
 * (exact for great-circle edges; telescopes to the polygon's area). Edge Δλ is taken the short way
 * round (−180°, 180°], so rings given in wrapped or unwrapped longitudes give the same value.
 * Counter-clockwise rings come out negative with this sign convention.
 */
export function signedSphericalExcess(ring: ReadonlyArray<LonLat>): number {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as LonLat;
    const b = ring[(i + 1) % n] as LonLat;
    const dLon = wrapLon180(b.lon - a.lon) * DEG;
    if (dLon === 0) continue;
    const t1 = Math.tan((a.lat * DEG) / 2);
    const t2 = Math.tan((b.lat * DEG) / 2);
    sum += 2 * Math.atan2(Math.tan(dLon / 2) * (t1 + t2), 1 + t1 * t2);
  }
  return sum;
}

/**
 * Area of one ring in km² by spherical excess on the authalic sphere (R = 6 371 007.2 m), edges as
 * great-circle arcs. **Approximation used only for ROI bounds checking** (A_min ≤ A ≤ A_max): it
 * ignores ellipsoidal flattening (≲ 0.3 % here) and the difference between great-circle edges and
 * the straight lon/lat edges used for rasterisation (≈ 3e-5 relative for a 1° cell). The ring must
 * not enclose a pole. Winding-independent (absolute value). Never part of the score.
 */
export function sphericalAreaKm2(ring: LonLat[]): number {
  return (Math.abs(signedSphericalExcess(ring)) * AUTHALIC_RADIUS_M * AUTHALIC_RADIUS_M) / 1e6;
}
