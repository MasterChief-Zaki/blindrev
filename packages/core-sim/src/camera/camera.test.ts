import { describe, expect, it } from "vitest";
import cameraJson from "../../../../data/prefabs/camera.json";
import { type CameraConfig, parseCameraConfig } from "../contracts";
import { degToRad, ecefToGeodetic, geodeticToEcef, rhumbInverse, vec3Distance, vec3Dot, vec3Length } from "../geodesy";
import {
  type CamInput,
  DEFAULT_CAMERA_TUNING,
  type OrbitCamState,
  type TerrainSampler,
  ZERO_CAM_INPUT,
  cameraHeightM,
  cameraPoseFromState,
  cameraSegmentSamples,
  clampCameraHeight,
  homeCamState,
  panSpeedMps,
  sanitizeCamState,
  solveCameraFrame,
  stepCamera,
  wheelZoom,
} from "./index";

const cfg: CameraConfig = parseCameraConfig(cameraJson, "data/prefabs/camera.json");

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const input = (p: Partial<CamInput>): CamInput => ({ ...ZERO_CAM_INPUT, ...p });
const st = (p: Partial<OrbitCamState>): OrbitCamState => ({
  lonDeg: 0,
  latDeg: 0,
  rangeM: 10000,
  headingDeg: 0,
  pitchDeg: -90,
  ...p,
});

function groundDistance(a: OrbitCamState, b: OrbitCamState): number {
  return vec3Distance(
    geodeticToEcef(degToRad(a.lonDeg), degToRad(a.latDeg), 0),
    geodeticToEcef(degToRad(b.lonDeg), degToRad(b.latDeg), 0),
  );
}

function expectValid(s: OrbitCamState): void {
  for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
  expect(s.lonDeg).toBeGreaterThan(-180);
  expect(s.lonDeg).toBeLessThanOrEqual(180);
  expect(Math.abs(s.latDeg)).toBeLessThanOrEqual(cfg.latClampDeg);
  expect(s.rangeM).toBeGreaterThanOrEqual(cfg.rangeMinM);
  expect(s.rangeM).toBeLessThanOrEqual(cfg.rangeMaxM);
  expect(s.headingDeg).toBeGreaterThanOrEqual(0);
  expect(s.headingDeg).toBeLessThan(360);
  expect(s.pitchDeg).toBeGreaterThanOrEqual(DEFAULT_CAMERA_TUNING.pitchMinDeg);
  expect(s.pitchDeg).toBeLessThanOrEqual(DEFAULT_CAMERA_TUNING.pitchMaxDeg);
}

describe("config + sanitising", () => {
  it("prefab parses and home state is valid", () => {
    expect(cfg.latClampDeg).toBe(89.5);
    const h = homeCamState(cfg);
    expectValid(h);
    expect(h.rangeM).toBe(cfg.home.rangeM);
  });
  it("sanitises NaN/out-of-range state", () => {
    const s = sanitizeCamState({ lonDeg: 540, latDeg: 95, rangeM: Number.NaN, headingDeg: -30, pitchDeg: 20 }, cfg);
    expect(s.lonDeg).toBe(180);
    expect(s.latDeg).toBe(89.5);
    expect(s.rangeM).toBe(cfg.home.rangeM);
    expect(s.headingDeg).toBe(330);
    expect(s.pitchDeg).toBe(DEFAULT_CAMERA_TUNING.pitchMaxDeg);
  });
});

