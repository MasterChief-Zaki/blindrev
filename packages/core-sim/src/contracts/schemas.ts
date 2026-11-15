/**
 * Zod mirrors of the shared contracts in ./types.ts (docs/ARCHITECTURE.md §3).
 *
 * - Every interface/type `X` has a schema `XSchema`.
 * - `parseX(json)` validates unknown JSON and throws a `ContractValidationError`
 *   whose message lists every issue as `path: message`.
 * - Compile-time checks at the bottom of this file fail `tsc` if a schema's
 *   inferred type drifts from its interface.
 */
import { z } from "zod";
import type {
  Bounds,
  CameraConfig,
  ContextLayer,
  DataLabel,
  GameConstants,
  GridSpec,
  LonLat,
  MaskAsset,
  MissionManifest,
  QualityPreset,
  ScoringConfig,
  TemporalStep,
  TleSnapshot,
  Vec3,
} from "./types";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const finite = () => z.number().finite();
const nonNeg = () => z.number().finite().nonnegative();
const positive = () => z.number().finite().positive();
const posInt = () => z.number().int().positive();
const nonEmpty = () => z.string().min(1, "must not be empty");

/** Any string `Date.parse` understands as ISO-8601 (date or date-time). */
const isoDateString = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, "must be an ISO-8601 date or date-time (YYYY-MM-DD…)")
    .refine((s) => !Number.isNaN(Date.parse(s)), "must be a valid ISO-8601 date or date-time");

/** Runtime asset URL: relative to the app base URL, no leading slash (ARCHITECTURE §2). */
const relativeUrl = () =>
  z
    .string()
    .refine((s) => !s.startsWith("/"), "asset URLs must be relative to the app base (no leading '/')")
    .refine((s) => !s.includes("\\"), "asset URLs must use '/' separators");

const hexColor = () => z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #RRGGBB colour");

export const BoundsSchema = z
  .tuple([finite(), finite(), finite(), finite()])
  .refine(([w, , e]) => w >= -180 && w <= 180 && e >= -180 && e <= 180, {
    message: "west/east must be within [-180, 180] degrees",
  })
  .refine(([, s, , n]) => s >= -90 && n <= 90 && s < n, {
    message: "south/north must be within [-90, 90] degrees and south < north",
  });

export const LonLatSchema = z.object({
  lon: finite(),
  lat: finite().min(-90).max(90),
});

export const Vec3Schema = z.object({ x: finite(), y: finite(), z: finite() });

export const DATA_LABELS = ["SIMULATED", "PLACEHOLDER", "TEST_FIXTURE", "STALE_EPHEMERIS", "OFFLINE"] as const;
export const DataLabelSchema = z.enum(DATA_LABELS);

const TilingSchema = z
  .object({
    tileMatrixSet: nonEmpty(),
    minZoom: z.number().int().nonnegative(),
    maxZoom: z.number().int().nonnegative(),
  })
  .refine((t) => t.minZoom <= t.maxZoom, { message: "tiling.minZoom must be <= tiling.maxZoom" })
  .refine((t) => t.tileMatrixSet !== "SINGLE_TILE" || (t.minZoom === 0 && t.maxZoom === 0), {
    message: "SINGLE_TILE tiling must use minZoom 0 and maxZoom 0",
  });

// ---------------------------------------------------------------------------
// TemporalStep (spec §4 v2)
// ---------------------------------------------------------------------------

const DisplacementSchema = z.object({
  quantity: z.enum(["los", "vertical"]),
  unit: z.enum(["mm", "cm", "m"]),
  signConvention: nonEmpty(),
  referenceStepId: z.string().nullable(),
  referencePoint: z.object({ lon: finite(), lat: finite(), heightM: finite() }).nullable(),
  incidenceAngleDeg: finite().nullable(),
  lineOfSight: z.object({ east: finite(), north: finite(), up: finite() }).nullable(),
});

const AcquisitionSchema = z.object({
  track: z.number().int().nullable(),
  frame: z.number().int().nullable(),
  orbitDirection: z.enum(["ASCENDING", "DESCENDING"]),
});

