/** @blindrev/core-sim — orbit propagation [C1]. Propagated state, not telemetry. */
export { J2000_UNIX_MS, gmstRad, temeToEcef, ecefToTeme, temeVelocityToEcef } from "./frames";
export {
  type Tle,
  type OrbitState,
  type PropagateTleOptions,
  type EphemerisStatus,
  GROUND_TRACK_MAX_POINTS,
  tleFromSnapshot,
  propagateTle,
  nadirGroundTrack,
  splitTrackAtAntimeridian,
  tleEpoch,
  ephemerisStatus,
  tleMeanMotionRevPerDay,
  tleInclinationDeg,
  tlePeriodMinutes,
} from "./propagate";
