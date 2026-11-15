/** Pure timing / interpolation helpers for the camera. No DOM, no Cesium. */

/**
 * Fixed-timestep accumulator: real frame dt is clamped to `maxFrameS` and consumed in exact
 * `stepS` increments (at most `maxSteps` per frame), so camera integration is deterministic
 * and independent of frame rate.
 */
export class FixedStepper {
  private acc = 0;
  constructor(
    readonly stepS = 1 / 60,
    readonly maxFrameS = 0.1,
    readonly maxSteps = 6,
  ) {}
  /** Returns how many fixed steps to run for this frame. */
  advance(dtS: number): number {
    const dt = Number.isFinite(dtS) && dtS > 0 ? Math.min(dtS, this.maxFrameS) : 0;
    this.acc += dt;
    let n = Math.floor(this.acc / this.stepS + 1e-9);
    if (n > this.maxSteps) {
      n = this.maxSteps;
      this.acc = 0;
    } else {
      this.acc -= n * this.stepS;
      if (this.acc < 0) this.acc = 0;
    }
    return n;
  }
  reset(): void {
    this.acc = 0;
  }
}

/** CSS cubic-bezier(x1, y1, x2, y2) easing evaluated at progress t ∈ [0,1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number): number => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number): number => ((ay * u + by) * u + cy) * u;
  const dsx = (u: number): number => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - t;
      if (Math.abs(err) < 1e-7) break;
      const d = dsx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    if (u < 0 || u > 1 || Math.abs(sx(u) - t) > 1e-5) {
      let lo = 0;
      let hi = 1;
      u = t;
      for (let i = 0; i < 40; i++) {
        const v = sx(u);
        if (Math.abs(v - t) < 1e-7) break;
        if (v < t) lo = u;
        else hi = u;
        u = (lo + hi) / 2;
      }
    }
    return sy(u);
  };
}

/** Brand motion curve (ARCHITECTURE §8). */
export const easeBrand = cubicBezier(0.2, 0, 0, 1);

/** Shortest signed angular difference b − a in degrees, in (-180, 180]. */
export function shortestDeltaDeg(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export interface CamPose {
  lonDeg: number;
  latDeg: number;
  rangeM: number;
  headingDeg: number;
  pitchDeg: number;
}

/** Great-circle angle between two lon/lat points (radians). */
export function centralAngleRad(lon1Deg: number, lat1Deg: number, lon2Deg: number, lat2Deg: number): number {
  const r = Math.PI / 180;
  const p1 = lat1Deg * r;
  const p2 = lat2Deg * r;
  const dp = p2 - p1;
  const dl = (lon2Deg - lon1Deg) * r;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Interpolate between two orbit poses at eased progress e ∈ [0,1]: shortest-path longitude and
 * heading, linear latitude/pitch, logarithmic range with a mid-flight "hop" so long flights rise
 * above the surface instead of skimming it. Output longitude is normalised to (-180, 180].
 */
export function interpolatePose(a: CamPose, b: CamPose, e: number): CamPose {
  const t = e < 0 ? 0 : Math.min(e, 1);
  let lon = a.lonDeg + shortestDeltaDeg(a.lonDeg, b.lonDeg) * t;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  if (lon === -180) lon = 180;
  const lat = a.latDeg + (b.latDeg - a.latDeg) * t;
  const la = Math.log(Math.max(1, a.rangeM));
  const lb = Math.log(Math.max(1, b.rangeM));
  const arcM = centralAngleRad(a.lonDeg, a.latDeg, b.lonDeg, b.latDeg) * 6371000;
  const peak = Math.max(a.rangeM, b.rangeM);
  const hopLog = arcM > peak ? Math.log(Math.min(arcM * 1.2, 2.5e7) / peak) : 0;
  const logR = la + (lb - la) * t + Math.max(0, hopLog) * Math.sin(Math.PI * t);
  return {
    lonDeg: lon,
    latDeg: lat,
    rangeM: Math.exp(logR),
    headingDeg: a.headingDeg + shortestDeltaDeg(a.headingDeg, b.headingDeg) * t,
    pitchDeg: a.pitchDeg + (b.pitchDeg - a.pitchDeg) * t,
  };
}

/** Flight duration (ms) scaled by distance: 900 ms short hops up to 2400 ms across the globe. */
export function flightDurationMs(a: CamPose, b: CamPose): number {
  const ang = centralAngleRad(a.lonDeg, a.latDeg, b.lonDeg, b.latDeg);
  const zoomRatio = Math.abs(Math.log(Math.max(1, b.rangeM) / Math.max(1, a.rangeM)));
  const k = Math.min(1, ang / Math.PI + zoomRatio / 10);
  return 900 + 1500 * k;
}

/**
 * Pan a pose by a screen drag of (dxPx, dyPx) CSS pixels ("grab" semantics: the ground follows the
 * pointer). Metres-per-pixel is approximated from range and vertical field of view. Returns the
 * east/north displacement in metres (caller converts with the geodesy helpers).
 */
export function dragToEastNorthMetres(
  dxPx: number,
  dyPx: number,
  viewportHeightPx: number,
  fovyRad: number,
  rangeM: number,
  headingDeg: number,
): { east: number; north: number } {
  const h = Math.max(1, viewportHeightPx);
  const mpp = (2 * rangeM * Math.tan(fovyRad / 2)) / h;
  const forwardM = dyPx * mpp; // drag down → move target forward
  const rightM = -dxPx * mpp; // drag right → move target left
  const r = (headingDeg * Math.PI) / 180;
  const s = Math.sin(r);
  const c = Math.cos(r);
  return { east: forwardM * s + rightM * c, north: forwardM * c - rightM * s };
}

/** Apply a small east/north displacement (metres) to lon/lat on a sphere of radius R. */
export function offsetLonLat(
  lonDeg: number,
  latDeg: number,
  eastM: number,
  northM: number,
  latClampDeg: number,
  radiusM = 6378137,
): { lonDeg: number; latDeg: number } {
  const d = 180 / Math.PI;
  let lat = latDeg + (northM / radiusM) * d;
  if (lat > latClampDeg) lat = latClampDeg;
  if (lat < -latClampDeg) lat = -latClampDeg;
  const cosLat = Math.max(1e-6, Math.cos((latDeg * Math.PI) / 180));
  let lon = lonDeg + (eastM / (radiusM * cosLat)) * d;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  if (lon === -180) lon = 180;
  return { lonDeg: lon, latDeg: lat };
}
