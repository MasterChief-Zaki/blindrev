import type { LonLat } from "../contracts";
import { HALF_TURN_NANO_CONST, LAT_LIMIT_DEG, clampLat899, fromNano, toNano, wrapLon180 } from "./planar";
import type { NudgeDirection } from "./types";

/** Keyboard nudge step (spec §10): arrow = 0.001°. */
export const ROI_NUDGE_DEFAULT_DEG = 0.001;
/** Shift multiplies the step by this factor. */
export const ROI_NUDGE_COARSE_FACTOR = 10;
/** |lat| limit applied to ROI vertices. */
export const ROI_LAT_LIMIT_DEG = LAT_LIMIT_DEG;

function snapLon(lon: number): number {
  let x = toNano(wrapLon180(lon));
  if (x <= -HALF_TURN_NANO_CONST) x += 2 * HALF_TURN_NANO_CONST;
  const d = fromNano(x);
  return d === 0 ? 0 : d;
}

function snapLat(lat: number): number {
  const d = fromNano(toNano(clampLat899(lat)));
  return d === 0 ? 0 : d;
}

/**
 * Move one vertex by `stepDeg` (× `coarseFactor` when `coarse`) towards N/S/E/W. Latitude is clamped
 * to ±89.9°, longitude wraps into (−180, 180]; the moved coordinate is snapped to the 1e-9° lattice
 * so repeated nudges do not accumulate float drift (0.001 × 3 = 0.003 exactly). Returns a new array
 * of new objects; an out-of-range index returns an unchanged copy.
 */
export function nudgeVertex(
  vertices: LonLat[],
  index: number,
  dir: NudgeDirection,
  coarse: boolean,
  stepDeg: number = ROI_NUDGE_DEFAULT_DEG,
  coarseFactor: number = ROI_NUDGE_COARSE_FACTOR,
): LonLat[] {
  const out = vertices.map((v) => ({ lon: v.lon, lat: v.lat }));
  if (!Number.isInteger(index) || index < 0 || index >= out.length) return out;
  const base = Number.isFinite(stepDeg) && stepDeg > 0 ? stepDeg : ROI_NUDGE_DEFAULT_DEG;
  const factor = Number.isFinite(coarseFactor) && coarseFactor > 0 ? coarseFactor : ROI_NUDGE_COARSE_FACTOR;
  const step = coarse ? base * factor : base;
  const v = out[index] as LonLat;
  switch (dir) {
    case "N":
      out[index] = { lon: v.lon, lat: snapLat(v.lat + step) };
      break;
    case "S":
      out[index] = { lon: v.lon, lat: snapLat(v.lat - step) };
      break;
    case "E":
      out[index] = { lon: snapLon(v.lon + step), lat: v.lat };
      break;
    case "W":
      out[index] = { lon: snapLon(v.lon - step), lat: v.lat };
      break;
  }
  return out;
}