export const TemporalStepSchema = z
  .object({
    schemaVersion: z.literal(2),
    stepId: nonEmpty(),
    date: isoDateString(),
    acquisitionStart: isoDateString(),
    acquisitionEnd: isoDateString(),
    isAvailable: z.boolean(),
    platform: z.string(),
    instrument: z.string(),
    processingVersion: z.string(),
    sourceId: z.string(),
    layerId: z.string(),
    tileUrlTemplate: relativeUrl(),
    crs: z.enum(["EPSG:4326", "EPSG:3857"]),
    bounds: BoundsSchema,
    resolutionMeters: positive(),
    noDataValue: finite().nullable(),
    displacement: DisplacementSchema.nullable(),
    acquisition: AcquisitionSchema.nullable(),
    tiling: TilingSchema,
    qaMaskId: z.string().nullable(),
    qaMaskUrlTemplate: relativeUrl().nullable(),
    evidenceMaskId: z.string().nullable(),
    evidenceMaskUrlTemplate: relativeUrl().nullable(),
    uncertainty: finite().nullable(),
    uncertaintyType: z.enum(["rmse_mm", "std_dev", "categorical_confidence", "none"]),
    license: nonEmpty(),
    attribution: nonEmpty(),
    citation: z.string(),
  })
  .superRefine((s, ctx) => {
    if (s.isAvailable && s.tileUrlTemplate === "") {
      ctx.addIssue({ code: "custom", path: ["tileUrlTemplate"], message: "available steps need a tileUrlTemplate" });
    }
    if (!s.isAvailable && s.tileUrlTemplate !== "") {
      ctx.addIssue({
        code: "custom",
        path: ["tileUrlTemplate"],
        message: 'unavailable steps must have tileUrlTemplate "" (contract §3)',
      });
    }
    if (Date.parse(s.acquisitionStart) > Date.parse(s.acquisitionEnd)) {
      ctx.addIssue({ code: "custom", path: ["acquisitionEnd"], message: "acquisitionEnd must be >= acquisitionStart" });
    }
  });

// ---------------------------------------------------------------------------
// Grids & masks
// ---------------------------------------------------------------------------

const gridShape = {
  width: posInt(),
  height: posInt(),
  bounds: BoundsSchema,
  crs: z.literal("EPSG:4326"),
};

export const GridSpecSchema = z.object(gridShape);

export const MaskAssetSchema = z.object({
  ...gridShape,
  maskId: nonEmpty(),
  version: nonEmpty(),
  binUrl: relativeUrl().pipe(nonEmpty()),
  pngUrl: relativeUrl().pipe(nonEmpty()),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex SHA-256 digest (64 chars)"),
});

export const MaskGridSchema = z.object({
  ...gridShape,
  data: z.instanceof(Uint8Array),
});

// ---------------------------------------------------------------------------
// Context layers, scoring, mission manifest
// ---------------------------------------------------------------------------

export const ContextLayerSchema = z.object({
  layerId: nonEmpty(),
  title: nonEmpty(),
  kind: z.enum(["optical", "radar", "basemap"]),
  date: isoDateString().nullable(),
  stepId: z.string().nullable(),
  crs: z.literal("EPSG:3857"),
  bounds: BoundsSchema,
  tileUrlTemplate: relativeUrl().pipe(nonEmpty()),
  onlineUrlTemplate: z.string().nullable(),
  tiling: TilingSchema,
  license: nonEmpty(),
  attribution: nonEmpty(),
  citation: z.string(),
});

const unit = () => z.number().finite().min(0).max(1);

