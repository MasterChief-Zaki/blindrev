import * as satellite from "satellite.js";
import { describe, expect, it } from "vitest";
import tleJson from "../../../../data/tle/nisar-65053.snapshot.json";
import { parseTleSnapshot } from "../contracts";
import { EARTH_ROTATION_RATE_RAD_S, degToRad, ecefToGeodetic, radToDeg, vec3Cross, vec3Length } from "../geodesy";
import {
  type OrbitState,
  type Tle,
  ecefToTeme,
  ephemerisStatus,
  gmstRad,
  nadirGroundTrack,
  propagateTle,
  splitTrackAtAntimeridian,
  temeToEcef,
  temeVelocityToEcef,
  tleEpoch,
  tleFromSnapshot,
  tleInclinationDeg,
  tlePeriodMinutes,
} from "./index";

const snapshot = parseTleSnapshot(tleJson, "data/tle/nisar-65053.snapshot.json");
const NISAR: Tle = tleFromSnapshot(snapshot);
const EPOCH_ISO = "2026-11-15T12:25:21.122Z";
const HOUR = 3_600_000;

// Fixed clocks only (no Date.now()).
const T0 = new Date(EPOCH_ISO);
const EPOCHS = [0, 0.37, 6, 23.9, -5].map((h) => new Date(T0.getTime() + h * HOUR));

describe("TLE parsing & staleness", () => {
  it("bundled snapshot is the ARCHITECTURE §3 NISAR TLE", () => {
    expect(NISAR.line1).toBe("1 65053U 25163A   26319.51760558  .00000230  00000+0  82551-4 0  9993");
    expect(NISAR.line2).toBe("2 65053  98.4058 145.0022 0001280  90.7252 269.4085 14.42503785 68204");
  });
  it("tleEpoch = 2026-11-15T12:25:21.122Z (day 319.51760558) and matches the snapshot", () => {
    expect(tleEpoch(NISAR).toISOString()).toBe(EPOCH_ISO);
    expect(tleEpoch(NISAR).toISOString()).toBe(snapshot.epochIso);
    // independent: satellite.js jdsatepoch
    const rec = satellite.twoline2satrec(NISAR.line1, NISAR.line2);
    const jd = rec.jdsatepoch;
    const ms = (jd - 2440587.5) * 86400000;
    expect(Math.abs(ms - T0.getTime())).toBeLessThan(2);
  });
  it("unparseable epoch → Invalid Date and always stale", () => {
    const bad = { ...NISAR, line1: "garbage" };
    expect(Number.isNaN(tleEpoch(bad).getTime())).toBe(true);
    expect(ephemerisStatus(bad, T0, 72).label).toBe("STALE_EPHEMERIS");
  });
  it("STALE_EPHEMERIS boundary at exactly 72 h (strictly greater is stale)", () => {
    const at = ephemerisStatus(NISAR, new Date(T0.getTime() + 72 * HOUR), 72);
    expect(at.ageHours).toBe(72);
    expect(at.stale).toBe(false);
    expect(at.label).toBe("FRESH");
    const after = ephemerisStatus(NISAR, new Date(T0.getTime() + 72 * HOUR + 1), 72);
    expect(after.stale).toBe(true);
    expect(after.label).toBe("STALE_EPHEMERIS");
    const fresh = ephemerisStatus(NISAR, new Date("2026-11-16T00:00:00Z"), 72);
    expect(fresh.ageHours).toBeCloseTo(11.5774661, 6);
    expect(fresh.label).toBe("FRESH");
    const future = ephemerisStatus(NISAR, new Date(T0.getTime() - 73 * HOUR), 72);
    expect(future.ageHours).toBeCloseTo(-73, 9);
    expect(future.label).toBe("STALE_EPHEMERIS");
  });
  it("elements helpers", () => {
    expect(tleInclinationDeg(NISAR)).toBe(98.4058);
    expect(tlePeriodMinutes(NISAR)).toBeCloseTo(99.826, 2);
  });
});

describe("GMST (IAU-82)", () => {
  it("J2000.0 (UT1 = UTC): θ = 67310.54841 s = 280.460618375°", () => {
    expect(radToDeg(gmstRad(new Date("2000-01-01T12:00:00Z")))).toBeCloseTo(280.460618375, 9);
  });
  it("Vallado Example 3-5: 1992-08-20 12:14 UT1 → 152.578788°", () => {
    expect(radToDeg(gmstRad(new Date("1992-08-20T12:14:00Z")))).toBeCloseTo(152.578788, 5);
  });
  it("agrees with satellite.js gstime to < 1e-8 rad at several epochs", () => {
    for (const d of [...EPOCHS, new Date("2025-07-30T12:10:00Z"), new Date("2030-02-28T23:59:59.999Z")]) {
      const diff = Math.abs(gmstRad(d) - satellite.gstime(d));
      expect(Math.min(diff, 2 * Math.PI - diff)).toBeLessThan(1e-8);
    }
  });
  it("advances at the sidereal rate and honours UT1−UTC", () => {
    const g0 = gmstRad(T0);
    const g1 = gmstRad(new Date(T0.getTime() + 1000));
    // dθ_GMST/dt = 1.00273790935·2π/86400 (+ precession in RA) ≈ 7.2921158553e-5 rad/s
    expect(g1 - g0).toBeCloseTo(7.2921158553e-5, 12);
    expect(gmstRad(T0, 0.9) - g0).toBeCloseTo(7.2921158553e-5 * 0.9, 12);
    expect(Math.abs(g1 - g0 - EARTH_ROTATION_RATE_RAD_S)).toBeLessThan(1e-11);
  });
});

