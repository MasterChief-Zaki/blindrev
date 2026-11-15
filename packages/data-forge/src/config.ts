/**
 * Mission "The Sinking City" (CASE_001) — every authored constant of the data pipeline.
 *
 * Nothing in here is measured by the pipeline. Real facts carry a source reference
 * (resource pack path or catalogue id); simulated parameters say so.
 */
import type { Bounds, LonLat } from "@blindrev/core-sim";

// ---------------------------------------------------------------------------
// Paths (relative to the repo root)
// ---------------------------------------------------------------------------

export const MISSION_ID = "sinking-city";
export const PUBLIC_DIR = "packages/app-shell/public";
export const MISSION_DATA_REL = `mission-data/${MISSION_ID}`; // runtime URL prefix (relative to app base)
export const MISSION_JSON = `data/missions/${MISSION_ID}.json`;
export const FIXTURE_JSON = "data/missions/_fixture-pending.example.json";
export const BASEMAP_JSON = "data/prefabs/basemap.json";
export const ASSETS_MANIFEST_JSON = "data/assets.manifest.json";
export const FETCH_REPORT_JSON = "packages/data-forge/fetch-report.json";

// ---------------------------------------------------------------------------
// AOI — injected by the operator (docs/ARCHITECTURE.md §9)
// ---------------------------------------------------------------------------

/** California Aqueduct corridor, Huron – Kettleman City, San Joaquin Valley, California. */
export const AOI_BOUNDS: Bounds = [-120.4, 35.88, -119.78, 36.4];
export const AOI_NAME = "California Aqueduct corridor, Huron – Kettleman City, San Joaquin Valley, California";
export const AOI_SOURCE =
  "../sars/07_NISAR_StoryMaps/Land_Subsidence/Land_Subsidence_narrative.md (case study 'Central Valley Groundwater Subsidence'; " +
  "bowl extent read from the graticule of resources/Jj5OZk8y7-J7ZxXUZjRxg.png, UAVSAR line 14511, 36°00'–36°12' N, 119°58'–120°08' W); " +
  "../sars/09_UAVSAR_Postcards/postcards.csv (row 'Huron and Kettleman City', July 2013 – March 2015); docs/ARCHITECTURE.md §9";
export const AOI_INJECTED_BY = "orchestrator (operator decision, docs/ARCHITECTURE.md §9)";
export const AOI_INJECTED_AT = "2026-11-15";

/** Bounds used while the AOI decision is PENDING (synthetic, clearly not a real place claim). */
export const FIXTURE_BOUNDS: Bounds = [10.0, 10.0, 10.5, 10.4];

// ---------------------------------------------------------------------------
// Grids
// ---------------------------------------------------------------------------

export const MASK_GRID_SIZE = 512; // scoring / QA / reference-mask grid (EPSG:4326)
export const DISPLAY_GRID_SIZE = 1024; // evidence display PNGs (same bounds, same analytic field)

// ---------------------------------------------------------------------------
// Seeds (all randomness in the forge derives from these)
// ---------------------------------------------------------------------------

export const SEEDS = {
  atmosphere: 0x5eed_a7a0,
  turbulence: 0x5eed_7b10,
  coherence: 0x5eed_c0e0,
  fields: 0x5eed_f1e1,
  noise: 0x5eed_0153,
} as const;

// ---------------------------------------------------------------------------
// NISAR acquisitions — REAL metadata from the NISAR catalogue
// (track 042, DESCENDING, frame 070; NASA CMR collection C2854335566-ASF queried 2026-11-15
//  and ../sars/EDA/data/granules_GCOV_PROVISIONAL.csv / granules_GUNW_PROVISIONAL.csv).
// Track 042 frame 070 has acquisitions every 12 days from 2025-11-01 (cycle 004) to 2026-10-27
// (cycle 034) EXCEPT cycle 012 (2026-02-05) and cycle 027 (2026-08-04): no GCOV and no GUNW granule.
// The mission samples every third repeat cycle (36 days) so that both real gaps fall inside the record.
// ---------------------------------------------------------------------------