describe("speed law and pose", () => {
  it("v(h) = clamp(k·h, vMin, vMax)", () => {
    expect(panSpeedMps(0, cfg)).toBe(cfg.vMinMps);
    expect(panSpeedMps(100, cfg)).toBe(cfg.vMinMps);
    expect(panSpeedMps(10000, cfg)).toBeCloseTo(1000, 9);
    expect(panSpeedMps(1e9, cfg)).toBe(cfg.vMaxMps);
    expect(panSpeedMps(Number.NaN, cfg)).toBe(cfg.vMinMps);
  });
  it("top-down camera height equals range; pose is orthonormal", () => {
    const s = st({ lonDeg: 33, latDeg: -71, rangeM: 12345, headingDeg: 77 });
    expect(cameraHeightM(s)).toBeCloseTo(12345, 6);
    const pose = cameraPoseFromState(s);
    expect(vec3Length(pose.directionEcef)).toBeCloseTo(1, 12);
    expect(vec3Length(pose.upEcef)).toBeCloseTo(1, 12);
    expect(vec3Dot(pose.directionEcef, pose.upEcef)).toBeCloseTo(0, 12);
    expect(vec3Distance(pose.positionEcef, pose.targetEcef)).toBeCloseTo(12345, 6);
  });
  it("heading 0 / pitch −45: camera sits south of the target looking north (Cesium HPR)", () => {
    const pose = cameraPoseFromState(st({ latDeg: 10, rangeM: 100000, pitchDeg: -45 }));
    expect(pose.position.latDeg).toBeLessThan(10);
    expect(Math.abs(pose.position.lonDeg)).toBeLessThan(1e-9);
    expect(pose.position.heightM).toBeGreaterThan(60000);
    const toTarget = {
      x: pose.targetEcef.x - pose.positionEcef.x,
      y: pose.targetEcef.y - pose.positionEcef.y,
      z: pose.targetEcef.z - pose.positionEcef.z,
    };
    expect(vec3Dot(toTarget, pose.directionEcef)).toBeCloseTo(100000, 4);
  });
  it("minCameraHeightM lifts along the camera normal and re-aims", () => {
    const s = st({ rangeM: 1000, pitchDeg: -30 });
    const pose = cameraPoseFromState(s, { minCameraHeightM: 5000 });
    expect(pose.lifted).toBe(true);
    expect(pose.position.heightM).toBeCloseTo(5000, 6);
    expect(vec3Dot(pose.directionEcef, pose.upEcef)).toBeCloseTo(0, 12);
    const toT = {
      x: pose.targetEcef.x - pose.positionEcef.x,
      y: pose.targetEcef.y - pose.positionEcef.y,
      z: pose.targetEcef.z - pose.positionEcef.z,
    };
    expect(vec3Dot(toT, pose.directionEcef) / vec3Length(toT)).toBeCloseTo(1, 12);
  });
});