describe("TEME → ECEF", () => {
  it("is a pure z-rotation by GMST and inverts", () => {
    const r = { x: 7000e3, y: -1234e3, z: 555e3 };
    const e = temeToEcef(r, 1.234);
    expect(vec3Length(e)).toBeCloseTo(vec3Length(r), 6);
    expect(e.z).toBe(r.z);
    const back = ecefToTeme(e, 1.234);
    expect(back.x).toBeCloseTo(r.x, 6);
    expect(back.y).toBeCloseTo(r.y, 6);
    const q = temeToEcef({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    expect(q.x).toBeCloseTo(0, 15);
    expect(q.y).toBeCloseTo(-1, 15);
  });
  it("independent cross-check vs satellite.js eciToEcf / eciToEcfVelocity at several epochs", () => {
    const rec = satellite.twoline2satrec(NISAR.line1, NISAR.line2);
    for (const d of EPOCHS) {
      const pv = satellite.propagate(rec, d);
      expect(pv).not.toBeNull();
      if (!pv) continue;
      const g = satellite.gstime(d);
      const theirs = satellite.eciToEcf(pv.position, g);
      const mine = temeToEcef(pv.position, g);
      expect(Math.abs(mine.x - theirs.x) * 1000).toBeLessThan(1e-6);
      expect(Math.abs(mine.y - theirs.y) * 1000).toBeLessThan(1e-6);
      expect(Math.abs(mine.z - theirs.z) * 1000).toBeLessThan(1e-6);
      const vTheirs = satellite.eciToEcfVelocity(pv.position, pv.velocity, g);
      const vMine = temeVelocityToEcef(pv.velocity, mine, g);
      // satellite.js uses ω = 7.292115e-5 (vs 7.2921151467e-5): ≤ 1.5e-13·r ≈ 1e-6 m/s
      expect(Math.abs(vMine.x - vTheirs.x) * 1000).toBeLessThan(1e-3);
      expect(Math.abs(vMine.y - vTheirs.y) * 1000).toBeLessThan(1e-3);
      expect(Math.abs(vMine.z - vTheirs.z) * 1000).toBeLessThan(1e-3);
      // geodetic: own ecefToGeodetic vs satellite.js eciToGeodetic
      const geo = satellite.eciToGeodetic(pv.position, g);
      const own = ecefToGeodetic({ x: mine.x * 1000, y: mine.y * 1000, z: mine.z * 1000 });
      expect(Math.abs(own.latRad - geo.latitude)).toBeLessThan(1e-9);
      expect(Math.abs(own.heightM - geo.height * 1000)).toBeLessThan(1e-3);
    }
  });
});

describe("propagateTle (NISAR, fixed clocks)", () => {
  it("state at epoch: equator crossing, ~750 km, finite", () => {
    const s = propagateTle(NISAR, T0);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.timeIso).toBe(EPOCH_ISO);
    expect(Math.abs(s.latDeg)).toBeLessThan(0.01); // mean anomaly + ω ≈ 360° at epoch
    expect(s.heightM).toBeGreaterThan(740e3);
    expect(s.heightM).toBeLessThan(760e3);
    const speed = vec3Length(s.velEcefMps);
    expect(speed).toBeGreaterThan(6900);
    expect(speed).toBeLessThan(7600);
  });

  const orbit = nadirGroundTrack(NISAR, T0, 2 * 99.83 * 60, 10);

  it("one-orbit envelope: geodetic height 750–785 km (measured 752.2–779.4), max |lat| ≈ 81.6°, inclination 98.4°", () => {
    expect(orbit.length).toBe(Math.floor((2 * 99.83 * 60) / 10) + 1);
    const hs = orbit.map((s) => s.heightM);
    const minH = Math.min(...hs);
    const maxH = Math.max(...hs);
    // nominal "747 km" is w.r.t. a mean radius; geodetic height is ~21 km higher over the poles (b < a)
    expect(minH).toBeGreaterThan(750e3);
    expect(maxH).toBeLessThan(785e3);
    const maxLat = Math.max(...orbit.map((s) => Math.abs(s.latDeg)));
    expect(maxLat).toBeGreaterThan(81.4);
    expect(maxLat).toBeLessThan(81.9);
    // inclination from the inertial angular momentum (v_inertial = v_ecef + ω × r)
    const s = orbit[100] as OrbitState;
    const vI = {
      x: s.velEcefMps.x - EARTH_ROTATION_RATE_RAD_S * s.ecefM.y,
      y: s.velEcefMps.y + EARTH_ROTATION_RATE_RAD_S * s.ecefM.x,
      z: s.velEcefMps.z,
    };
    const h = vec3Cross(s.ecefM, vI);
    expect(radToDeg(Math.acos(h.z / vec3Length(h)))).toBeCloseTo(98.4, 1);
  });

  it("nodal period ≈ 99.8 min (ascending-node crossings)", () => {
    const track = nadirGroundTrack(NISAR, new Date(T0.getTime() - 600_000), 3 * 99.83 * 60, 10);
    const crossings: number[] = [];
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1] as OrbitState;
      const b = track[i] as OrbitState;
      if (a.ecefM.z < 0 && b.ecefM.z >= 0) {
        const f = -a.ecefM.z / (b.ecefM.z - a.ecefM.z);
        crossings.push(Date.parse(a.timeIso) + f * (Date.parse(b.timeIso) - Date.parse(a.timeIso)));
      }
    }
    expect(crossings.length).toBeGreaterThanOrEqual(2);
    const periodMin = ((crossings[1] as number) - (crossings[0] as number)) / 60000;
    expect(periodMin).toBeGreaterThan(99.5);
    expect(periodMin).toBeLessThan(100.1);
  });

  it("ECEF velocity includes ω×r: matches a 4th-order finite difference of ECEF positions", () => {
    // satellite.js maps Date → Julian date in one double (~40 µs resolution ≈ 0.3 m along-track),
    // so use a wide 5-point stencil: truncation ~1e-6 m/s, time-quantisation noise ≲ 0.05 m/s.
    // Omitting ω×r would be a ~500 m/s error.
    const h = 10_000;
    for (const d of EPOCHS) {
      const s = propagateTle(NISAR, d);
      const p = [-2, -1, 1, 2].map((k) => propagateTle(NISAR, new Date(d.getTime() + k * h)));
      const [m2, m1, p1, p2] = p;
      if (!s || !m2 || !m1 || !p1 || !p2) throw new Error("propagation failed");
      const fd = (c: "x" | "y" | "z") =>
        (-p2.ecefM[c] + 8 * p1.ecefM[c] - 8 * m1.ecefM[c] + m2.ecefM[c]) / (12 * (h / 1000));
      for (const c of ["x", "y", "z"] as const) {
        expect(Math.abs(fd(c) - s.velEcefMps[c])).toBeLessThan(0.1);
      }
    }
  });

  it("UT1−UTC option rotates the ECEF state by ω·ΔUT1 (≈ 0.47 km for 0.9 s at the equator)", () => {
    const a = propagateTle(NISAR, T0);
    const b = propagateTle(NISAR, T0, { ut1MinusUtcS: 0.9 });
    if (!a || !b) throw new Error("propagation failed");
    const d = Math.hypot(a.ecefM.x - b.ecefM.x, a.ecefM.y - b.ecefM.y, a.ecefM.z - b.ecefM.z);
    const rho = Math.hypot(a.ecefM.x, a.ecefM.y);
    expect(d).toBeCloseTo(rho * EARTH_ROTATION_RATE_RAD_S * 0.9, 3);
    expect(d).toBeGreaterThan(460);
    expect(d).toBeLessThan(470);
  });

  it("deterministic, and lon/lat agree with the ECEF position", () => {
    const a = propagateTle(NISAR, EPOCHS[1] as Date);
    const b = propagateTle(NISAR, EPOCHS[1] as Date);
    expect(a).toEqual(b);
    if (!a) return;
    const g = ecefToGeodetic(a.ecefM);
    expect(a.latDeg).toBe(radToDeg(g.latRad));
    expect(a.lonDeg).toBeGreaterThan(-180);
    expect(a.lonDeg).toBeLessThanOrEqual(180);
    expect(degToRad(a.lonDeg)).toBeCloseTo(Math.atan2(a.ecefM.y, a.ecefM.x), 12);
  });

  it("invalid inputs → null / empty", () => {
    expect(propagateTle(NISAR, new Date(Number.NaN))).toBeNull();
    expect(propagateTle({ name: "x", line1: "1 bad", line2: "2 bad" }, T0)).toBeNull();
    expect(nadirGroundTrack(NISAR, T0, 600, 0)).toEqual([]);
    expect(nadirGroundTrack(NISAR, T0, -1, 10)).toEqual([]);
    expect(nadirGroundTrack(NISAR, T0, 0, 10).length).toBe(1);
  });

  it("splitTrackAtAntimeridian splits only at ±180 jumps", () => {
    const runs = splitTrackAtAntimeridian(orbit);
    expect(runs.reduce((n, r) => n + r.length, 0)).toBe(orbit.length);
    for (const run of runs) {
      for (let i = 1; i < run.length; i++) {
        expect(Math.abs((run[i] as OrbitState).lonDeg - (run[i - 1] as OrbitState).lonDeg)).toBeLessThan(180);
      }
    }
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });
});