export const NISAR_TRACK = 42;
export const NISAR_FRAME = 70;
export const NISAR_ORBIT_DIRECTION = "DESCENDING" as const;

/** Frame 042_D_070 granule polygon (CMR `polygons`, lat/lon pairs), used as the swath-edge no-data cut. */
export const FRAME_POLYGON: LonLat[] = [
  { lon: -122.09978, lat: 38.0301 },
  { lon: -122.8572, lat: 35.97691 },
  { lon: -120.17859, lat: 35.30037 },
  { lon: -119.34761, lat: 37.33307 },
];

export interface StepDef {
  stepId: string;
  cycle: number;
  /** calendar date (UTC) of the 12-day repeat slot */
  day: string;
  available: boolean;
  acquisitionStart?: string;
  acquisitionEnd?: string;
  gcovGranule?: string;
  gunwGranule?: string;
  /** simulated cumulative growth fraction of the persistent bowl at this step (0 at the reference) */
  growth: number;
  /** simulated seasonal (elastic) signal, mm LOS (negative = away from the satellite) */
  seasonalMm: number;
}

export const STEP_DEFS: StepDef[] = [
  {
    stepId: "s01",
    cycle: 9,
    day: "2025-12-31",
    available: true,
    acquisitionStart: "2025-12-31T02:56:42Z",
    acquisitionEnd: "2025-12-31T02:57:17Z",
    gcovGranule: "NISAR_L2_PR_GCOV_009_042_D_070_4005_DHDH_A_20251231T025642_20251231T025717_P05023_N_F_J_001",
    gunwGranule:
      "NISAR_L2_PR_GUNW_009_042_D_070_010_4000_SH_20251231T025642_20251231T025717_20260112T025643_20260112T025717_P05023_N_F_J_001",
    growth: 0,
    seasonalMm: 0,
  },
  { stepId: "s02", cycle: 12, day: "2026-02-05", available: false, growth: 0, seasonalMm: 0 },
  {
    stepId: "s03",
    cycle: 15,
    day: "2026-03-13",
    available: true,
    acquisitionStart: "2026-03-13T02:56:45Z",
    acquisitionEnd: "2026-03-13T02:57:20Z",
    gcovGranule: "NISAR_L2_PR_GCOV_015_042_D_070_4005_DHDH_A_20260313T025645_20260313T025720_P05023_N_F_J_001",
    gunwGranule:
      "NISAR_L2_PR_GUNW_014_042_D_070_015_4000_SH_20260301T025645_20260301T025719_20260313T025645_20260313T025720_P05023_N_F_J_001",
    growth: 0.1,
    seasonalMm: 6,
  },
  {
    stepId: "s04",
    cycle: 18,
    day: "2026-04-18",
    available: true,
    acquisitionStart: "2026-04-18T02:56:45Z",
    acquisitionEnd: "2026-04-18T02:57:20Z",
    gcovGranule: "NISAR_L2_PR_GCOV_018_042_D_070_4005_DHDH_A_20260418T025645_20260418T025720_P05023_N_F_J_001",
    gunwGranule:
      "NISAR_L2_PR_GUNW_017_042_D_070_018_4000_SH_20260406T025645_20260406T025720_20260418T025645_20260418T025720_P05023_N_F_J_001",
    growth: 0.2,
    seasonalMm: 4,
  },
  {
    stepId: "s05",
    cycle: 21,
    day: "2026-05-24",
    available: true,
    acquisitionStart: "2026-05-24T02:56:43Z",
    acquisitionEnd: "2026-05-24T02:57:18Z",
    gcovGranule: "NISAR_L2_PR_GCOV_021_042_D_070_4005_DHDH_A_20260524T025643_20260524T025718_P05023_N_F_J_001",
    gunwGranule:
      "NISAR_L2_PR_GUNW_020_042_D_070_021_4000_SH_20260512T025644_20260512T025719_20260524T025643_20260524T025718_P05023_N_F_J_001",
    growth: 0.36,
    seasonalMm: -8,
  },
  {
    stepId: "s06",
    cycle: 24,
    day: "2026-06-29",
    available: true,
    acquisitionStart: "2026-06-29T02:56:41Z",
    acquisitionEnd: "2026-06-29T02:57:16Z",
    gcovGranule: "NISAR_L2_PR_GCOV_024_042_D_070_4005_DHDH_A_20260629T025641_20260629T025716_P05023_N_F_J_001",
    gunwGranule:
      "NISAR_L2_PR_GUNW_023_042_D_070_024_4000_SH_20260617T025642_20260617T025717_20260629T025641_20260629T025716_P05023_N_F_J_001",
    growth: 0.55,
    seasonalMm: -22,
  },
  { stepId: "s07", cycle: 27, day: "2026-08-04", available: false, growth: 0, seasonalMm: 0 },
  {
    stepId: "s08",
    cycle: 30,
    day: "2026-09-09",
    available: true,
    acquisitionStart: "2026-09-09T02:56:38Z",
    acquisitionEnd: "2026-09-09T02:57:13Z",
    gcovGranule: "NISAR_L2_PR_GCOV_030_042_D_070_4005_DHDH_A_20260909T025638_20260909T025713_P05023_N_F_J_001",
    gunwGranule:
      "NISAR_L2_PR_GUNW_029_042_D_070_030_4000_SH_20260828T025638_20260828T025713_20260909T025638_20260909T025713_P05023_N_F_J_001",
    growth: 0.86,
    seasonalMm: -26,
  },
  {
    stepId: "s09",
    cycle: 33,
    day: "2026-10-15",
    available: true,
    acquisitionStart: "2026-10-15T02:56:39Z",
    acquisitionEnd: "2026-10-15T02:57:13Z",
    gcovGranule: "NISAR_L2_PR_GCOV_033_042_D_070_4005_DHDH_A_20261015T025639_20261015T025713_P05023_N_F_J_001",
    gunwGranule:
      "NISAR_L2_PR_GUNW_032_042_D_070_033_4000_SH_20261003T025638_20261003T025713_20261015T025639_20261015T025713_P05023_N_F_J_001",
    growth: 1,
    seasonalMm: -9,
  },
];

