import type { LonLat, MaskGrid, ScoringConfig, TemporalStep } from "../contracts";

export interface ScoreInput {
  rings: LonLat[][];
  reference: MaskGrid;
  qa: MaskGrid[];
  stepA: TemporalStep;
  stepB: TemporalStep;
  config: ScoringConfig;
}

export type ScoreTier = "PASS" | "PARTIAL" | "FAIL";

export type ScoreOutcome =
  | {
      kind: "SCORE";
      iou: number;
      precision: number;
      recall: number;
      tier: ScoreTier;
      advisory: string[];
      roiPixels: number;
      validPixels: number;
      coverage: number;
      tp: number;
      fp: number;
      fn: number;
      digest: string;
    }
  | {
      kind: "QA_DIAGNOSTIC";
      code: "LOW_COHERENCE" | "TOO_FEW_VALID_PIXELS" | "CLOUD_COVER";
      message: string;
      coverage: number;
      validPixels: number;
      roiPixels: number;
    }
  | {
      kind: "REJECTED";
      code: "DT_TOO_SHORT" | "STEP_UNAVAILABLE" | "ROI_INVALID" | "CRS_MISMATCH" | "GRID_MISMATCH";
      message: string;
    };
