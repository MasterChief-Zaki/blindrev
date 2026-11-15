/**
 * AUTHORED reference change polygons — the mission answer key (version v1).
 *
 * Not a scientific product. Vertices were proposed by src/author-polygons.ts (rays from each bowl
 * centre to the −25 mm contour of the persistent signal at full growth), reviewed, rounded to 1e-4°
 * and frozen here. They outline the ground that keeps sinking across the record; the single-date
 * artefacts, the seasonal patch and the atmospheric screen are deliberately outside.
 */
import type { LonLat } from "@blindrev/core-sim";

/** Main bowl along the California Aqueduct, between Huron and Kettleman City (16 vertices). */
const MAIN_BOWL: LonLat[] = [
  { lon: -120.074, lat: 36.1374 },
  { lon: -120.0538, lat: 36.1337 },
  { lon: -120.0331, lat: 36.1273 },
  { lon: -120.0093, lat: 36.1158 },
  { lon: -119.9878, lat: 36.094 },
  { lon: -119.9831, lat: 36.0634 },
  { lon: -120.0158, lat: 36.0467 },
  { lon: -120.0499, lat: 36.0468 },
  { lon: -120.074, lat: 36.0501 },
  { lon: -120.094, lat: 36.0547 },
  { lon: -120.1129, lat: 36.0623 },
  { lon: -120.1398, lat: 36.0718 },
  { lon: -120.163, lat: 36.094 },
  { lon: -120.1737, lat: 36.1276 },
  { lon: -120.1354, lat: 36.1439 },
  { lon: -120.0978, lat: 36.1408 },
];

/** Smaller north-east bowl (12 vertices). */
const NORTH_EAST_BOWL: LonLat[] = [
  { lon: -119.972, lat: 36.1955 },
  { lon: -119.9556, lat: 36.1851 },
  { lon: -119.946, lat: 36.1742 },
  { lon: -119.942, lat: 36.162 },
  { lon: -119.9407, lat: 36.1473 },
  { lon: -119.9486, lat: 36.1291 },
  { lon: -119.972, lat: 36.1231 },
  { lon: -119.9912, lat: 36.135 },
  { lon: -120.0009, lat: 36.1484 },
  { lon: -120.0054, lat: 36.162 },
  { lon: -120.0057, lat: 36.1778 },
  { lon: -119.9954, lat: 36.1949 },
];

export const REFERENCE_POLYGONS: LonLat[][] = [MAIN_BOWL, NORTH_EAST_BOWL];
