/**
 * Custom geodetic/ENU orbit-camera maths (spec §7, A2). Pure and deterministic: no clocks, no
 * randomness, no DOM/Cesium. renderer-globe feeds inputs + terrain samples in and applies the
 * returned pose (ECEF position/direction/up) to the Cesium camera.
 *
 * Conventions (match Cesium's HeadingPitchRange):
 *  - the state orbits a target point on the ellipsoid at (lonDeg, latDeg, targetHeightM = 0);
 *  - headingDeg: clockwise from local north, [0, 360);
 *  - pitchDeg: angle of the view direction above the local horizontal; −90 = straight down;
 *  - camera position = target − rangeM · viewDirection.
 */
import type { CameraConfig, Vec3 } from "../contracts";
import { clamp, clampLatDeg, degToRad, radToDeg, wrap360Deg, wrapLonDeg } from "../geodesy/angles";
import { rhumbDirect, type LonLatRad } from "../geodesy/rhumb";
import { ecefToGeodetic, enuBasis, geodeticToEcef, type EnuBasis, type Geodetic } from "../geodesy/transforms";
import { vec3, vec3Cross, vec3Dot, vec3Normalize, vec3Sub } from "../geodesy/vec3";

export interface OrbitCamState {
  lonDeg: number;
  latDeg: number;
  rangeM: number;
  headingDeg: number;
  pitchDeg: number;
}

/** Each axis in [−1, 1]. east/north: pan relative to heading (north = forward); zoom > 0 = in;
 *  rotate > 0 = heading increases (turn right); tilt > 0 = pitch increases (towards the horizon). */
export interface CamInput {
  east: number;
  north: number;
  zoom: number;
  rotate: number;
  tilt: number;
}

/** Controller tuning not covered by the shared `CameraConfig` contract (documented defaults). */
export interface CameraTuning {
  rotateRateDegPerS: number;
  tiltRateDegPerS: number;
  pitchMinDeg: number;
  pitchMaxDeg: number;
  /** Larger frame gaps (tab switch, stall) are clamped to this to avoid teleports. */
  maxDtS: number;
}

export const DEFAULT_CAMERA_TUNING: Readonly<CameraTuning> = Object.freeze({
  rotateRateDegPerS: 90,
  tiltRateDegPerS: 45,
  pitchMinDeg: -90,
  pitchMaxDeg: -10,
  maxDtS: 0.25,
});

export const ZERO_CAM_INPUT: Readonly<CamInput> = Object.freeze({ east: 0, north: 0, zoom: 0, rotate: 0, tilt: 0 });

function tuningOf(t?: Partial<CameraTuning>): CameraTuning {
  return t ? { ...DEFAULT_CAMERA_TUNING, ...t } : DEFAULT_CAMERA_TUNING;
}

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

function axis(v: number): number {
  return Number.isFinite(v) ? clamp(v, -1, 1) : 0;
}

/** Initial state from `cfg.home`. */
export function homeCamState(cfg: CameraConfig, tuning?: Partial<CameraTuning>): OrbitCamState {
  return sanitizeCamState(
    {
      lonDeg: cfg.home.lonDeg,
      latDeg: cfg.home.latDeg,
      rangeM: cfg.home.rangeM,
      headingDeg: cfg.home.headingDeg,
      pitchDeg: cfg.home.pitchDeg,
    },
    cfg,
    tuning,
  );
}

/**
 * Bring any state into the valid domain: non-finite fields fall back to `cfg.home`, longitude
 * wrapped to (−180, 180], latitude clamped to ±cfg.latClampDeg, range to [rangeMin, rangeMax],
 * heading wrapped to [0, 360), pitch to the tuning limits.
 */
