/** Angle helpers. Degrees ↔ radians, longitude wrap, latitude clamp. */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function degToRad(deg: number): number {
  return deg * DEG2RAD;
}

export function radToDeg(rad: number): number {
  return rad * RAD2DEG;
}

/**
 * Wrap a longitude in degrees into (−180, 180]. +180 stays +180, −180 maps to +180.
 * −0 is normalised to +0. Non-finite input returns NaN (callers sanitise first).
 */
export function wrapLonDeg(lon: number): number {
  if (!Number.isFinite(lon)) return Number.NaN;
  let x = lon % 360; // (−360, 360), exact in IEEE arithmetic
  if (x <= -180) x += 360;
  else if (x > 180) x -= 360;
  return x === 0 ? 0 : x;
}

/** Wrap a longitude in radians into (−π, π]. */
export function wrapLonRad(lon: number): number {
  if (!Number.isFinite(lon)) return Number.NaN;
  const twoPi = 2 * Math.PI;
  let x = lon % twoPi;
  if (x <= -Math.PI) x += twoPi;
  else if (x > Math.PI) x -= twoPi;
  return x === 0 ? 0 : x;
}

/** Wrap an angle in degrees into [0, 360). */
export function wrap360Deg(a: number): number {
  if (!Number.isFinite(a)) return Number.NaN;
  let x = a % 360;
  if (x < 0) x += 360;
  if (x >= 360) x -= 360; // guards x = −tiny + 360 rounding up to 360
  return x === 0 ? 0 : x;
}

/** Clamp a latitude in degrees to [−|limit|, +|limit|]. NaN in → NaN out. */
export function clampLatDeg(lat: number, limit = 90): number {
  const l = Math.min(90, Math.abs(limit));
  if (lat > l) return l;
  if (lat < -l) return -l;
  return lat;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