export const REFERENCE_STEP_ID = "s01";

// ---------------------------------------------------------------------------
// SIMULATED displacement model (LOS, mm; negative = motion away from the satellite = subsidence)
// ---------------------------------------------------------------------------

export interface BowlDef {
  id: string;
  center: LonLat;
  /** semi-axes of the Gaussian-like bowl, km */
  majorKm: number;
  minorKm: number;
  /** azimuth of the major axis, degrees clockwise from north */
  azimuthDeg: number;
  /** cumulative LOS displacement at the centre at growth = 1, mm */
  peakMm: number;
}

/**
 * Main bowl beside the aqueduct (Miller et al. 2020 / StoryMap figure resources/Jj5OZk8y7-J7ZxXUZjRxg.png:
 * red core ≈ 36°05.6' N, 120°04.4' W, elongated WNW–ESE along the aqueduct) + a smaller north-east bowl
 * (the same figure shows a second subsiding patch near 36°09' N, 119°58' W). Positions follow the figure;
 * magnitudes and time evolution are SIMULATED.
 */
export const BOWLS: BowlDef[] = [
  { id: "main", center: { lon: -120.074, lat: 36.094 }, majorKm: 8.0, minorKm: 4.2, azimuthDeg: 112, peakMm: -88 },
  {
    id: "north-east",
    center: { lon: -119.972, lat: 36.162 },
    majorKm: 4.6,
    minorKm: 3.0,
    azimuthDeg: 160,
    peakMm: -56,
  },
];