export function sanitizeCamState(s: OrbitCamState, cfg: CameraConfig, tuning?: Partial<CameraTuning>): OrbitCamState {
  const t = tuningOf(tuning);
  const home = cfg.home;
  return {
    lonDeg: wrapLonDeg(finiteOr(s.lonDeg, finiteOr(home.lonDeg, 0))),
    latDeg: clampLatDeg(finiteOr(s.latDeg, finiteOr(home.latDeg, 0)), cfg.latClampDeg),
    rangeM: clamp(finiteOr(s.rangeM, finiteOr(home.rangeM, cfg.rangeMaxM)), cfg.rangeMinM, cfg.rangeMaxM),
    headingDeg: wrap360Deg(finiteOr(s.headingDeg, finiteOr(home.headingDeg, 0))),
    pitchDeg: clamp(finiteOr(s.pitchDeg, finiteOr(home.pitchDeg, -90)), t.pitchMinDeg, t.pitchMaxDeg),
  };
}

/** Surface pan speed v(h) = clamp(k·h, vMin, vMax) in m/s; h = camera height above the ellipsoid. */
export function panSpeedMps(heightM: number, cfg: CameraConfig): number {
  const h = Number.isFinite(heightM) ? Math.max(0, heightM) : 0;
  return clamp(cfg.k * h, cfg.vMinMps, cfg.vMaxMps);
}

// ---------------------------------------------------------------------------------------------
// Pose (state → ECEF/geodetic camera placement)

export interface GeodeticDeg {
  lonDeg: number;
  latDeg: number;
  heightM: number;
}

export interface CameraPose {
  /** Orbit target on the ellipsoid (+ targetHeightM). */
  targetEcef: Vec3;
  /** Camera position (after any height lift). */
  positionEcef: Vec3;
  /** Unit view direction (camera → target). */
  directionEcef: Vec3;
  /** Unit camera up, orthogonal to direction. */
  upEcef: Vec3;
  /** Unit camera right = direction × up. */
  rightEcef: Vec3;
  position: GeodeticDeg;
  target: GeodeticDeg;
  /** True if the camera was lifted to `minCameraHeightM`. */
  lifted: boolean;
}

export interface CameraPoseOptions {
  /** Ellipsoidal height of the orbit target (default 0). */
  targetHeightM?: number;
  /** If the camera's ellipsoidal height is below this, lift it along its geodetic normal to exactly
   *  this height and re-aim at the target (this is how a terrain clamp is applied). */
  minCameraHeightM?: number;
}

export function createCameraPose(): CameraPose {
  return {
    targetEcef: vec3(),
    positionEcef: vec3(),
    directionEcef: vec3(),
    upEcef: vec3(),
    rightEcef: vec3(),
    position: { lonDeg: 0, latDeg: 0, heightM: 0 },
    target: { lonDeg: 0, latDeg: 0, heightM: 0 },
    lifted: false,
  };
}

const scratchEnu: EnuBasis = { east: vec3(), north: vec3(), up: vec3() };
const scratchGeo: Geodetic = { lonRad: 0, latRad: 0, heightM: 0 };
const scratchV: Vec3 = vec3();

/**
 * Convert an orbit state into a camera pose in ECEF + geodetic. Uses the state as-is (call
 * `sanitizeCamState` first if it may be invalid). Direction/up follow Cesium's lookAt with
 * HeadingPitchRange, so `camera.setView({ destination: positionEcef, orientation: { direction, up } })`
 * reproduces it.
 */
