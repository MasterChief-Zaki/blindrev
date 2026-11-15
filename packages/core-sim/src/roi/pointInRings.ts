import type { LonLat } from "../contracts";
import { crossingX } from "./planar";

/** Longitude offsets tested so rings and points in different 360° windows still meet. */
export const LON_WINDOW_OFFSETS: ReadonlyArray<number> = [-360, 0, 360];

/**
 * Even-odd point-in-polygon over a set of rings (holes / multiple rings combine by parity).
 *
 * Exactly the rule `rasterizeRings` applies at pixel centres, so
 * `pointInRings(cx, cy, rings) === (raster[pixel] === 1)` bit-for-bit:
 * - an edge counts when it straddles the horizontal line through the point with the half-open
 *   rule `(a.lat > lat) !== (b.lat > lat)` (vertices exactly on the line are counted once);
 * - it is a crossing when its intersection x is strictly greater than the point's lon
 *   (so points on a left edge are inside, points on a right edge are outside);
 * - the intersection is computed with canonical endpoint order (direction-independent);
 * - the point is also tested at lon ± 360 and the parities are combined, so unwrapped rings
 *   (e.g. lon 179 → 181) work. Rings from `validateRoi` already lie within [−180, 180].
 */
export function pointInRings(lon: number, lat: number, rings: LonLat[][]): boolean {
  let inside = false;
  for (const off of LON_WINDOW_OFFSETS) {
    const px = lon + off;
    for (const ring of rings) {
      const n = ring.length;
      if (n < 2) continue;
      for (let i = 0; i < n; i++) {
        const a = ring[i] as LonLat;
        const b = ring[(i + 1) % n] as LonLat;
        if (a.lat > lat !== b.lat > lat) {
          if (crossingX(a.lon, a.lat, b.lon, b.lat, lat) > px) inside = !inside;
        }
      }
    }
  }
  return inside;
}