describe("stepCamera", () => {
  it("pans along heading: forward = heading direction, right = heading + 90°", () => {
    const s0 = st({ rangeM: 10000 });
    const n = stepCamera(s0, input({ north: 1 }), 0.1, cfg);
    expect(n.latDeg).toBeGreaterThan(0);
    expect(Math.abs(n.lonDeg)).toBeLessThan(1e-12);
    const e = stepCamera({ ...s0, headingDeg: 90 }, input({ north: 1 }), 0.1, cfg);
    expect(e.lonDeg).toBeGreaterThan(0);
    expect(Math.abs(e.latDeg)).toBeLessThan(1e-12);
    const r = stepCamera(s0, input({ east: 1 }), 0.1, cfg);
    expect(r.lonDeg).toBeGreaterThan(0);
  });
  it("speed: 1000 m/s at 10 km height (k = 0.1)", () => {
    let s = st({ rangeM: 10000, latDeg: 45, headingDeg: 30 });
    const s0 = s;
    for (let i = 0; i < 4; i++) s = stepCamera(s, input({ north: 1 }), 0.25, cfg);
    const inv = rhumbInverse(degToRad(s0.lonDeg), degToRad(s0.latDeg), degToRad(s.lonDeg), degToRad(s.latDeg));
    expect(inv.distM).toBeCloseTo(1000, 6);
    expect(inv.azimuthRad).toBeCloseTo(degToRad(30), 9);
  });
  it("diagonal input is not faster than axial", () => {
    const s0 = st({ rangeM: 10000 });
    const d = stepCamera(s0, input({ north: 1, east: 1 }), 0.1, cfg);
    const a = stepCamera(s0, input({ north: 1 }), 0.1, cfg);
    expect(groundDistance(s0, d)).toBeCloseTo(groundDistance(s0, a), 6);
  });
  it("frame-rate independent (no drift): 1×0.2 s == 20×0.01 s == 200×0.001 s", () => {
    const s0 = st({ lonDeg: 12, latDeg: 63, rangeM: 2e5, headingDeg: 57 });
    const inp = input({ north: 0.8, east: -0.35 });
    const one = stepCamera(s0, inp, 0.2, cfg);
    let many = s0;
    for (let i = 0; i < 20; i++) many = stepCamera(many, inp, 0.01, cfg);
    let lots = s0;
    for (let i = 0; i < 200; i++) lots = stepCamera(lots, inp, 0.001, cfg);
    expect(groundDistance(one, many)).toBeLessThan(1e-6);
    expect(groundDistance(one, lots)).toBeLessThan(1e-6);
    expect(groundDistance(s0, one)).toBeGreaterThan(3000);
  });
  it("pan east then west returns to the start; latitude does not drift", () => {
    let s = st({ lonDeg: 100, latDeg: 70, rangeM: 5e5 });
    for (let i = 0; i < 600; i++) s = stepCamera(s, input({ east: 1 }), 1 / 60, cfg);
    expect(s.latDeg).toBe(70);
    for (let i = 0; i < 600; i++) s = stepCamera(s, input({ east: -1 }), 1 / 60, cfg);
    expect(s.latDeg).toBe(70);
    expect(Math.abs(s.lonDeg - 100)).toBeLessThan(1e-9);
  });
  it("logarithmic zoom r' = r·e^(±Δz) with clamps", () => {
    const s0 = st({ rangeM: 1e6 });
    const z = stepCamera(s0, input({ zoom: 1 }), 0.2, cfg);
    expect(z.rangeM).toBeCloseTo(1e6 * Math.exp(-cfg.zoomRatePerS * 0.2), 4);
    const zo = stepCamera(s0, input({ zoom: -0.5 }), 0.2, cfg);
    expect(zo.rangeM).toBeCloseTo(1e6 * Math.exp(0.5 * cfg.zoomRatePerS * 0.2), 4);
    let s = s0;
    for (let i = 0; i < 1000; i++) s = stepCamera(s, input({ zoom: 1 }), 0.1, cfg);
    expect(s.rangeM).toBe(cfg.rangeMinM);
    for (let i = 0; i < 1000; i++) s = stepCamera(s, input({ zoom: -1 }), 0.1, cfg);
    expect(s.rangeM).toBe(cfg.rangeMaxM);
  });
  it("wheelZoom: notches > 0 zooms in by e^(−step)", () => {
    const s0 = st({ rangeM: 1e5 });
    expect(wheelZoom(s0, 1, cfg).rangeM).toBeCloseTo(1e5 * Math.exp(-cfg.wheelZoomStep), 6);
    expect(wheelZoom(s0, -2, cfg).rangeM).toBeCloseTo(1e5 * Math.exp(2 * cfg.wheelZoomStep), 6);
    expect(wheelZoom(s0, 1e6, cfg).rangeM).toBe(cfg.rangeMinM);
    expect(wheelZoom(s0, Number.NaN, cfg).rangeM).toBe(1e5);
  });
  it("rotate wraps heading, tilt respects pitch limits", () => {
    let s = st({ headingDeg: 350 });
    s = stepCamera(s, input({ rotate: 1 }), 0.2, cfg);
    expect(s.headingDeg).toBeCloseTo(8, 9);
    s = stepCamera(s, input({ rotate: -1 }), 0.2, cfg);
    expect(s.headingDeg).toBeCloseTo(350, 9);
    for (let i = 0; i < 100; i++) s = stepCamera(s, input({ tilt: 1 }), 0.1, cfg);
    expect(s.pitchDeg).toBe(DEFAULT_CAMERA_TUNING.pitchMaxDeg);
    for (let i = 0; i < 100; i++) s = stepCamera(s, input({ tilt: -1 }), 0.1, cfg);
    expect(s.pitchDeg).toBe(DEFAULT_CAMERA_TUNING.pitchMinDeg);
  });
  it("dt sanitising: NaN/negative → no-op, huge → clamped to maxDtS", () => {
    const s0 = st({ rangeM: 10000 });
    expect(stepCamera(s0, input({ north: 1 }), Number.NaN, cfg)).toEqual(s0);
    expect(stepCamera(s0, input({ north: 1 }), -1, cfg)).toEqual(s0);
    const big = stepCamera(s0, input({ north: 1 }), 100, cfg);
    const cap = stepCamera(s0, input({ north: 1 }), DEFAULT_CAMERA_TUNING.maxDtS, cfg);
    expect(big).toEqual(cap);
    const nanIn = stepCamera(
      s0,
      { east: Number.NaN, north: Number.POSITIVE_INFINITY, zoom: 0, rotate: 0, tilt: 0 },
      0.1,
      cfg,
    );
    expectValid(nanIn);
  });
});