export function cameraPoseFromState(s: OrbitCamState, opts?: CameraPoseOptions, out?: CameraPose): CameraPose {
  const pose = out ?? createCameraPose();
  const targetH = finiteOr(opts?.targetHeightM ?? 0, 0);
  const lon = degToRad(s.lonDeg);
  const lat = degToRad(s.latDeg);
  const hd = degToRad(s.headingDeg);
  const pt = degToRad(s.pitchDeg);
  const sh = Math.sin(hd);
  const ch = Math.cos(hd);
  const sp = Math.sin(pt);
  const cp = Math.cos(pt);

  geodeticToEcef(lon, lat, targetH, pose.targetEcef);
  const { east: e, north: n, up: u } = enuBasis(lon, lat, scratchEnu);

  // forward (ENU) = (sinH cosP, cosH cosP, sinP); up (ENU) = (−sinH sinP, −cosH sinP, cosP)
  const fx = sh * cp;
  const fy = ch * cp;
  const fz = sp;
  const d = pose.directionEcef;
  d.x = e.x * fx + n.x * fy + u.x * fz;
  d.y = e.y * fx + n.y * fy + u.y * fz;
  d.z = e.z * fx + n.z * fy + u.z * fz;
  const ux = -sh * sp;
  const uy = -ch * sp;
  const uz = cp;
  const up = pose.upEcef;
  up.x = e.x * ux + n.x * uy + u.x * uz;
  up.y = e.y * ux + n.y * uy + u.y * uz;
  up.z = e.z * ux + n.z * uy + u.z * uz;

  const r = s.rangeM;
  const c = pose.positionEcef;
  c.x = pose.targetEcef.x - r * d.x;
  c.y = pose.targetEcef.y - r * d.y;
  c.z = pose.targetEcef.z - r * d.z;

  let g = ecefToGeodetic(c, scratchGeo);
  pose.lifted = false;
  const minH = opts?.minCameraHeightM;
  if (minH !== undefined && Number.isFinite(minH) && g.heightM < minH) {
    // Lift along the camera's own geodetic normal (keeps its lon/lat), then re-aim at the target.
    const dh = minH - g.heightM;
    const cl = Math.cos(g.latRad);
    c.x += dh * cl * Math.cos(g.lonRad);
    c.y += dh * cl * Math.sin(g.lonRad);
    c.z += dh * Math.sin(g.latRad);
    vec3Normalize(vec3Sub(pose.targetEcef, c, scratchV), d);
    // Re-orthogonalise the previous up against the new direction.
    const k = vec3Dot(up, d);
    up.x -= k * d.x;
    up.y -= k * d.y;
    up.z -= k * d.z;
    vec3Normalize(up, up);
    g = ecefToGeodetic(c, scratchGeo);
    pose.lifted = true;
  }
  vec3Cross(d, up, pose.rightEcef);

  pose.position.lonDeg = radToDeg(g.lonRad);
  pose.position.latDeg = radToDeg(g.latRad);
  pose.position.heightM = g.heightM;
  pose.target.lonDeg = s.lonDeg;
  pose.target.latDeg = s.latDeg;
  pose.target.heightM = targetH;
  return pose;
}

const scratchPose = createCameraPose();

/** Exact ellipsoidal height of the camera for this state (target at `targetHeightM`, default 0). */
export function cameraHeightM(s: OrbitCamState, targetHeightM = 0): number {
  return cameraPoseFromState(s, { targetHeightM }, scratchPose).position.heightM;
}

// ---------------------------------------------------------------------------------------------
// Stepping

const scratchLL: LonLatRad = { lonRad: 0, latRad: 0 };

/**
 * Advance the orbit camera by one frame.
 *  1. pan: surface-tangent motion in the local East–North plane rotated by heading, speed
 *     v(h) = clamp(k·h, vMin, vMax) with h = current camera height; the |(east,north)| magnitude is
 *     capped at 1 (diagonals are not faster). The step follows the WGS84 rhumb line at that
 *     azimuth (exact meridian arc / isometric latitude), so motion is path-consistent — no
 *     frame-rate-dependent drift — and the map orientation (heading) is preserved. Latitude is
 *     walled at ±cfg.latClampDeg (east–west remainder slides along the wall); longitude wraps ±180.
 *  2. zoom: r' = r·e^(−zoom·zoomRatePerS·dt), clamped to [rangeMin, rangeMax].
 *  3. rotate/tilt: heading wraps [0, 360); pitch clamped to [pitchMin, pitchMax].
 * dt is clamped to [0, tuning.maxDtS]; non-finite inputs are treated as 0.
 */
