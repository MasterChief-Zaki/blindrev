/**
 * NISAR (or any TLE) propagation: satellite.js SGP4 → TEME (km) → metres → explicit GMST rotation
 * → ECEF → geodetic via core-sim's own `ecefToGeodetic`. Propagated state, NOT telemetry.
 */
import { type SatRec, propagate as sgp4Propagate, twoline2satrec } from "satellite.js";
import type { TleSnapshot, Vec3 } from "../contracts";
import { radToDeg } from "../geodesy/angles";
import { ecefToGeodetic } from "../geodesy/transforms";
import { vec3 } from "../geodesy/vec3";
import { gmstRad, temeToEcef, temeVelocityToEcef } from "./frames";

export interface Tle {
  name: string;
  line1: string;
  line2: string;
}

export interface OrbitState {
  timeIso: string;
  ecefM: Vec3;
  velEcefMps: Vec3;
  lonDeg: number;
  latDeg: number;
  heightM: number;
}

export interface PropagateTleOptions {
  /** UT1 − UTC in seconds (IERS Bulletin A DUT1). Default 0 (UT1 ≈ UTC). */
  ut1MinusUtcS?: number;
}

export function tleFromSnapshot(s: Pick<TleSnapshot, "name" | "line1" | "line2">): Tle {
  return { name: s.name, line1: s.line1, line2: s.line2 };
}

const SATREC_CACHE_MAX = 16;
const satrecCache = new Map<string, SatRec | null>();

function satrecFor(tle: Tle): SatRec | null {
  const key = `${tle.line1}\n${tle.line2}`;
  const hit = satrecCache.get(key);
  if (hit !== undefined) return hit;
  let rec: SatRec | null = null;
  try {
    rec = twoline2satrec(tle.line1, tle.line2);
    if (!Number.isFinite(rec.no) || !Number.isFinite(rec.jdsatepoch) || rec.error !== 0) rec = null;
  } catch {
    rec = null;
  }
  if (satrecCache.size >= SATREC_CACHE_MAX) {
    const first = satrecCache.keys().next().value;
    if (first !== undefined) satrecCache.delete(first);
  }
  satrecCache.set(key, rec);
  return rec;
}

const scratchTemeR: Vec3 = vec3();
const scratchTemeV: Vec3 = vec3();

/** Propagate a TLE to `date` (UTC). Returns null for invalid TLEs, invalid dates or SGP4 errors. */
export function propagateTle(tle: Tle, date: Date, opts?: PropagateTleOptions): OrbitState | null {
  const tMs = date.getTime();
  if (!Number.isFinite(tMs)) return null;
  const rec = satrecFor(tle);
  if (!rec) return null;
  const pv = sgp4Propagate(rec, date);
  if (!pv) return null;
  const p = pv.position;
  const v = pv.velocity;
  if (
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y) ||
    !Number.isFinite(p.z) ||
    !Number.isFinite(v.x) ||
    !Number.isFinite(v.y) ||
    !Number.isFinite(v.z)
  ) {
    return null;
  }
  scratchTemeR.x = p.x * 1000;
  scratchTemeR.y = p.y * 1000;
  scratchTemeR.z = p.z * 1000;
  scratchTemeV.x = v.x * 1000;
  scratchTemeV.y = v.y * 1000;
  scratchTemeV.z = v.z * 1000;
  const g = gmstRad(date, opts?.ut1MinusUtcS ?? 0);
  const ecefM = temeToEcef(scratchTemeR, g, vec3());
  const velEcefMps = temeVelocityToEcef(scratchTemeV, ecefM, g, vec3());
  const geo = ecefToGeodetic(ecefM);
  return {
    timeIso: new Date(tMs).toISOString(),
    ecefM,
    velEcefMps,
    lonDeg: radToDeg(geo.lonRad),
    latDeg: radToDeg(geo.latRad),
    heightM: geo.heightM,
  };
}

/** Hard cap on generated track points (guards against tiny steps). */
export const GROUND_TRACK_MAX_POINTS = 20000;

/**
 * Nadir ground track: propagated states at start + i·stepS for i = 0..⌊durationS/stepS⌋
 * (failed epochs are skipped). Nadir only — no swath envelopes (Spike C standing kill).
 */
export function nadirGroundTrack(
  tle: Tle,
  start: Date,
  durationS: number,
  stepS: number,
  opts?: PropagateTleOptions,
): OrbitState[] {
  const t0 = start.getTime();
  if (!Number.isFinite(t0) || !(stepS > 0) || !(durationS >= 0) || !Number.isFinite(durationS)) return [];
  const n = Math.min(GROUND_TRACK_MAX_POINTS - 1, Math.floor(durationS / stepS + 1e-9));
  const outArr: OrbitState[] = [];
  for (let i = 0; i <= n; i++) {
    const s = propagateTle(tle, new Date(t0 + i * stepS * 1000), opts);
    if (s) outArr.push(s);
  }
  return outArr;
}

/** Split a track into runs that do not cross the ±180° meridian (for polyline drawing). */
export function splitTrackAtAntimeridian(track: ReadonlyArray<OrbitState>): OrbitState[][] {
  const runs: OrbitState[][] = [];
  let cur: OrbitState[] = [];
  for (let i = 0; i < track.length; i++) {
    const s = track[i] as OrbitState;
    const prev = cur[cur.length - 1];
    if (prev && Math.abs(s.lonDeg - prev.lonDeg) > 180) {
      runs.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/**
 * TLE epoch from line 1 columns 19–32 (YYDDD.DDDDDDDD, UTC; YY < 57 → 20YY). Rounded to the
 * nearest millisecond. Returns an Invalid Date if the field cannot be parsed.
 */
export function tleEpoch(tle: Tle): Date {
  const field = tle.line1.substring(18, 32).trim();
  const m = /^(\d{2})(\d{3}(?:\.\d*)?)$/.exec(field);
  if (!m) return new Date(Number.NaN);
  const yy = Number(m[1]);
  const doy = Number(m[2]);
  if (!(doy >= 1 && doy < 367)) return new Date(Number.NaN);
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Math.round(Date.UTC(year, 0, 1) + (doy - 1) * 86400000));
}

export interface EphemerisStatus {
  /** (now − epoch) in hours; negative if the epoch is in the future. */
  ageHours: number;
  stale: boolean;
  label: "FRESH" | "STALE_EPHEMERIS";
}

/**
 * STALE_EPHEMERIS when |now − epoch| > maxAgeHours (strictly greater: exactly 72 h is still FRESH).
 * An unparseable epoch is always stale.
 */
export function ephemerisStatus(tle: Tle, now: Date, maxAgeHours: number): EphemerisStatus {
  const ageHours = (now.getTime() - tleEpoch(tle).getTime()) / 3_600_000;
  const stale = !(Math.abs(ageHours) <= maxAgeHours);
  return { ageHours, stale, label: stale ? "STALE_EPHEMERIS" : "FRESH" };
}

/** Mean motion (rev/day) from line 2 columns 53–63. */
export function tleMeanMotionRevPerDay(tle: Tle): number {
  return Number(tle.line2.substring(52, 63));
}

/** Inclination (deg) from line 2 columns 9–16. */
export function tleInclinationDeg(tle: Tle): number {
  return Number(tle.line2.substring(8, 16));
}

/** Nominal (Kozai mean-motion) period in minutes = 1440 / n. */
export function tlePeriodMinutes(tle: Tle): number {
  return 1440 / tleMeanMotionRevPerDay(tle);
}
