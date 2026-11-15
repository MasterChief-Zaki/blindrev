/**
 * Web-Mercator (EPSG:3857, GoogleMapsCompatible) XYZ tile maths.
 * Tile (x, y) at zoom z: x grows east from -180°, y grows south from +85.0511°.
 */
import type { Bounds } from "@blindrev/core-sim";

export const MERCATOR_MAX_LAT = 85.0511287798066;

export interface TileXYZ {
  z: number;
  x: number;
  y: number;
}

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
  const r = (clamped * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return Math.min(n - 1, Math.max(0, y));
}

/** Geographic bounds of one tile. */
export function tileBounds(t: TileXYZ): Bounds {
  const n = 2 ** t.z;
  const lonW = (t.x / n) * 360 - 180;
  const lonE = ((t.x + 1) / n) * 360 - 180;
  const latN = (Math.atan(Math.sinh(Math.PI * (1 - (2 * t.y) / n))) * 180) / Math.PI;
  const latS = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + 1)) / n))) * 180) / Math.PI;
  return [lonW, latS, lonE, latN];
}

/** Every tile intersecting `bounds` for zooms minZoom..maxZoom (row-major, deterministic order). */
export function tilesForBounds(bounds: Bounds, minZoom: number, maxZoom: number): TileXYZ[] {
  const [w, s, e, n] = bounds;
  const out: TileXYZ[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lonToTileX(w, z);
    const x1 = lonToTileX(e, z);
    const y0 = latToTileY(n, z);
    const y1 = latToTileY(s, z);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  }
  return out;
}

/** Every tile of the whole world for zooms minZoom..maxZoom. */
export function globalTiles(minZoom: number, maxZoom: number): TileXYZ[] {
  const out: TileXYZ[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push({ z, x, y });
  }
  return out;
}

export function fillTemplate(template: string, t: TileXYZ): string {
  return template.replaceAll("{z}", String(t.z)).replaceAll("{y}", String(t.y)).replaceAll("{x}", String(t.x));
}