/** Mild seasonal (elastic) signal over irrigated land north-east of the bowls — a decoy: it comes and goes. */
export const SEASONAL_ZONE = { center: { lon: -119.875, lat: 36.315 }, majorKm: 8.0, minorKm: 5.5, azimuthDeg: 35 };

/** Single-date atmospheric artefacts (turbulent water-vapour cells) — decoys that never persist. */
export interface TransientDef {
  stepId: string;
  center: LonLat;
  radiusKm: number;
  peakMm: number;
}
export const TRANSIENTS: TransientDef[] = [
  { stepId: "s04", center: { lon: -120.165, lat: 36.3 }, radiusKm: 5.5, peakMm: -46 },
  { stepId: "s08", center: { lon: -120.0, lat: 35.968 }, radiusKm: 4.6, peakMm: -54 },
  { stepId: "s06", center: { lon: -120.225, lat: 35.975 }, radiusKm: 3.6, peakMm: -32 },
];

/** Smooth atmospheric phase screen amplitude per step (mm, value-noise, changes every step). */
export const APS_AMPLITUDE_MM = 7;
export const APS_RAMP_MM = 5; // long-wavelength ramp across the AOI
export const PIXEL_NOISE_MM = 1.6;
/** 1-sigma uncertainty quoted in the manifest for the SIMULATED values (APS + pixel noise budget). */
export const UNCERTAINTY_RMSE_MM = 8;

// ---------------------------------------------------------------------------
// SIMULATED coherence / QA model
// ---------------------------------------------------------------------------

/** Persistently decorrelated zone (flood-irrigated fields / standing water) — an ROI here yields the QA diagnostic. */
export const LOW_COHERENCE_ZONE = {
  center: { lon: -120.255, lat: 36.175 },
  majorKm: 7.2,
  minorKm: 5.4,
  azimuthDeg: 20,
};
/** Fraction of the AOI covered by per-step cropland decorrelation blobs (value-noise threshold). */
export const CROPLAND_DECORRELATION_FRACTION = 0.11;

// ---------------------------------------------------------------------------
// Display classification (matte 3-step subsidence ramp, docs/ARCHITECTURE.md §8)
// ---------------------------------------------------------------------------

export const RAMP: [string, string, string] = ["#8F5236", "#C9784A", "#E2B08A"];
/** subsidence magnitude (mm, away from the satellite) below which pixels are transparent */
export const DISPLAY_FLOOR_MM = 12;
/** [LOW→MID, MID→HIGH] boundaries in mm of LOS subsidence */
export const THRESHOLDS_MM: [number, number] = [30, 55];
export const LEGEND_LABELS: [string, string, string] = ["Low · 12–30 mm", "Mid · 30–55 mm", "High · 55 mm +"];
export const LEGEND_UNIT = "mm LOS subsidence since 2025-12-31 (SIMULATED)";

// ---------------------------------------------------------------------------
// Line of sight (left-looking NISAR, descending track 042)
// ---------------------------------------------------------------------------

/** NISAR is left-looking (../sars/03_NISAR_Data_User_Guide/site_mirror/text/nisar-intro.md l.118). */
export const PLATFORM_HEADING_DEG = 198.3; // from the frame polygon's along-track edge (CMR footprint)
/** Approximate incidence at the AOI: far-range end of the 240 km swath (AOI sits ~91 % across the frame). */
export const INCIDENCE_DEG = 45.5;
export const REFERENCE_POINT = { lon: -120.33, lat: 36.33, heightM: 0 };

// ---------------------------------------------------------------------------
// Reference change mask (authored answer key)
// ---------------------------------------------------------------------------

export const REFERENCE_MASK_VERSION = "v1";

// ---------------------------------------------------------------------------
// Licences & attributions
// ---------------------------------------------------------------------------

export const GIBS_ACK =
  "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).";