export function stepCamera(
  s: OrbitCamState,
  input: CamInput,
  dtS: number,
  cfg: CameraConfig,
  tuning?: Partial<CameraTuning>,
): OrbitCamState {
  const t = tuningOf(tuning);
  const st = sanitizeCamState(s, cfg, t);
  const dt = Number.isFinite(dtS) ? clamp(dtS, 0, t.maxDtS) : 0;
  if (dt === 0) return st;

  let east = axis(input.east);
  let north = axis(input.north);
  const zoom = axis(input.zoom);
  const rotate = axis(input.rotate);
  const tilt = axis(input.tilt);

  let lonDeg = st.lonDeg;
  let latDeg = st.latDeg;
  const mag = Math.sqrt(east * east + north * north);
  if (mag > 0) {
    if (mag > 1) {
      east /= mag;
      north /= mag;
    }
    const v = panSpeedMps(cameraHeightM(st), cfg);
    const dist = v * Math.min(1, mag) * dt;
    const az = degToRad(st.headingDeg) + Math.atan2(east, north);
    const ll = rhumbDirect(degToRad(lonDeg), degToRad(latDeg), az, dist, degToRad(cfg.latClampDeg), scratchLL);
    lonDeg = wrapLonDeg(radToDeg(ll.lonRad));
    latDeg = clampLatDeg(radToDeg(ll.latRad), cfg.latClampDeg);
  }

  const rangeM = clamp(st.rangeM * Math.exp(-zoom * cfg.zoomRatePerS * dt), cfg.rangeMinM, cfg.rangeMaxM);
  const headingDeg = wrap360Deg(st.headingDeg + rotate * t.rotateRateDegPerS * dt);
  const pitchDeg = clamp(st.pitchDeg + tilt * t.tiltRateDegPerS * dt, t.pitchMinDeg, t.pitchMaxDeg);

  return { lonDeg, latDeg, rangeM, headingDeg, pitchDeg };
}

/**
 * Discrete wheel/pinch zoom: r' = r·e^(−notches·wheelZoomStep), clamped. notches > 0 = zoom in
 * (renderer maps DOM `deltaY < 0` to positive notches).
 */
export function wheelZoom(
  s: OrbitCamState,
  notches: number,
  cfg: CameraConfig,
  tuning?: Partial<CameraTuning>,
): OrbitCamState {
  const st = sanitizeCamState(s, cfg, tuning);
  const n = Number.isFinite(notches) ? notches : 0;
  return { ...st, rangeM: clamp(st.rangeM * Math.exp(-n * cfg.wheelZoomStep), cfg.rangeMinM, cfg.rangeMaxM) };
}

// ---------------------------------------------------------------------------------------------
// Terrain collision clamp

export interface HeightClampResult {
  /** Clamped camera ellipsoidal height: max(desired, floorM). */
  heightM: number;
  /** Updated last-known terrain: max of this frame's defined samples (unchanged if none). */
  lastKnownTerrainM: number;
  /** max(maxTerrain + minClearance, minEllipsoidalHeight). */
  floorM: number;
  /** True if the desired height was raised (or was not finite). */
  clamped: boolean;
}

/**
 * Terrain collision clamp (spec §7). At least `cfg.terrainSamples` samples are evaluated; missing
 * entries and `undefined`/non-finite samples (unloaded tiles) count as `lastKnownTerrainM`.
 *   floor = max(maxTerrain + minClearanceM, minEllipsoidalHeightM);  heightM = max(desired, floor)
 * A non-finite `lastKnownTerrainM` is treated as 0 m; a non-finite desired height yields `floor`.
 */