describe("A2 adversarial: poles (|φ| ≥ 89.5°)", () => {
  it("holding north towards either pole stops exactly at the clamp, never NaN", () => {
    for (const [lat0, heading] of [
      [89.4, 0],
      [-89.4, 180],
      [89.9, 0],
      [-90, 180],
      [95, 45],
    ] as const) {
      let s = st({ latDeg: lat0, rangeM: 3e6, headingDeg: heading });
      for (let i = 0; i < 400; i++) {
        s = stepCamera(s, input({ north: 1 }), 1 / 30, cfg);
        expectValid(s);
      }
      expect(Math.abs(s.latDeg)).toBe(89.5);
    }
  });
  it("east-west motion along the clamp parallel works and circles the pole", () => {
    let s = st({ latDeg: 89.5, rangeM: 1e6 });
    const lons: number[] = [];
    for (let i = 0; i < 600; i++) {
      s = stepCamera(s, input({ east: 1, north: 0.5 }), 1 / 60, cfg);
      expectValid(s);
      lons.push(s.lonDeg);
    }
    expect(s.latDeg).toBe(89.5);
    expect(new Set(lons).size).toBeGreaterThan(500);
    const pose = cameraPoseFromState({ ...s, pitchDeg: -20, headingDeg: 0 });
    expect(Number.isFinite(pose.position.heightM)).toBe(true);
    expect(pose.position.latDeg).toBeLessThanOrEqual(90);
  });
  it("orbit pose over the pole (camera beyond 90°) stays finite", () => {
    const pose = cameraPoseFromState(st({ latDeg: 89.5, headingDeg: 180, pitchDeg: -10, rangeM: 2.5e7 }));
    for (const v of [pose.positionEcef.x, pose.positionEcef.y, pose.positionEcef.z, pose.position.heightM]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("A2 adversarial: antimeridian", () => {
  it("eastward crossing 180 → −180 and back westward", () => {
    let s = st({ lonDeg: 179.95, latDeg: -15, rangeM: 1e5 });
    let crossed = false;
    for (let i = 0; i < 120; i++) {
      const prev = s.lonDeg;
      s = stepCamera(s, input({ east: 1 }), 1 / 60, cfg);
      expectValid(s);
      if (prev > 0 && s.lonDeg < 0) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(s.lonDeg).toBeLessThan(-179);
    let back = false;
    for (let i = 0; i < 120; i++) {
      const prev = s.lonDeg;
      s = stepCamera(s, input({ east: -1 }), 1 / 60, cfg);
      expectValid(s);
      if (prev < 0 && s.lonDeg > 0) back = true;
    }
    expect(back).toBe(true);
    expect(Math.abs(s.lonDeg - 179.95)).toBeLessThan(1e-9);
  });
  it("diagonal crossing at high latitude and max speed stays continuous", () => {
    let s = st({ lonDeg: -179.9, latDeg: 80, rangeM: cfg.rangeMaxM, headingDeg: 300 });
    for (let i = 0; i < 300; i++) {
      const prev = s;
      s = stepCamera(s, input({ north: 1 }), 1 / 60, cfg);
      expectValid(s);
      // continuity on the sphere: per-frame ground motion ≤ v·dt (+ slide) — never a 360° jump
      expect(groundDistance(prev, s)).toBeLessThan((cfg.vMaxMps / 60) * 1.01);
    }
  });
});

describe("clampCameraHeight", () => {
  it("floor = max(maxTerrain + clearance, minEllipsoidal)", () => {
    const r = clampCameraHeight(1000, [10, 20, 30, 40, 50], 0, cfg);
    expect(r.floorM).toBe(cfg.minEllipsoidalHeightM);
    expect(r.heightM).toBe(1000);
    expect(r.clamped).toBe(false);
    expect(r.lastKnownTerrainM).toBe(50);
    const m = clampCameraHeight(1000, [100, 2000, 300, 0, -50], 0, cfg);
    expect(m.floorM).toBe(2000 + cfg.minClearanceM);
    expect(m.heightM).toBe(2250);
    expect(m.clamped).toBe(true);
  });
  it("undefined samples (unloaded tiles) use last-known terrain + clearance", () => {
    const r = clampCameraHeight(600, [undefined, undefined, undefined, undefined, undefined], 3000, cfg);
    expect(r.heightM).toBe(3000 + cfg.minClearanceM);
    expect(r.lastKnownTerrainM).toBe(3000);
    const p = clampCameraHeight(600, [100, undefined, 50, undefined, 75], 1200, cfg);
    expect(p.heightM).toBe(1200 + cfg.minClearanceM);
    expect(p.lastKnownTerrainM).toBe(100);
  });
  it("fewer than terrainSamples samples: missing ones count as last-known", () => {
    const r = clampCameraHeight(100, [10], 900, cfg);
    expect(r.floorM).toBe(900 + cfg.minClearanceM);
    const e = clampCameraHeight(100, [], 900, cfg);
    expect(e.floorM).toBe(900 + cfg.minClearanceM);
  });
  it("NaN handling: NaN samples = unloaded; NaN lastKnown = 0; NaN desired = floor", () => {
    const r = clampCameraHeight(Number.NaN, [Number.NaN, 400, Number.POSITIVE_INFINITY, 0, 0], Number.NaN, cfg);
    expect(r.heightM).toBe(650);
    expect(r.clamped).toBe(true);
    expect(r.lastKnownTerrainM).toBe(400);
  });
  it("terrain-gap sequence: last-known is carried through gaps, then refreshed", () => {
    const seq: (number | undefined)[][] = [
      [1500, 1500, 1500, 1500, 1500],
      [undefined, undefined, undefined, undefined, undefined],
      [undefined, 1600, undefined, undefined, undefined],
      [undefined, undefined, undefined, undefined, undefined],
      [200, 200, 200, 200, 200],
    ];
    let last = 0;
    const heights: number[] = [];
    for (const smp of seq) {
      const r = clampCameraHeight(0, smp, last, cfg);
      last = r.lastKnownTerrainM;
      heights.push(r.heightM);
    }
    expect(heights).toEqual([1750, 1750, 1850, 1850, 500]);
  });
  it("steep slope sample sets: the max sample governs", () => {
    const slope = [0, 250, 3000, 6000, 8848];
    expect(clampCameraHeight(100, slope, 0, cfg).heightM).toBe(8848 + cfg.minClearanceM);
    expect(clampCameraHeight(100, slope.slice().reverse(), 0, cfg).heightM).toBe(8848 + cfg.minClearanceM);
    expect(clampCameraHeight(100, [-430, -420, -400, -430, -430], 0, cfg).heightM).toBe(cfg.minEllipsoidalHeightM);
  });
});

describe("A2 adversarial: solveCameraFrame + long random walk", () => {
  // Synthetic terrain: a 7 km cliff band, a 9 km spike field near the pole and the antimeridian,
  // gentle relief elsewhere.
  const truth = (lonRad: number, latRad: number): number => {
    const lon = (lonRad * 180) / Math.PI;
    const lat = (latRad * 180) / Math.PI;
    let h = 300 * Math.sin(lon * 0.7) * Math.cos(lat * 1.3);
    if (lon > 10 && lon < 10.5) h = 7000;
    if (Math.abs(lon) > 179.5 && Math.floor(lat * 20) % 2 === 0) h = 9000;
    if (lat > 89) h = 4000 + 3000 * Math.sin(lon * 0.3);
    return h;
  };

  it("segment samples run camera → target", () => {
    const pose = cameraPoseFromState(st({ latDeg: 5, rangeM: 1e5, pitchDeg: -30 }));
    const smp = cameraSegmentSamples(pose, cfg.terrainSamples);
    expect(smp.length).toBe(cfg.terrainSamples);
    const first = smp[0];
    const last = smp[smp.length - 1];
    expect(first && Math.abs(first.heightM - pose.position.heightM)).toBeLessThan(1e-6);
    expect(last && Math.abs(last.heightM)).toBeLessThan(1e-6);
  });

  it("cliff under a low camera: lifted to cliff + clearance", () => {
    const s = st({ lonDeg: 10.2, latDeg: 0, rangeM: cfg.rangeMinM, pitchDeg: -90 });
    const f = solveCameraFrame(s, cfg, truth, 0);
    expect(f.pose.position.heightM).toBeGreaterThanOrEqual(7000 + cfg.minClearanceM - 1e-6);
    expect(f.pose.lifted).toBe(true);
  });

  it("20 000-frame random walk with gaps, poles, antimeridian, NaN dt: never NaN, never under the clamp", () => {
    const rand = rng(20261115);
    let s: OrbitCamState = st({ lonDeg: 179.7, latDeg: 88.8, rangeM: 5000, headingDeg: 10, pitchDeg: -40 });
    let last = 0;
    let gapRun = 0;
    let minMargin = Number.POSITIVE_INFINITY;
    let checked = 0;
    for (let i = 0; i < 20000; i++) {
      if (i % 500 === 0) gapRun = rand() < 0.4 ? Math.floor(rand() * 60) : 0;
      const inGap = gapRun > 0;
      if (gapRun > 0) gapRun--;
      const sampler: TerrainSampler = (lo, la) => (inGap || rand() < 0.1 ? undefined : truth(lo, la));
      const inp: CamInput = {
        east: rand() * 2 - 1,
        north: i % 3000 < 1000 ? 1 : rand() * 2 - 1,
        zoom: rand() < 0.5 ? rand() * 2 - 1 : 0.8,
        rotate: rand() * 2 - 1,
        tilt: rand() * 2 - 1,
      };
      const r = rand();
      const dt = r < 0.01 ? Number.NaN : r < 0.02 ? -0.5 : r < 0.03 ? 5 : rand() * 0.05;
      s = stepCamera(s, inp, dt, cfg);
      expectValid(s);
      let callIdx = 0;
      let nadirKnown = false;
      const wrapped: TerrainSampler = (lo, la) => {
        const v = sampler(lo, la);
        if (callIdx === 0) nadirKnown = v !== undefined;
        callIdx++;
        return v;
      };
      const f = solveCameraFrame(s, cfg, wrapped, last);
      const h = f.pose.position.heightM;
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(f.clamp.floorM - 1e-6);
      expect(h).toBeGreaterThanOrEqual(cfg.minEllipsoidalHeightM - 1e-6);
      // whenever the camera's own nadir terrain was known this frame, clearance holds against truth
      const g = ecefToGeodetic(f.pose.positionEcef);
      const t = truth(g.lonRad, g.latRad);
      if (nadirKnown) {
        checked++;
        minMargin = Math.min(minMargin, h - Math.max(t + cfg.minClearanceM, cfg.minEllipsoidalHeightM));
      }
      last = f.clamp.lastKnownTerrainM;
      for (const v of [f.pose.directionEcef.x, f.pose.upEcef.y, f.pose.positionEcef.z]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    // camera nadir sample is index 0, so with known terrain the margin is never negative
    expect(checked).toBeGreaterThan(10000);
    expect(minMargin).toBeGreaterThanOrEqual(-1e-6);
  });
});
