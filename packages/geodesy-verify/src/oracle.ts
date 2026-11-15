/**
 * Independent analytic WGS84 oracles — deliberately NOT sharing formulas with core-sim:
 *  - forward: parametric (reduced) latitude form S = (a cosβ cosλ, a cosβ sinλ, b sinβ), P = S + h·n
 *    (core-sim uses the prime-vertical radius N form);
 *  - inverse: Eberly's robust point-to-ellipse distance (bisection on the Lagrange-multiplier root,
 *    "Distance from a Point to an Ellipse, an Ellipsoid, or a Hyperellipsoid", Geometric Tools 2013)
 *    in the meridian plane (core-sim uses Vermeille's closed form);
 *  - surface normal: normalised gradient of the implicit ellipsoid x²/a² + y²/a² + z²/b² − 1.
 * Only the defining constants a and 1/f are shared (from the WGS84 definition, not from core-sim).
 */
export const A = 6378137.0;
export const F = 1 / 298.257223563;
export const B = A * (1 - F);
export const E2 = F * (2 - F);

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Forward oracle via reduced latitude β: tanβ = (1 − f) tanφ. */
export function oracleGeodeticToEcef(lon: number, lat: number, h: number): V3 {
  const beta = Math.atan2((1 - F) * Math.sin(lat), Math.cos(lat));
  const cb = Math.cos(beta);
  const sx = A * cb * Math.cos(lon);
  const sy = A * cb * Math.sin(lon);
  const sz = B * Math.sin(beta);
  const cl = Math.cos(lat);
  return { x: sx + h * cl * Math.cos(lon), y: sy + h * cl * Math.sin(lon), z: sz + h * Math.sin(lat) };
}

function robustLength(v0: number, v1: number): number {
  const m = Math.max(Math.abs(v0), Math.abs(v1));
  if (m === 0) return 0;
  const a = v0 / m;
  const b = v1 / m;
  return m * Math.sqrt(a * a + b * b);
}

function getRoot(r0: number, z0: number, z1: number, g0: number): number {
  const n0 = r0 * z0;
  let s0 = z1 - 1;
  let s1 = g0 < 0 ? 0 : robustLength(n0, z1) - 1;
  let s = 0;
  for (let i = 0; i < 2000; i++) {
    s = 0.5 * (s0 + s1);
    if (s === s0 || s === s1) break;
    const ratio0 = n0 / (s + r0);
    const ratio1 = z1 / (s + 1);
    const g = ratio0 * ratio0 + ratio1 * ratio1 - 1;
    if (g > 0) s0 = s;
    else if (g < 0) s1 = s;
    else break;
  }
  return s;
}

/**
 * Closest point on the meridian ellipse (semi-axes e0 = a ≥ e1 = b) to (y0, y1), y0, y1 ≥ 0.
 * Returns the foot point (x0, x1) and the distance.
 */
function closestOnEllipse(y0: number, y1: number): { x0: number; x1: number; d: number } {
  const e0 = A;
  const e1 = B;
  if (y1 > 0) {
    if (y0 > 0) {
      const z0 = y0 / e0;
      const z1 = y1 / e1;
      const g = z0 * z0 + z1 * z1 - 1;
      if (g !== 0) {
        const r0 = (e0 / e1) * (e0 / e1);
        const sbar = getRoot(r0, z0, z1, g);
        const x0 = (r0 * y0) / (sbar + r0);
        const x1 = y1 / (sbar + 1);
        return { x0, x1, d: Math.hypot(x0 - y0, x1 - y1) };
      }
      return { x0: y0, x1: y1, d: 0 };
    }
    return { x0: 0, x1: e1, d: Math.abs(y1 - e1) };
  }
  const numer0 = e0 * y0;
  const denom0 = e0 * e0 - e1 * e1;
  if (numer0 < denom0) {
    const xde0 = numer0 / denom0;
    const x0 = e0 * xde0;
    const x1 = e1 * Math.sqrt(1 - xde0 * xde0);
    return { x0, x1, d: Math.hypot(x0 - y0, x1) };
  }
  return { x0: e0, x1: 0, d: Math.abs(y0 - e0) };
}

/** Inverse oracle: nearest-surface-point geodetic coordinates by bisection. */
export function oracleEcefToGeodetic(p: V3): { lon: number; lat: number; h: number } {
  const rho = Math.hypot(p.x, p.y);
  const lon = rho === 0 ? 0 : Math.atan2(p.y, p.x);
  const { x0, x1, d } = closestOnEllipse(rho, Math.abs(p.z));
  // normal at the foot point ∝ (x0/a², x1/b²)
  let lat = Math.atan2(x1 / (B * B), x0 / (A * A));
  if (p.z < 0) lat = -lat;
  const inside = (rho / A) * (rho / A) + (p.z / B) * (p.z / B) < 1;
  return { lon: lon === -Math.PI ? Math.PI : lon, lat, h: inside ? -d : d };
}

/** Unit outward normal of the ellipsoid surface at a surface point (gradient of the implicit form). */
export function oracleSurfaceNormalAt(s: V3): V3 {
  const gx = s.x / (A * A);
  const gy = s.y / (A * A);
  const gz = s.z / (B * B);
  const l = Math.hypot(gx, gy, gz);
  return { x: gx / l, y: gy / l, z: gz / l };
}

/** Deterministic PRNG for sampling (SplitMix32-style finaliser over a Weyl sequence). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return z / 4294967296;
  };
}

export interface GeoSample {
  lon: number;
  lat: number;
  h: number;
}

/**
 * Deterministic sample: uniform lon, lat (incl. exact poles, ±89.5°, equator, near-pole),
 * heights mixing realistic terrain, LEO, GEO, lunar distance and deep negative values.
 */
export function geodeticSample(
  seed: number,
  n: number,
  opts?: { maxHeightM?: number; minHeightM?: number },
): GeoSample[] {
  const rand = seededRandom(seed);
  const maxH = opts?.maxHeightM ?? 3.84e8;
  const minH = opts?.minHeightM ?? -1e5;
  const special = [Math.PI / 2, -Math.PI / 2, 0, (89.5 * Math.PI) / 180, (-89.5 * Math.PI) / 180, Math.PI / 2 - 1e-10];
  const heights = [0, -430, 8848.86, 1e5, 7.5e5, 3.5786e7, 3.84e8, -1e4, -1e5].filter((h) => h <= maxH && h >= minH);
  const out: GeoSample[] = [];
  for (let i = 0; i < n; i++) {
    const lon = (rand() * 2 - 1) * Math.PI;
    let lat = Math.asin(rand() * 2 - 1);
    if (i % 25 === 0) lat = special[(i / 25) % special.length] as number;
    let h: number;
    if (i % 4 === 0) h = heights[i % heights.length] as number;
    else if (i % 4 === 1) h = minH + rand() * (Math.min(maxH, 1e6) - minH);
    else h = (rand() * 2 - 1) * 9000;
    out.push({ lon, lat, h });
  }
  return out;
}
