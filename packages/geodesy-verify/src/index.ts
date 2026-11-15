/**
 * @blindrev/geodesy-verify — Spike D cross-validation of core-sim geodesy (spec §8).
 * Two separately reported vector sets: `runCorrectness` (independent analytic oracles + closure,
 * no Cesium) and `runParity` (vs CesiumJS; import from "./parity" — kept out of this barrel so that
 * importing the correctness set never loads Cesium).
 */
export { type Metric, MaxTracker } from "./metric";
export { runCorrectness, analyticForwardVectors, EPSG_GN72, SEED, SAMPLE_N } from "./correctness";
export {
  A,
  B,
  E2,
  F,
  oracleGeodeticToEcef,
  oracleEcefToGeodetic,
  oracleSurfaceNormalAt,
  geodeticSample,
  seededRandom,
} from "./oracle";
