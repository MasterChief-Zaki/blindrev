/**
 * Shared data contracts — verbatim from docs/ARCHITECTURE.md §3 (normative).
 * Do not edit without updating ARCHITECTURE.md; Zod mirrors live in ./schemas.ts.
 * (Excluded from the Biome formatter so it stays byte-identical to the contract.)
 */

export type Bounds = [west: number, south: number, east: number, north: number]; // degrees
export interface LonLat { lon: number; lat: number }                              // degrees
export interface Vec3 { x: number; y: number; z: number }                         // metres, Float64

export type DataLabel = "SIMULATED" | "PLACEHOLDER" | "TEST_FIXTURE" | "STALE_EPHEMERIS" | "OFFLINE";

export interface TemporalStep {              // spec §4, v2 — field-for-field
  schemaVersion: 2;
  stepId: string;
  date: string; acquisitionStart: string; acquisitionEnd: string;   // ISO-8601 UTC
  isAvailable: boolean;
  platform: string; instrument: string; processingVersion: string; sourceId: string; layerId: string;
  tileUrlTemplate: string;                   // display raster for this step ("" when !isAvailable)
  crs: "EPSG:4326" | "EPSG:3857";
  bounds: Bounds; resolutionMeters: number; noDataValue: number | null;
  displacement: {
    quantity: "los" | "vertical"; unit: "mm" | "cm" | "m"; signConvention: string;
    referenceStepId: string | null;
    referencePoint: { lon: number; lat: number; heightM: number } | null;
    incidenceAngleDeg: number | null;
    lineOfSight: { east: number; north: number; up: number } | null;
  } | null;
  acquisition: { track: number | null; frame: number | null; orbitDirection: "ASCENDING" | "DESCENDING" } | null;
  tiling: { tileMatrixSet: string; minZoom: number; maxZoom: number };
  qaMaskId: string | null; qaMaskUrlTemplate: string | null;
  evidenceMaskId: string | null; evidenceMaskUrlTemplate: string | null;
  uncertainty: number | null;
  uncertaintyType: "rmse_mm" | "std_dev" | "categorical_confidence" | "none";
  license: string; attribution: string; citation: string;
}

/** EPSG:4326 regular grid. Row 0 = north edge. Pixel (col,row) centre =
 *  lon = west + (col+0.5)*(east-west)/width ; lat = north - (row+0.5)*(north-south)/height */
export interface GridSpec { width: number; height: number; bounds: Bounds; crs: "EPSG:4326" }

export interface MaskAsset extends GridSpec {
  maskId: string; version: string;
  binUrl: string;        // raw Uint8, row-major, width*height bytes; 1 = inside/valid, 0 = outside/invalid
  pngUrl: string;        // display PNG, same grid
  sha256: string;        // of the .bin
}
export interface MaskGrid extends GridSpec { data: Uint8Array }     // decoded MaskAsset

export interface ContextLayer {
  layerId: string; title: string; kind: "optical" | "radar" | "basemap";
  date: string | null; stepId: string | null;       // stepId when tied to one TemporalStep
  crs: "EPSG:3857"; bounds: Bounds;
  tileUrlTemplate: string;                          // bundled, relative; {z}/{y}/{x}
  onlineUrlTemplate: string | null;                 // GIBS REST template, or null
  tiling: { tileMatrixSet: string; minZoom: number; maxZoom: number };
  license: string; attribution: string; citation: string;
}

export interface ScoringConfig {
  dtMinDays: number; iouPass: number; iouPartial: number; advisoryPrecisionRecall: number;
  roiAreaMinKm2: number; roiAreaMaxKm2: number;
  qaMinCoverage: number; qaMinValidPixels: number; maskRegistrationMaxPx: number;
}

export interface MissionManifest {
  schemaVersion: 1;
  missionId: string; caseId: string; title: string; kicker: string;
  theme: "subsidence" | "deforestation" | "glacier" | "wetlands";
  aoi: { decision: "PENDING" | "INJECTED"; bounds: Bounds | null; name: string | null;
         source: string | null; injectedBy: string | null; injectedAt: string | null };
  effectiveBounds: Bounds;                 // bounds actually used (fixture bounds while PENDING)
  labels: DataLabel[];                     // labels that MUST be shown in HUD + briefing for this mission
  briefing: { question: string; summary: string; body: string[]; location: string; dates: string; source: string;
              facts: { text: string; source: string }[] };
  steps: TemporalStep[];                   // chronological, includes isAvailable:false steps
  masks: Record<string, MaskAsset>;        // QA masks (per step) + the reference mask, keyed by maskId
  referenceMaskId: string;
  referencePolygons: LonLat[][];           // authored answer-key polygons the reference mask was rasterised from
  contextLayers: ContextLayer[];
  legend: { ramp: [string, string, string]; labels: [string, string, string]; unit: string; thresholds: [number, number] };
  camera: { home: { lon: number; lat: number; heightM: number }; aoi: { lon: number; lat: number; heightM: number } };
  attributions: string[];
}

export interface QualityPreset { id: "low" | "medium" | "high"; tileCacheSize: number; maximumScreenSpaceError: number; renderScale: number; allow4k: boolean }
export interface CameraConfig { k: number; vMinMps: number; vMaxMps: number; minClearanceM: number; minEllipsoidalHeightM: number;
  rangeMinM: number; rangeMaxM: number; latClampDeg: number; zoomRatePerS: number; wheelZoomStep: number; terrainSamples: number;
  home: { lonDeg: number; latDeg: number; rangeM: number; headingDeg: number; pitchDeg: number } }
export interface GameConstants { scoring: ScoringConfig;
  tle: { maxAgeHours: number; freshWindowHours: number; noradId: number };
  wipe: { durationMs: number; easing: string; progressCapMs: number };
  soak: { durationMin: number; snapshotS: number; maxHeapDeltaMb: number };
  visualCi: { maxDiffRatio: number }; roiNudgeDeg: number; roiNudgeCoarseFactor: number }
export interface TleSnapshot { schemaVersion: 1; noradId: number; name: string; line1: string; line2: string;
  epochIso: string; fetchedAt: string; source: string }
