/**
 * Meridian arc, isometric latitude and the rhumb-line (loxodrome) direct problem on WGS84.
 * Used by the camera pan: a constant-azimuth step is path-consistent (n steps of s/n land on the
 * same point as one step of s), so panning has no frame-rate-dependent drift.
 */
import { wrapLonRad } from "./angles";
import { WGS84_A, WGS84_E, WGS84_N, meridionalRadius, primeVerticalRadius } from "./wgs84";

const n = WGS84_N;
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;

/** Rectifying radius A = a/(1+n)·(1 + n²/4 + n⁴/64): m(π/2) = A·π/2. */
export const WGS84_RECTIFYING_RADIUS = (WGS84_A / (1 + n)) * (1 + n2 / 4 + n4 / 64);

// Helmert series m(φ) = a/(1+n)·[c0 φ − c2 sin2φ + c4 sin4φ − c6 sin6φ + c8 sin8φ]  (truncation ~ n⁵·a ≈ 1e-7 m)
const K = WGS84_A / (1 + n);
const C0 = 1 + n2 / 4 + n4 / 64;
const C2 = 1.5 * (n - n3 / 8);
const C4 = (15 / 16) * (n2 - n4 / 4);
const C6 = (35 / 48) * n3;
const C8 = (315 / 512) * n4;

// Inverse (footpoint) series μ → φ, refined by Newton on m(φ).
const D2 = 1.5 * n - (27 / 32) * n3;
const D4 = (21 / 16) * n2 - (55 / 32) * n4;
const D6 = (151 / 96) * n3;
const D8 = (1097 / 512) * n4;

/** Meridian arc length from the equator to geodetic latitude φ (m), signed. */
export function meridianArc(latRad: number): number {
  return (
    K *
    (C0 * latRad -
      C2 * Math.sin(2 * latRad) +
      C4 * Math.sin(4 * latRad) -
      C6 * Math.sin(6 * latRad) +
      C8 * Math.sin(8 * latRad))
  );
}

/** Inverse of {@link meridianArc}: geodetic latitude (rad) of the point at meridian distance m. */
export function inverseMeridianArc(m: number): number {
  const mu = m / WGS84_RECTIFYING_RADIUS;
  let phi = mu + D2 * Math.sin(2 * mu) + D4 * Math.sin(4 * mu) + D6 * Math.sin(6 * mu) + D8 * Math.sin(8 * mu);
  for (let i = 0; i < 3; i++) {
    const dphi = (m - meridianArc(phi)) / meridionalRadius(phi);
    phi += dphi;
    if (Math.abs(dphi) < 1e-15) break;
  }
  return phi;
}

/** Isometric latitude ψ(φ) = asinh(tanφ) − e·atanh(e sinφ). Infinite at the poles. */
export function isometricLatitude(latRad: number): number {
  return Math.asinh(Math.tan(latRad)) - WGS84_E * Math.atanh(WGS84_E * Math.sin(latRad));
}

/** dψ/dφ = M/(N cosφ). */
function dPsiDPhi(latRad: number): number {
  return meridionalRadius(latRad) / (primeVerticalRadius(latRad) * Math.cos(latRad));
}

export interface LonLatRad {
  lonRad: number;
  latRad: number;
}

/**
 * Rhumb-line direct problem with a latitude wall.
 *
 * Travels `distM` (≥ 0) metres of ellipsoidal arc from (λ1, φ1) at constant azimuth `azimuthRad`
 * (clockwise from north). Latitude is confined to [−latLimitRad, +latLimitRad]; if the wall is hit,
 * the remaining east–west component of the motion slides along the wall's parallel (the poleward
 * component is discarded). Result longitude is wrapped to (−π, π].
 *
 * Exactness: meridian arc (Helmert series + Newton inverse) and isometric latitude are exact to
 * ~1e-7 m / 1e-15 rad, so n steps of s/n reproduce one step of s to round-off.
 */