export function clampCameraHeight(
  desiredHeightM: number,
  terrainSamplesM: ReadonlyArray<number | undefined>,
  lastKnownTerrainM: number,
  cfg: CameraConfig,
): HeightClampResult {
  const last = Number.isFinite(lastKnownTerrainM) ? lastKnownTerrainM : 0;
  const count = Math.max(terrainSamplesM.length, Math.max(0, Math.floor(cfg.terrainSamples)));
  let maxTerrain = Number.NEGATIVE_INFINITY;
  let maxDefined = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const v = i < terrainSamplesM.length ? terrainSamplesM[i] : undefined;
    let h: number;
    if (v !== undefined && Number.isFinite(v)) {
      h = v;
      if (v > maxDefined) maxDefined = v;
    } else {
      h = last;
    }
    if (h > maxTerrain) maxTerrain = h;
  }
  if (count === 0) maxTerrain = last;
  const floorM = Math.max(maxTerrain + cfg.minClearanceM, cfg.minEllipsoidalHeightM);
  const desiredOk = Number.isFinite(desiredHeightM);
  const heightM = desiredOk ? Math.max(desiredHeightM, floorM) : floorM;
  return {
    heightM,
    lastKnownTerrainM: maxDefined > Number.NEGATIVE_INFINITY ? maxDefined : last,
    floorM,
    clamped: !desiredOk || heightM > desiredHeightM,
  };
}

export interface SegmentSample {
  lonRad: number;
  latRad: number;
  /** Ellipsoidal height of the segment point itself. */
  heightM: number;
}

/**
 * `count` (≥ 2) evenly spaced geodetic points on the camera→target segment, camera first. Feed
 * their lon/lat (radians, as Cesium.Cartographic) to `globe.getHeight` and the results to
 * {@link clampCameraHeight}.
 */
export function cameraSegmentSamples(pose: CameraPose, count: number, out?: SegmentSample[]): SegmentSample[] {
  const n = Math.max(2, Math.floor(Number.isFinite(count) ? count : 2));
  const arr = out ?? [];
  arr.length = n;
  const c = pose.positionEcef;
  const t0 = pose.targetEcef;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    scratchV.x = c.x + (t0.x - c.x) * t;
    scratchV.y = c.y + (t0.y - c.y) * t;
    scratchV.z = c.z + (t0.z - c.z) * t;
    const g = ecefToGeodetic(scratchV, scratchGeo);
    const slot = arr[i] ?? { lonRad: 0, latRad: 0, heightM: 0 };
    slot.lonRad = g.lonRad;
    slot.latRad = g.latRad;
    slot.heightM = g.heightM;
    arr[i] = slot;
  }
  return arr;
}

/** Terrain height sampler: undefined = tile not loaded. */
export type TerrainSampler = (lonRad: number, latRad: number) => number | undefined;

export interface CameraFrame {
  pose: CameraPose;
  clamp: HeightClampResult;
}

/**
 * One full frame of camera placement: pose → segment samples → terrain clamp → lifted pose.
 * Pure as long as `sampler` is. The renderer passes `scene.globe.getHeight` wrapped as a sampler.
 */
export function solveCameraFrame(
  s: OrbitCamState,
  cfg: CameraConfig,
  sampler: TerrainSampler,
  lastKnownTerrainM: number,
  opts?: { targetHeightM?: number; samples?: SegmentSample[]; out?: CameraPose },
): CameraFrame {
  const pose = cameraPoseFromState(s, { targetHeightM: opts?.targetHeightM }, opts?.out);
  const samples = cameraSegmentSamples(pose, Math.max(2, cfg.terrainSamples), opts?.samples);
  const heights: (number | undefined)[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const smp = samples[i] as SegmentSample;
    heights[i] = sampler(smp.lonRad, smp.latRad);
  }
  const res = clampCameraHeight(pose.position.heightM, heights, lastKnownTerrainM, cfg);
  if (res.heightM > pose.position.heightM) {
    cameraPoseFromState(s, { targetHeightM: opts?.targetHeightM, minCameraHeightM: res.heightM }, pose);
  }
  return { pose, clamp: res };
}
