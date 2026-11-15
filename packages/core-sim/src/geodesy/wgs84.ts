/**
 * WGS84 ellipsoid constants (NIMA TR8350.2 / EPSG:7030). Defining parameters are `a` and `1/f`;
 * everything else is derived here in IEEE-754 double precision.
 */

/** Semi-major axis a (m). */
export const WGS84_A = 6378137.0;
/** Inverse flattening 1/f. */
export const WGS84_INV_F = 298.257223563;
/** Flattening f. */
export const WGS84_F = 1 / WGS84_INV_F;
/** Semi-minor axis b = a(1−f) (m) ≈ 6356752.314245179. */
export const WGS84_B = WGS84_A * (1 - WGS84_F);
/** First eccentricity squared e² = f(2−f) ≈ 0.00669437999014. */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** First eccentricity e. */
export const WGS84_E = Math.sqrt(WGS84_E2);
/** e⁴. */
export const WGS84_E4 = WGS84_E2 * WGS84_E2;
/** 1 − e² = (b/a)². */
export const WGS84_ONE_MINUS_E2 = 1 - WGS84_E2;
/** Second eccentricity squared e'² = e²/(1−e²). */
export const WGS84_EP2 = WGS84_E2 / WGS84_ONE_MINUS_E2;
/** Third flattening n = f/(2−f) (used by the meridian-arc series). */
export const WGS84_N = WGS84_F / (2 - WGS84_F);
/** Nominal Earth rotation rate ω (rad/s), IERS conventions / WGS84 (7.292115e-5 rounded). */
export const EARTH_ROTATION_RATE_RAD_S = 7.292115146706979e-5;

export const WGS84 = Object.freeze({
  a: WGS84_A,
  b: WGS84_B,
  f: WGS84_F,
  invF: WGS84_INV_F,
  e2: WGS84_E2,
  e: WGS84_E,
  ep2: WGS84_EP2,
  n: WGS84_N,
});

/** Prime-vertical radius of curvature N(φ) = a / √(1 − e² sin²φ). */
export function primeVerticalRadius(latRad: number): number {
  const s = Math.sin(latRad);
  return WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
}

/** Meridional radius of curvature M(φ) = a(1−e²) / (1 − e² sin²φ)^{3/2}. */
export function meridionalRadius(latRad: number): number {
  const s = Math.sin(latRad);
  const w = 1 - WGS84_E2 * s * s;
  return (WGS84_A * WGS84_ONE_MINUS_E2) / (w * Math.sqrt(w));
}
