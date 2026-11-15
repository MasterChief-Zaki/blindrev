/**
 * Time & frame utilities for TEME → ECEF (pseudo-Earth-fixed) conversion.
 *
 * GMST: IAU-1982 (Aoki et al. 1982) model, the one SGP4/TEME is defined against
 * (Vallado et al. 2006, "Revisiting Spacetrack Report #3", AIAA 2006-6753, eq. for θ_GMST):
 *   θ_GMST [s] = 67310.54841 + (876600·3600 + 8640184.812866)·T + 0.093104·T² − 6.2e-6·T³
 *   T = (JD_UT1 − 2451545.0) / 36525
 * UT1 is taken as UTC + ut1MinusUtcS (default 0, i.e. UT1 ≈ UTC; |UT1−UTC| ≤ 0.9 s by IERS rule).
 *
 * TEME → PEF/ECEF: r_ecef = R3(θ_GMST)·r_teme (rotation about z only; polar motion ignored),
 *   v_ecef = R3(θ_GMST)·v_teme − ω⊕ × r_ecef.
 */
import type { Vec3 } from "../contracts";
import { vec3 } from "../geodesy/vec3";
import { EARTH_ROTATION_RATE_RAD_S } from "../geodesy/wgs84";

/** 2000-01-01T12:00:00Z (JD 2451545.0) in Unix ms. */
export const J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0, 0);
const SECONDS_PER_DAY = 86400;
const TWO_PI = 2 * Math.PI;

/**
 * Greenwich Mean Sidereal Time (rad, [0, 2π)) — IAU-82, from a UTC instant.
 * Numerically the 876600·3600·T term equals the elapsed UT1 seconds since J2000, so it is reduced
 * modulo one day exactly before the small terms are added (keeps ~1e-12 rad precision).
 */
export function gmstRad(date: Date, ut1MinusUtcS = 0): number {
  const dut1Ms = Number.isFinite(ut1MinusUtcS) ? ut1MinusUtcS * 1000 : 0;
  // Integer-ms arithmetic first (exact for Date values), sub-ms DUT1 added after the reduction.
  const dMs = date.getTime() - J2000_UNIX_MS;
  const T = (dMs + dut1Ms) / (SECONDS_PER_DAY * 1000 * 36525);
  const secOfDay = (dMs % (SECONDS_PER_DAY * 1000)) / 1000 + dut1Ms / 1000;
  let sec = secOfDay + 67310.54841 + 8640184.812866 * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
  sec %= SECONDS_PER_DAY;
  if (sec < 0) sec += SECONDS_PER_DAY;
  const g = (sec / SECONDS_PER_DAY) * TWO_PI;
  return g >= TWO_PI ? g - TWO_PI : g;
}

/** TEME position → ECEF (same units as input). r_ecef = R3(θ)·r_teme. */
export function temeToEcef(teme: Vec3, gmst: number, out: Vec3 = vec3()): Vec3 {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  const x = c * teme.x + s * teme.y;
  const y = -s * teme.x + c * teme.y;
  out.x = x;
  out.y = y;
  out.z = teme.z;
  return out;
}

/** ECEF position → TEME (inverse rotation). */
export function ecefToTeme(ecef: Vec3, gmst: number, out: Vec3 = vec3()): Vec3 {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  const x = c * ecef.x - s * ecef.y;
  const y = s * ecef.x + c * ecef.y;
  out.x = x;
  out.y = y;
  out.z = ecef.z;
  return out;
}

/**
 * TEME velocity → ECEF velocity: v_ecef = R3(θ)·v_teme − ω⊕ × r_ecef, with ω⊕ = (0, 0, ω).
 * `rEcef` is the already-rotated position (same length unit as v·s).
 */
export function temeVelocityToEcef(
  vTeme: Vec3,
  rEcef: Vec3,
  gmst: number,
  out: Vec3 = vec3(),
  omegaRadS: number = EARTH_ROTATION_RATE_RAD_S,
): Vec3 {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  const vx = c * vTeme.x + s * vTeme.y;
  const vy = -s * vTeme.x + c * vTeme.y;
  // ω × r = (−ω r_y, ω r_x, 0)
  const rx = rEcef.x;
  const ry = rEcef.y;
  out.x = vx + omegaRadS * ry;
  out.y = vy - omegaRadS * rx;
  out.z = vTeme.z;
  return out;
}