export const NASA_OPEN_LICENSE =
  "NASA open data: full and open sharing; data from NASA-led missions are CC0 unless marked otherwise " +
  "(NASA Earthdata 'Data Use and Citation Guidance', https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance)";
export const GIBS_DOCS = "https://nasa-gibs.github.io/gibs-api-docs/#data-use-guidance-and-acknowledgements";
export const SIMULATED_LICENSE = "CC0-1.0 (BlindRev data-forge output; SIMULATED, deterministic, seeded)";
export const SIMULATED_ATTRIBUTION =
  "SIMULATED by BlindRev data-forge (seeded, deterministic). Acquisition dates, track, frame and orbit direction: NASA/JPL-Caltech NISAR catalogue (ASF DAAC, NASA CMR).";

// ---------------------------------------------------------------------------
// GIBS layers
// ---------------------------------------------------------------------------

export const GIBS_3857 = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

export const BASEMAP = {
  layerId: "BlueMarble_ShadedRelief_Bathymetry",
  date: "2004-08-01",
  tileMatrixSet: "GoogleMapsCompatible_Level8",
  ext: "jpeg",
  globalMaxZoom: 5,
  regionalMaxZoom: 8,
  /** AOI ± 2° */
  regionalBounds: [-122.4, 33.88, -117.78, 38.4] as Bounds,
  title: "Blue Marble: Shaded Relief and Bathymetry (MODIS)",
  attribution: `NASA Earth Observatory Blue Marble (MODIS) via NASA GIBS. ${GIBS_ACK}`,
};

/** Context window for mission imagery: AOI + 0.1° margin. */
export const CONTEXT_BOUNDS: Bounds = [-120.5, 35.78, -119.68, 36.5];

/** Window for the sharp optical (HLS 30 m) context: AOI + 0.3° on each side. */
export const OPTICAL_WINDOW: Bounds = [-120.7, 35.58, -119.48, 36.7];

export interface ContextLayerDef {
  layerId: string;
  /** short folder id */
  folder: string;
  title: string;
  kind: "optical" | "radar";
  tileMatrixSet: string;
  ext: string;
  minZoom: number;
  /** highest zoom bundled — must be QA-clean (no holes / noise) over `window` for every date (verify checks) */
  maxZoom: number;
  /** per-date maxZoom override (bundle budget) */
  maxZoomByDate?: Record<string, number>;
  /** tiles are fetched for every zoom over this window; it is also the ContextLayer bounds */
  window: Bounds;
  /** step-tied dates (ContextLayer.stepId = the step) */
  stepIds: string[];
  /** extra dates not tied to a step (ContextLayer.stepId = null) */
  extraDates?: string[];
  /** expected data footprint for tile QA (null = the whole window must be opaque) */
  qaFootprint: LonLat[] | null;
  attribution: string;
  citation: string;
}

/** Optical context dates that are fully overcast over the AOI (checked by eye after fetch; real imagery). */
export const OPTICAL_OVERCAST_STEPS = ["s01"];

export function layerMaxZoom(layer: ContextLayerDef, date?: string): number {
  return (date !== undefined ? layer.maxZoomByDate?.[date] : undefined) ?? layer.maxZoom;
}

/** (date, stepId) pairs of a layer, in manifest order: extra dates first, then step dates. */
export function layerDates(layer: ContextLayerDef): { date: string; stepId: string | null }[] {
  return [
    ...(layer.extraDates ?? []).map((date) => ({
      date,
      stepId: STEP_DEFS.find((s) => s.day === date && s.available)?.stepId ?? null,
    })),
    ...layer.stepIds.map((stepId) => ({ date: stepDay(stepId), stepId })),
  ];
}

/**
 * Order matters: the first optical layer is the app's default optical view (sharpest clear one first).
 * HLS S30 dates were chosen with src/probe-optical.ts (100 % window coverage, ≤ 0.2 % cloud at z7).
 */