export const ScoringConfigSchema = z
  .object({
    dtMinDays: nonNeg(),
    iouPass: unit(),
    iouPartial: unit(),
    advisoryPrecisionRecall: unit(),
    roiAreaMinKm2: positive(),
    roiAreaMaxKm2: positive(),
    qaMinCoverage: unit(),
    qaMinValidPixels: z.number().int().nonnegative(),
    maskRegistrationMaxPx: nonNeg(),
  })
  .refine((c) => c.iouPartial <= c.iouPass, { message: "iouPartial must be <= iouPass", path: ["iouPartial"] })
  .refine((c) => c.roiAreaMinKm2 < c.roiAreaMaxKm2, {
    message: "roiAreaMinKm2 must be < roiAreaMaxKm2",
    path: ["roiAreaMinKm2"],
  });

const PlaceSchema = z.object({ lon: finite(), lat: finite().min(-90).max(90), heightM: finite() });

export const MissionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    missionId: nonEmpty(),
    caseId: nonEmpty(),
    title: nonEmpty(),
    kicker: z.string(),
    theme: z.enum(["subsidence", "deforestation", "glacier", "wetlands"]),
    aoi: z.object({
      decision: z.enum(["PENDING", "INJECTED"]),
      bounds: BoundsSchema.nullable(),
      name: z.string().nullable(),
      source: z.string().nullable(),
      injectedBy: z.string().nullable(),
      injectedAt: isoDateString().nullable(),
    }),
    effectiveBounds: BoundsSchema,
    labels: z.array(DataLabelSchema),
    briefing: z.object({
      question: nonEmpty(),
      summary: z.string(),
      body: z.array(z.string()),
      location: z.string(),
      dates: z.string(),
      source: z.string(),
      facts: z.array(z.object({ text: nonEmpty(), source: nonEmpty() })),
    }),
    steps: z.array(TemporalStepSchema).min(1, "a mission needs at least one temporal step"),
    masks: z.record(z.string(), MaskAssetSchema),
    referenceMaskId: nonEmpty(),
    referencePolygons: z.array(z.array(LonLatSchema)),
    contextLayers: z.array(ContextLayerSchema),
    legend: z.object({
      ramp: z.tuple([hexColor(), hexColor(), hexColor()]),
      labels: z.tuple([z.string(), z.string(), z.string()]),
      unit: z.string(),
      thresholds: z.tuple([finite(), finite()]),
    }),
    camera: z.object({ home: PlaceSchema, aoi: PlaceSchema }),
    attributions: z.array(z.string()),
  })
  .superRefine((m, ctx) => {
    if (m.aoi.decision === "INJECTED" && m.aoi.bounds === null) {
      ctx.addIssue({ code: "custom", path: ["aoi", "bounds"], message: "INJECTED AOI must carry bounds" });
    }
    const seen = new Set<string>();
    let prev = Number.NEGATIVE_INFINITY;
    m.steps.forEach((s, i) => {
      if (seen.has(s.stepId)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "stepId"], message: `duplicate stepId "${s.stepId}"` });
      }
      seen.add(s.stepId);
      const t = Date.parse(s.date);
      if (t < prev) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "date"], message: "steps must be chronological" });
      }
      prev = t;
      if (s.qaMaskId !== null && !(s.qaMaskId in m.masks)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "qaMaskId"],
          message: `qaMaskId "${s.qaMaskId}" is not present in masks`,
        });
      }
    });
    for (const [key, mask] of Object.entries(m.masks)) {
      if (key !== mask.maskId) {
        ctx.addIssue({
          code: "custom",
          path: ["masks", key, "maskId"],
          message: `masks key "${key}" must equal maskId "${mask.maskId}"`,
        });
      }
    }
    if (!(m.referenceMaskId in m.masks)) {
      ctx.addIssue({
        code: "custom",
        path: ["referenceMaskId"],
        message: `referenceMaskId "${m.referenceMaskId}" is not present in masks`,
      });
    }
    m.contextLayers.forEach((l, i) => {
      if (l.stepId !== null && !seen.has(l.stepId)) {
        ctx.addIssue({
          code: "custom",
          path: ["contextLayers", i, "stepId"],
          message: `stepId "${l.stepId}" does not match any step`,
        });
      }
    });
  });

// ---------------------------------------------------------------------------
// Prefabs: quality presets, camera config, game constants, TLE snapshot
// ---------------------------------------------------------------------------