export function rhumbDirect(
  lonRad: number,
  latRad: number,
  azimuthRad: number,
  distM: number,
  latLimitRad: number,
  out?: LonLatRad,
): LonLatRad {
  const o = out ?? { lonRad: 0, latRad: 0 };
  const limit = Math.min(Math.abs(latLimitRad), Math.PI / 2 - 1e-9);
  const lat1 = Math.max(-limit, Math.min(limit, latRad));
  if (!(distM !== 0) || !Number.isFinite(distM)) {
    o.lonRad = wrapLonRad(lonRad);
    o.latRad = lat1;
    return o;
  }
  const sa = Math.sin(azimuthRad);
  const ca = Math.cos(azimuthRad);
  const m1 = meridianArc(lat1);
  const mLim = meridianArc(limit);
  const dm = distM * ca;
  let m2 = m1 + dm;
  let along = distM;
  let slide = 0;
  let lat2: number;
  if (m2 > mLim || m2 < -mLim) {
    const mWall = m2 > mLim ? mLim : -mLim;
    const frac = dm !== 0 ? Math.max(0, Math.min(1, (mWall - m1) / dm)) : 0;
    along = distM * frac;
    slide = (distM - along) * sa;
    m2 = mWall;
    lat2 = mWall > 0 ? limit : -limit;
  } else {
    lat2 = inverseMeridianArc(m2);
    if (lat2 > limit) lat2 = limit;
    else if (lat2 < -limit) lat2 = -limit;
  }

  let dLon: number;
  const dLat = lat2 - lat1;
  if (Math.abs(dLat) < 1e-4) {
    // Near east–west: Δλ = s·sinα·(Δψ/Δm) with both integrals by Simpson in φ (well conditioned
    // as Δφ → 0, where the ratio → 1/(N cosφ)).
    const latM = 0.5 * (lat1 + lat2);
    const num = dPsiDPhi(lat1) + 4 * dPsiDPhi(latM) + dPsiDPhi(lat2);
    const den = meridionalRadius(lat1) + 4 * meridionalRadius(latM) + meridionalRadius(lat2);
    dLon = along * sa * (num / den);
  } else {
    dLon = (sa / ca) * (isometricLatitude(lat2) - isometricLatitude(lat1));
  }
  if (slide !== 0) {
    dLon += slide / (primeVerticalRadius(lat2) * Math.cos(lat2));
  }
  o.lonRad = wrapLonRad(lonRad + dLon);
  o.latRad = lat2;
  return o;
}

/** Rhumb-line distance (m) and azimuth between two points (inverse problem); used by tests/tools. */
export function rhumbInverse(
  lon1Rad: number,
  lat1Rad: number,
  lon2Rad: number,
  lat2Rad: number,
): { distM: number; azimuthRad: number } {
  const dLon = wrapLonRad(lon2Rad - lon1Rad); // shortest way round; exactly ±π resolves eastward
  const dm = meridianArc(lat2Rad) - meridianArc(lat1Rad);
  const dLat = lat2Rad - lat1Rad;
  let ratio: number; // Δψ/Δm
  if (Math.abs(dLat) < 1e-4) {
    const latM = 0.5 * (lat1Rad + lat2Rad);
    const num = dPsiDPhi(lat1Rad) + 4 * dPsiDPhi(latM) + dPsiDPhi(lat2Rad);
    const den = meridionalRadius(lat1Rad) + 4 * meridionalRadius(latM) + meridionalRadius(lat2Rad);
    ratio = num / den;
  } else {
    ratio = (isometricLatitude(lat2Rad) - isometricLatitude(lat1Rad)) / dm;
  }
  // east metres-equivalent: dLon / ratio ; north metres: dm
  const east = dLon / ratio;
  const distM = Math.sqrt(east * east + dm * dm);
  const azimuthRad = Math.atan2(east, dm);
  return { distM, azimuthRad };
}
