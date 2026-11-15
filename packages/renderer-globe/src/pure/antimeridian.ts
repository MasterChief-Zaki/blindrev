/** Pure helpers for polylines that cross the ±180° meridian. No Cesium imports. */

export interface LonLatPoint {
  lon: number;
  lat: number;
}

/** Normalise any longitude to (-180, 180]. */
export function normLon(lon: number): number {
  let l = ((((lon + 180) % 360) + 360) % 360) - 180;
  if (l === -180) l = 180;
  return l;
}

/**
 * Split a lon/lat polyline wherever consecutive points jump by more than 180° in longitude
 * (an antimeridian crossing). The crossing latitude is linearly interpolated (in unwrapped
 * longitude) and both pieces get an explicit vertex on the meridian (+180 / -180), so the
 * drawn track is continuous on the globe and never wraps the long way round.
 * Segments with fewer than 2 points are dropped. Non-finite points break the line.
 */
export function splitAtAntimeridian(points: ReadonlyArray<LonLatPoint>): LonLatPoint[][] {
  const out: LonLatPoint[][] = [];
  let cur: LonLatPoint[] = [];
  const flush = (): void => {
    if (cur.length >= 2) out.push(cur);
    cur = [];
  };
  let prev: LonLatPoint | null = null;
  for (const raw of points) {
    if (!Number.isFinite(raw.lon) || !Number.isFinite(raw.lat)) {
      flush();
      prev = null;
      continue;
    }
    const p = { lon: normLon(raw.lon), lat: raw.lat };
    if (prev === null) {
      cur.push(p);
      prev = p;
      continue;
    }
    const d = p.lon - prev.lon;
    if (Math.abs(d) > 180) {
      // Crossing. Unwrap p relative to prev, interpolate the latitude at the meridian.
      const eastward = d < 0; // e.g. 179 -> -179 is eastward over +180
      const edge = eastward ? 180 : -180;
      const pUnwrapped = eastward ? p.lon + 360 : p.lon - 360;
      const span = pUnwrapped - prev.lon;
      const t = span === 0 ? 0 : (edge - prev.lon) / span;
      const latX = prev.lat + (p.lat - prev.lat) * t;
      if (prev.lon !== edge) cur.push({ lon: edge, lat: latX });
      flush();
      if (p.lon !== -edge) cur.push({ lon: -edge, lat: latX });
    }
    cur.push(p);
    prev = p;
  }
  flush();
  return out;
}
