/**
 * WGS84 geodetic ↔ ECEF transforms, local ENU basis and altitude scaling.
 * Radians in, metres out. Pure functions; optional `out` parameters for scratch reuse.
 */
import type { Vec3 } from "../contracts";
import { vec3 } from "./vec3";
import { WGS84_A, WGS84_E2, WGS84_E4, WGS84_ONE_MINUS_E2, meridionalRadius } from "./wgs84";

export interface Geodetic {
  lonRad: number;
  latRad: number;
  heightM: number;
}

export interface EnuBasis {
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

/**
 * Geodetic (λ, φ, h) → ECEF (m).
 *   N = a / √(1 − e² sin²φ);  x = (N+h)cosφ cosλ;  y = (N+h)cosφ sinλ;  z = (N(1−e²)+h) sinφ
 */
export function geodeticToEcef(lonRad: number, latRad: number, heightM: number, out: Vec3 = vec3()): Vec3 {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const rho = (n + heightM) * cosLat;
  out.x = rho * Math.cos(lonRad);
  out.y = rho * Math.sin(lonRad);
  out.z = (n * WGS84_ONE_MINUS_E2 + heightM) * sinLat;
  return out;
}

/** Convenience: degrees in. */
export function geodeticDegToEcef(lonDeg: number, latDeg: number, heightM: number, out: Vec3 = vec3()): Vec3 {
  return geodeticToEcef((lonDeg * Math.PI) / 180, (latDeg * Math.PI) / 180, heightM, out);
}

/** Maximum Newton polish iterations after the closed form (each one must reduce the residual). */
const POLISH_MAX_ITER = 3;
/** Stop polishing once the forward-model residual is below this (m). */
const POLISH_RESIDUAL_M = 1e-10; // well below double round-off at Earth scale (~1e-9 m)
/** Skip the polish inside/near the evolute, where the Newton Jacobian (M + h) degenerates. */
const POLISH_MIN_CURVATURE_M = 1000;

/**
 * ECEF → geodetic (λ, φ, h), exact closed form valid everywhere including the poles, the
 * equatorial plane and the region around the Earth's centre (inside the evolute).
 *
 * Algorithm: Vermeille (2004, J. Geodesy 78:94–95) quartic solution with the evolute and
 * cancellation fixes of Karney's GeographicLib `Geocentric::IntReverse` (oblate case), then up to
 * {@link POLISH_MAX_ITER} guarded Newton steps on the forward model (each accepted only if it
 * lowers the residual; tolerance ~1e-12 relative). On the polar axis λ = 0. At the exact centre the
 * result is the north-pole foot point (φ = +90°, h = −b). λ is in (−π, π].
 */
export function ecefToGeodetic(p: Vec3, out?: Geodetic): Geodetic {
  const X = p.x;
  const Y = p.y;
  const Z = p.z;
  const R = Math.sqrt(X * X + Y * Y);

  let lon = R === 0 ? 0 : Math.atan2(Y, X);
  if (lon === -Math.PI) lon = Math.PI;

  let sphi: number;
  let cphi: number;
  let h: number;

  const pp = (R / WGS84_A) * (R / WGS84_A);
  const q = WGS84_ONE_MINUS_E2 * (Z / WGS84_A) * (Z / WGS84_A);
  const r = (pp + q - WGS84_E4) / 6;

  if (!(WGS84_E4 * q === 0 && r <= 0)) {
    // S = r³·s, avoids division by zero when r = 0.
    const S = (WGS84_E4 * pp * q) / 4;
    const r2 = r * r;
    const r3 = r * r2;
    const disc = S * (2 * r3 + S);
    let u = r;
    if (disc >= 0) {
      let T3 = S + r3;
      // Choose the sqrt sign maximising |T3| to minimise cancellation.
      T3 += T3 < 0 ? -Math.sqrt(disc) : Math.sqrt(disc);
      const T = Math.cbrt(T3);
      u += T + (T !== 0 ? r2 / T : 0);
    } else {
      // T complex, u real: pick the cube root that avoids cancellation (disc < 0 ⇒ r < 0).
      const ang = Math.atan2(Math.sqrt(-disc), -(S + r3));
      u += 2 * r * Math.cos(ang / 3);
    }
    const v = Math.sqrt(u * u + WGS84_E4 * q); // > 0
    const uv = u < 0 ? (WGS84_E4 * q) / (v - u) : u + v; // u + v, > 0, cancellation-free
    const w = Math.max(0, (WGS84_E2 * (uv - q)) / (2 * v));
    const k = uv / (Math.sqrt(uv + w * w) + w);
    const k2 = k + WGS84_E2;
    const d = (k * R) / k2;
    const zk = Z / k;
    const rk = R / k2;
    const H = Math.sqrt(zk * zk + rk * rk);
    sphi = zk / H;
    cphi = rk / H;
    h = (1 - WGS84_ONE_MINUS_E2 / k) * Math.sqrt(d * d + Z * Z);
  } else {
    // Equatorial plane inside the evolute (incl. the centre): limit k → 0, two symmetric foot
    // points; take the one on the side of Z (north for Z = ±0).
    const zz = Math.sqrt((WGS84_E4 - pp) / WGS84_ONE_MINUS_E2);
    const xx = Math.sqrt(pp);
    const H = Math.sqrt(zz * zz + xx * xx);
    sphi = zz / H;
    cphi = xx / H;
    if (Z < 0) sphi = -sphi;
    h = (-WGS84_A * WGS84_ONE_MINUS_E2 * H) / WGS84_E2;
  }

  let lat = Math.atan2(sphi, cphi);

  // Guarded Newton polish on (ρ, z) = f(φ, h).
  const mh0 = meridionalRadius(lat) + h;
  if (mh0 > POLISH_MIN_CURVATURE_M && Number.isFinite(h)) {
    let s = Math.sin(lat);
    let c = Math.cos(lat);
    let n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
    let dR = R - (n + h) * c;
    let dZ = Z - (n * WGS84_ONE_MINUS_E2 + h) * s;
    let res = Math.sqrt(dR * dR + dZ * dZ);
    for (let i = 0; i < POLISH_MAX_ITER && res > POLISH_RESIDUAL_M; i++) {
      const mh = meridionalRadius(lat) + h;
      const latN = lat + (-s * dR + c * dZ) / mh;
      const hN = h + c * dR + s * dZ;
      const sN = Math.sin(latN);
      const cN = Math.cos(latN);
      const nN = WGS84_A / Math.sqrt(1 - WGS84_E2 * sN * sN);
      const dRN = R - (nN + hN) * cN;
      const dZN = Z - (nN * WGS84_ONE_MINUS_E2 + hN) * sN;
      const resN = Math.sqrt(dRN * dRN + dZN * dZN);
      if (!(resN < res)) break;
      lat = latN;
      h = hN;
      s = sN;
      c = cN;
      n = nN;
      dR = dRN;
      dZ = dZN;
      res = resN;
    }
  }

  const o = out ?? { lonRad: 0, latRad: 0, heightM: 0 };
  o.lonRad = lon;
  o.latRad = lat;
  o.heightM = h;
  return o;
}

/** Geodetic surface normal (= ENU "up") at (λ, φ). */
export function geodeticSurfaceNormal(lonRad: number, latRad: number, out: Vec3 = vec3()): Vec3 {
  const cosLat = Math.cos(latRad);
  out.x = cosLat * Math.cos(lonRad);
  out.y = cosLat * Math.sin(lonRad);
  out.z = Math.sin(latRad);
  return out;
}

/**
 * Local East-North-Up orthonormal basis at geodetic (λ, φ), expressed in ECEF.
 *   east  = (−sinλ, cosλ, 0)
 *   north = (−sinφ cosλ, −sinφ sinλ, cosφ)
 *   up    = (cosφ cosλ, cosφ sinλ, sinφ)
 * Well defined at the poles (east follows λ). Right-handed: east × north = up.
 */
export function enuBasis(lonRad: number, latRad: number, out?: EnuBasis): EnuBasis {
  const o = out ?? { east: vec3(), north: vec3(), up: vec3() };
  const sl = Math.sin(lonRad);
  const cl = Math.cos(lonRad);
  const sp = Math.sin(latRad);
  const cp = Math.cos(latRad);
  o.east.x = -sl;
  o.east.y = cl;
  o.east.z = 0;
  o.north.x = -sp * cl;
  o.north.y = -sp * sl;
  o.north.z = cp;
  o.up.x = cp * cl;
  o.up.y = cp * sl;
  o.up.z = sp;
  return o;
}

const scratchGeo: Geodetic = { lonRad: 0, latRad: 0, heightM: 0 };

/**
 * Move `p` along its geodetic normal so that it keeps (λ, φ) and gets ellipsoidal height `heightM`.
 * out = p + (heightM − h(p)) · n(φ, λ). Exact for any p (the normal through p is the
 * height coordinate line).
 */
export function scaleToAltitude(p: Vec3, heightM: number, out: Vec3 = vec3()): Vec3 {
  const g = ecefToGeodetic(p, scratchGeo);
  const dh = heightM - g.heightM;
  const cosLat = Math.cos(g.latRad);
  const nx = cosLat * Math.cos(g.lonRad);
  const ny = cosLat * Math.sin(g.lonRad);
  const nz = Math.sin(g.latRad);
  out.x = p.x + dh * nx;
  out.y = p.y + dh * ny;
  out.z = p.z + dh * nz;
  return out;
}
