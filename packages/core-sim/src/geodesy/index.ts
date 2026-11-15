/**
 * @blindrev/core-sim — geodesy [C1]. WGS84, radians in, metres out, Float64 Vec3.
 * Zero DOM/WebGL/Cesium imports.
 */
export {
  WGS84,
  WGS84_A,
  WGS84_B,
  WGS84_E,
  WGS84_E2,
  WGS84_E4,
  WGS84_EP2,
  WGS84_F,
  WGS84_INV_F,
  WGS84_N,
  WGS84_ONE_MINUS_E2,
  EARTH_ROTATION_RATE_RAD_S,
  primeVerticalRadius,
  meridionalRadius,
} from "./wgs84";
export { degToRad, radToDeg, wrapLonDeg, wrapLonRad, wrap360Deg, clampLatDeg } from "./angles";
export {
  type Geodetic,
  type EnuBasis,
  geodeticToEcef,
  geodeticDegToEcef,
  ecefToGeodetic,
  geodeticSurfaceNormal,
  enuBasis,
  scaleToAltitude,
} from "./transforms";
export {
  type LonLatRad,
  WGS84_RECTIFYING_RADIUS,
  meridianArc,
  inverseMeridianArc,
  isometricLatitude,
  rhumbDirect,
  rhumbInverse,
} from "./rhumb";
export {
  vec3,
  vec3Set,
  vec3Copy,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3AddScaled,
  vec3Dot,
  vec3Cross,
  vec3Length,
  vec3Distance,
  vec3Normalize,
  vec3IsFinite,
} from "./vec3";