export const QualityPresetSchema = z.object({
  id: z.enum(["low", "medium", "high"]),
  tileCacheSize: posInt(),
  maximumScreenSpaceError: positive(),
  renderScale: z.number().finite().positive().max(2),
  allow4k: z.boolean(),
});

export const QualityPresetsSchema = z
  .array(QualityPresetSchema)
  .refine((a) => a.length === 3 && new Set(a.map((p) => p.id)).size === 3, {
    message: "quality presets must contain exactly one each of low, medium, high",
  });

export const CameraConfigSchema = z
  .object({
    k: positive(),
    vMinMps: positive(),
    vMaxMps: positive(),
    minClearanceM: nonNeg(),
    minEllipsoidalHeightM: nonNeg(),
    rangeMinM: positive(),
    rangeMaxM: positive(),
    latClampDeg: z.number().finite().positive().max(90),
    zoomRatePerS: positive(),
    wheelZoomStep: positive(),
    terrainSamples: posInt(),
    home: z.object({
      lonDeg: finite().min(-180).max(180),
      latDeg: finite().min(-90).max(90),
      rangeM: positive(),
      headingDeg: finite(),
      pitchDeg: finite().min(-90).max(90),
    }),
  })
  .refine((c) => c.vMinMps <= c.vMaxMps, { message: "vMinMps must be <= vMaxMps", path: ["vMinMps"] })
  .refine((c) => c.rangeMinM < c.rangeMaxM, { message: "rangeMinM must be < rangeMaxM", path: ["rangeMinM"] })
  .refine((c) => c.home.rangeM >= c.rangeMinM && c.home.rangeM <= c.rangeMaxM, {
    message: "home.rangeM must lie within [rangeMinM, rangeMaxM]",
    path: ["home", "rangeM"],
  });

export const GameConstantsSchema = z.object({
  scoring: ScoringConfigSchema,
  tle: z
    .object({ maxAgeHours: positive(), freshWindowHours: positive(), noradId: posInt() })
    .refine((t) => t.freshWindowHours <= t.maxAgeHours, {
      message: "freshWindowHours must be <= maxAgeHours",
      path: ["freshWindowHours"],
    }),
  wipe: z.object({ durationMs: nonNeg(), easing: nonEmpty(), progressCapMs: positive() }),
  soak: z.object({ durationMin: positive(), snapshotS: positive(), maxHeapDeltaMb: positive() }),
  visualCi: z.object({ maxDiffRatio: unit() }),
  roiNudgeDeg: positive(),
  roiNudgeCoarseFactor: positive(),
});

/** Mod-10 TLE line checksum (digits count face value, '-' counts 1). */
export function tleLineChecksumOk(line: string): boolean {
  if (line.length !== 69) return false;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const c = line.charAt(i);
    if (c >= "0" && c <= "9") sum += c.charCodeAt(0) - 48;
    else if (c === "-") sum += 1;
  }
  return sum % 10 === Number(line.charAt(68));
}

const tleLine = (n: 1 | 2) =>
  z
    .string()
    .refine((l) => l.length === 69, { message: `TLE line ${n} must be exactly 69 characters` })
    .refine((l) => l.startsWith(`${n} `), { message: `TLE line ${n} must start with "${n} "` })
    .refine(tleLineChecksumOk, { message: `TLE line ${n} checksum mismatch` });

export const TleSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    noradId: posInt(),
    name: nonEmpty(),
    line1: tleLine(1),
    line2: tleLine(2),
    epochIso: isoDateString(),
    fetchedAt: isoDateString(),
    source: nonEmpty(),
  })
  .refine((t) => Number(t.line1.slice(2, 7)) === t.noradId && Number(t.line2.slice(2, 7)) === t.noradId, {
    message: "noradId must match the catalogue number in both TLE lines",
    path: ["noradId"],
  });

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

export interface ContractIssue {
  path: string;
  message: string;
}