export const CONTEXT_LAYERS: ContextLayerDef[] = [
  {
    layerId: "HLS_S30_Nadir_BRDF_Adjusted_Reflectance",
    folder: "hls-s30",
    title: "Sentinel-2 true colour (HLS S30, 30 m)",
    kind: "optical",
    tileMatrixSet: "GoogleMapsCompatible_Level12",
    ext: "png",
    minZoom: 8,
    maxZoom: 11,
    window: OPTICAL_WINDOW,
    stepIds: [],
    extraDates: ["2026-10-17", "2026-06-29"],
    // z11 costs ~9 MB per date: full z8–11 for the default (latest, clear) date, z8–10 for the summer date
    maxZoomByDate: { "2026-06-29": 10 },
    qaFootprint: null,
    attribution: `Harmonized Landsat and Sentinel-2 (HLS) S30 Nadir BRDF-Adjusted Reflectance, NASA LP DAAC; contains modified Copernicus Sentinel-2 data (ESA); via NASA GIBS. ${GIBS_ACK}`,
    citation:
      "NASA GIBS layer HLS_S30_Nadir_BRDF_Adjusted_Reflectance (EPSG:3857, GoogleMapsCompatible_Level12), daily true-colour for the stated date; HLS v2.0 (Masek et al., NASA LP DAAC, doi:10.5067/HLS/HLSS30.002). Bundled z8–11 (≈ 62 m/px at 36° N) for 2026-10-17, z8–10 for 2026-06-29.",
  },
  {
    layerId: "MODIS_Terra_CorrectedReflectance_TrueColor",
    folder: "modis-terra-truecolor",
    title: "MODIS Terra true colour",
    kind: "optical",
    tileMatrixSet: "GoogleMapsCompatible_Level9",
    ext: "jpg",
    minZoom: 5,
    maxZoom: 9,
    window: CONTEXT_BOUNDS,
    stepIds: ["s01", "s03", "s04", "s05", "s06", "s08", "s09"],
    qaFootprint: null,
    attribution: `MODIS Terra Corrected Reflectance (True Color), NASA LANCE/EOSDIS, via NASA GIBS. ${GIBS_ACK}`,
    citation:
      "NASA GIBS layer MODIS_Terra_CorrectedReflectance_TrueColor (EPSG:3857, GoogleMapsCompatible_Level9), daily composite for the step date.",
  },
  {
    layerId: "NISAR_L2_Geocoded_Polarimetric_Covariance",
    folder: "nisar-gcov",
    title: "NISAR L-band backscatter (GCOV, false colour)",
    kind: "radar",
    tileMatrixSet: "GoogleMapsCompatible_Level13",
    ext: "png",
    minZoom: 6,
    // z11 from GIBS had holes, near-empty speckle and noise bands inside the swath on 2025-12-31 and
    // 2026-10-15 (tile-qa: 9 and 10 bad of 36 tiles); z6–10 are clean on all 7 dates → maxZoom 10.
    maxZoom: 10,
    window: CONTEXT_BOUNDS,
    stepIds: ["s01", "s03", "s04", "s05", "s06", "s08", "s09"],
    qaFootprint: FRAME_POLYGON,
    attribution: `NISAR L2 GCOV normalized radar backscatter (false colour), NASA/JPL-Caltech & ISRO, ASF DAAC, via NASA GIBS. ${GIBS_ACK}`,
    citation:
      "NASA GIBS layer NISAR_L2_Geocoded_Polarimetric_Covariance (EPSG:3857, GoogleMapsCompatible_Level13), daily 'best' composite for the step date; the AOI is imaged by track 042 descending frame 070 on these dates.",
  },
];

export function stepDay(stepId: string): string {
  const s = STEP_DEFS.find((d) => d.stepId === stepId);
  if (!s) throw new Error(`unknown step ${stepId}`);
  return s.day;
}
