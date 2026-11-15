import type { LonLat } from "../contracts";

export type RoiErrorCode =
  | "TOO_FEW_VERTICES"
  | "SELF_INTERSECTION"
  | "AREA_TOO_SMALL"
  | "AREA_TOO_LARGE"
  | "DEGENERATE";

export interface RoiError {
  code: RoiErrorCode;
  message: string;
}

export interface RoiValidation {
  ok: boolean;
  errors: RoiError[];
  /** Spherical-excess area (km²); 0 when the outline has no valid geometry. */
  areaKm2: number;
  /** Normalised rings (lon within [−180, 180], split at ±180°, |lat| ≤ 89.9°, 1e-9° lattice). */
  rings: LonLat[][];
}

export type NudgeDirection = "N" | "S" | "E" | "W";