/** Thrown by every `parseX` helper; `message` is human-readable, `issues` is structured. */
export class ContractValidationError extends Error {
  readonly contract: string;
  readonly issues: ContractIssue[];
  constructor(contract: string, issues: ContractIssue[], source?: string) {
    const where = source ? ` (${source})` : "";
    const lines = issues.slice(0, 25).map((i) => `  - ${i.path || "<root>"}: ${i.message}`);
    if (issues.length > 25) lines.push(`  … and ${issues.length - 25} more`);
    super(`Invalid ${contract}${where}: ${issues.length} issue(s)\n${lines.join("\n")}`);
    this.name = "ContractValidationError";
    this.contract = contract;
    this.issues = issues;
  }
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out === "" ? String(seg) : `.${String(seg)}`;
  }
  return out;
}

/** Validate `json` against `schema`; throws `ContractValidationError` on failure. */
export function parseContract<S extends z.ZodType>(
  schema: S,
  contract: string,
  json: unknown,
  source?: string,
): z.output<S> {
  const r = schema.safeParse(json);
  if (r.success) return r.data;
  throw new ContractValidationError(
    contract,
    r.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })),
    source,
  );
}

export const parseMissionManifest = (json: unknown, source?: string): MissionManifest =>
  parseContract(MissionManifestSchema, "MissionManifest", json, source);
export const parseTemporalStep = (json: unknown, source?: string): TemporalStep =>
  parseContract(TemporalStepSchema, "TemporalStep", json, source);
export const parseCameraConfig = (json: unknown, source?: string): CameraConfig =>
  parseContract(CameraConfigSchema, "CameraConfig", json, source);
export const parseQualityPresets = (json: unknown, source?: string): QualityPreset[] =>
  parseContract(QualityPresetsSchema, "QualityPreset[]", json, source);
export const parseGameConstants = (json: unknown, source?: string): GameConstants =>
  parseContract(GameConstantsSchema, "GameConstants", json, source);
export const parseTleSnapshot = (json: unknown, source?: string): TleSnapshot =>
  parseContract(TleSnapshotSchema, "TleSnapshot", json, source);
export const parseMaskAsset = (json: unknown, source?: string): MaskAsset =>
  parseContract(MaskAssetSchema, "MaskAsset", json, source);
export const parseContextLayer = (json: unknown, source?: string): ContextLayer =>
  parseContract(ContextLayerSchema, "ContextLayer", json, source);

// ---------------------------------------------------------------------------
// Compile-time drift checks: z.infer<Schema> must be mutually assignable with
// the interface. A mismatch makes the `true` below fail to type-check.
// ---------------------------------------------------------------------------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Check<T extends true> = T;

export type __ContractDriftChecks = [
  Check<Same<z.infer<typeof BoundsSchema>, Bounds>>,
  Check<Same<z.infer<typeof LonLatSchema>, LonLat>>,
  Check<Same<z.infer<typeof Vec3Schema>, Vec3>>,
  Check<Same<z.infer<typeof DataLabelSchema>, DataLabel>>,
  Check<Same<z.infer<typeof TemporalStepSchema>, TemporalStep>>,
  Check<Same<z.infer<typeof GridSpecSchema>, GridSpec>>,
  Check<Same<z.infer<typeof MaskAssetSchema>, MaskAsset>>,
  Check<Same<z.infer<typeof ContextLayerSchema>, ContextLayer>>,
  Check<Same<z.infer<typeof ScoringConfigSchema>, ScoringConfig>>,
  Check<Same<z.infer<typeof MissionManifestSchema>, MissionManifest>>,
  Check<Same<z.infer<typeof QualityPresetSchema>, QualityPreset>>,
  Check<Same<z.infer<typeof QualityPresetsSchema>, QualityPreset[]>>,
  Check<Same<z.infer<typeof CameraConfigSchema>, CameraConfig>>,
  Check<Same<z.infer<typeof GameConstantsSchema>, GameConstants>>,
  Check<Same<z.infer<typeof TleSnapshotSchema>, TleSnapshot>>,
];
