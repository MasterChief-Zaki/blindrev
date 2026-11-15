/**
 * The offline, deterministic forge: evidence rasters, QA masks, reference mask, mission manifest,
 * basemap prefab and the PENDING-path test fixture. Pure function of src/config.ts + src/reference.ts
 * (no network, no clock, no Math.random). Re-running it must reproduce byte-identical files.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextLayer, GridSpec, MaskAsset, MissionManifest, TemporalStep } from "@blindrev/core-sim";
import {
  AOI_BOUNDS,
  AOI_INJECTED_AT,
  AOI_INJECTED_BY,
  AOI_NAME,
  AOI_SOURCE,
  BASEMAP,
  BASEMAP_JSON,
  CONTEXT_LAYERS,
  DISPLAY_FLOOR_MM,
  DISPLAY_GRID_SIZE,
  FIXTURE_JSON,
  GIBS_3857,
  GIBS_ACK,
  GIBS_DOCS,
  INCIDENCE_DEG,
  LEGEND_LABELS,
  LEGEND_UNIT,
  layerDates,
  layerMaxZoom,
  MASK_GRID_SIZE,
  MISSION_DATA_REL,
  MISSION_ID,
  MISSION_JSON,
  NASA_OPEN_LICENSE,
  NISAR_FRAME,
  NISAR_ORBIT_DIRECTION,
  NISAR_TRACK,
  OPTICAL_OVERCAST_STEPS,
  PLATFORM_HEADING_DEG,
  PUBLIC_DIR,
  RAMP,
  REFERENCE_MASK_VERSION,
  REFERENCE_POINT,
  REFERENCE_STEP_ID,
  SEEDS,
  SIMULATED_ATTRIBUTION,
  SIMULATED_LICENSE,
  STEP_DEFS,
  type StepDef,
  THRESHOLDS_MM,
  UNCERTAINTY_RMSE_MM,
} from "./config";
import {
  composeRaw,
  dynamicTerms,
  type FieldContext,
  type InvalidReason,
  makeFieldContext,
  persistentSignal,
  qaReason,
  referenceOffset,
  seasonalShape,
  toKm,
} from "./field";
import { buildFixture } from "./fixture";
import { stableJson, toPosix, writeFileEnsured } from "./paths";
import { encodeIndexedPng } from "./png";
import {
  centreLat,
  centreLon,
  countOnes,
  encodeMaskPng,
  encodeQaPng,
  evidencePalette,
  float32LeBytes,
  makeGrid,
  rasterizePolygonsPnpoly,
} from "./raster";
import { REFERENCE_POLYGONS } from "./reference";

export const FORGE_VERSION = "data-forge-1";

export interface ForgedFile {
  rel: string;
  bytes: number;
  sha256: string;
}

export interface StepStats {
  stepId: string;
  date: string;
  isAvailable: boolean;
  validPixels: number;
  totalPixels: number;
  coverage: number;
  invalidByReason: Record<Exclude<InvalidReason, "VALID">, number>;
  minMm: number | null;
  maxMm: number | null;
  classPixels: { low: number; mid: number; high: number };
}

export interface ForgeResult {
  files: ForgedFile[];
  stats: StepStats[];
  mission: MissionManifest | null;
  fixture: MissionManifest;
  referencePixels: number;
  referenceAreaKm2: number;
}

export interface ForgeOptions {
  /** root that mirrors the repo layout (repo root for a real run, a temp dir for verification) */
  outRoot: string;
  /** only build the PENDING-path fixture */
  pendingOnly?: boolean;
  /** where to read the current mission AOI decision from (defaults to outRoot) */
  aoiFrom?: string;
  log?: (msg: string) => void;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

class Emitter {
  readonly files: ForgedFile[] = [];
  constructor(private readonly root: string) {}
  emit(rel: string, data: Uint8Array | string): ForgedFile {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    writeFileEnsured(join(this.root, rel), bytes);
    const f = { rel: toPosix(rel), bytes: bytes.length, sha256: sha256Hex(bytes) };
    this.files.push(f);
    return f;
  }
}

/** LOS unit vector (ground → satellite, ENU) for a left-looking SAR. */
export function lineOfSight(headingDeg: number, incidenceDeg: number): { east: number; north: number; up: number } {
  const lookAz = ((headingDeg - 90 + 360) % 360) * (Math.PI / 180); // left of the flight direction
  const toSat = lookAz + Math.PI;
  const inc = (incidenceDeg * Math.PI) / 180;
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return {
    east: r4(Math.sin(inc) * Math.sin(toSat)),
    north: r4(Math.sin(inc) * Math.cos(toSat)),
    up: r4(Math.cos(inc)),
  };
}

function evidenceClass(dMm: number): number {
  const s = -dMm; // subsidence magnitude (away from the satellite)
  if (!(s >= DISPLAY_FLOOR_MM)) return 0;
  if (s < THRESHOLDS_MM[0]) return 1;
  if (s < THRESHOLDS_MM[1]) return 2;
  return 3;
}

interface GridStatic {
  grid: GridSpec;
  persistent: Float64Array;
  seasonal: Float64Array;
  xs: Float64Array; // km per column (pixel centres)
  ys: Float64Array; // km per row
  lons: Float64Array;
  lats: Float64Array;
}

function gridStatic(ctx: FieldContext, grid: GridSpec): GridStatic {
  const n = grid.width * grid.height;
  const lons = new Float64Array(grid.width);
  const lats = new Float64Array(grid.height);
  const xs = new Float64Array(grid.width);
  const ys = new Float64Array(grid.height);
  for (let c = 0; c < grid.width; c++) {
    lons[c] = centreLon(grid, c);
    xs[c] = toKm(ctx.frame, lons[c] as number, ctx.frame.lat0).x;
  }
  for (let r = 0; r < grid.height; r++) {
    lats[r] = centreLat(grid, r);
    ys[r] = toKm(ctx.frame, ctx.frame.lon0, lats[r] as number).y;
  }
  const persistent = new Float64Array(n);
  const seasonal = new Float64Array(n);
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      const i = r * grid.width + c;
      persistent[i] = persistentSignal(ctx, xs[c] as number, ys[r] as number);
      seasonal[i] = seasonalShape(ctx, xs[c] as number, ys[r] as number);
    }
  }
  return { grid, persistent, seasonal, xs, ys, lons, lats };
}

/** Displacement (mm, referenced) and QA reason for every pixel of a grid for one step. */
function evalStep(ctx: FieldContext, gs: GridStatic, step: StepDef): { disp: Float64Array; reason: Uint8Array } {
  const { grid } = gs;
  const n = grid.width * grid.height;
  const disp = new Float64Array(n);
  const reason = new Uint8Array(n); // 0 valid, 1 outside frame, 2 persistent low coherence, 3 cropland
  const isRef = step.stepId === REFERENCE_STEP_ID;
  const off = isRef ? 0 : referenceOffset(ctx, step);
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      const i = r * grid.width + c;
      const q = qaReason(ctx, step, gs.lons[c] as number, gs.lats[r] as number);
      reason[i] = q === "VALID" ? 0 : q === "OUTSIDE_FRAME" ? 1 : q === "PERSISTENT_LOW_COHERENCE" ? 2 : 3;
      if (!isRef) {
        const dyn = dynamicTerms(ctx, step, gs.xs[c] as number, gs.ys[r] as number);
        disp[i] = composeRaw(step, gs.persistent[i] as number, gs.seasonal[i] as number, dyn) - off;
      }
    }
  }
  return { disp, reason };
}

function isoDay(d: string): string {
  return d.slice(0, 10);
}

function fmtDay(d: string): string {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, mo, da] = isoDay(d).split("-");
  return `${Number(da)} ${m[Number(mo) - 1]} ${y}`;
}

function contextLayers(): ContextLayer[] {
  const out: ContextLayer[] = [];
  for (const layer of CONTEXT_LAYERS) {
    for (const { date, stepId } of layerDates(layer)) {
      const overcast = layer.kind === "optical" && stepId !== null && OPTICAL_OVERCAST_STEPS.includes(stepId);
      out.push({
        layerId: `${layer.folder}-${date}`,
        title: `${layer.title} · ${fmtDay(date)}${overcast ? " (overcast)" : ""}`,
        kind: layer.kind,
        date,
        stepId,
        crs: "EPSG:3857",
        bounds: [...layer.window],
        tileUrlTemplate: `${MISSION_DATA_REL}/context/${layer.folder}/${date}/{z}/{y}/{x}.${layer.ext}`,
        onlineUrlTemplate: `${GIBS_3857}/${layer.layerId}/default/${date}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.ext}`,
        tiling: { tileMatrixSet: "GoogleMapsCompatible", minZoom: layer.minZoom, maxZoom: layerMaxZoom(layer, date) },
        license: NASA_OPEN_LICENSE,
        attribution: layer.attribution,
        citation: `${layer.citation} Real imagery (not simulated).${overcast ? " Cloud/fog covers the valley on this date — the radar layer sees through it." : ""} GIBS terms: ${GIBS_DOCS}`,
      });
    }
  }
  return out;
}

const AUTHORED_LICENSE = "CC0-1.0 (BlindRev data-forge output; AUTHORED answer key, deterministic)";
const AUTHORED_ATTRIBUTION =
  "AUTHORED by BlindRev (mission answer key: hand-authored polygons rasterised by data-forge). Not simulated data and not a scientific product.";

function licenseRecord(source: string, notes: string, kind: "SIMULATED" | "AUTHORED" = "SIMULATED"): string {
  return stableJson({
    license: kind === "AUTHORED" ? AUTHORED_LICENSE : SIMULATED_LICENSE,
    attribution: kind === "AUTHORED" ? AUTHORED_ATTRIBUTION : SIMULATED_ATTRIBUTION,
    source,
    notes,
    deterministic: true,
    generator: `@blindrev/data-forge ${FORGE_VERSION} (pnpm --filter @blindrev/data-forge forge)`,
  });
}

/** Current AOI decision recorded in the mission file (the pipeline is parameterised by it). */
export function readAoiDecision(root: string): "PENDING" | "INJECTED" {
  const p = join(root, MISSION_JSON);
  if (!existsSync(p)) return "INJECTED";
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as { aoi?: { decision?: string } };
    return j.aoi?.decision === "PENDING" ? "PENDING" : "INJECTED";
  } catch {
    return "INJECTED";
  }
}

export function forge(opts: ForgeOptions): ForgeResult {
  const log = opts.log ?? (() => undefined);
  const em = new Emitter(opts.outRoot);
  const pub = (rel: string) => `${PUBLIC_DIR}/${rel}`;

  // ------------------------------------------------------------------ PENDING fixture (always built)
  const fixture = buildFixture((rel, data) => em.emit(pub(rel), data), sha256Hex);
  em.emit(FIXTURE_JSON, stableJson(fixture));
  log(`fixture: ${FIXTURE_JSON} (${fixture.steps.length} steps, labels ${fixture.labels.join(", ")})`);

  const decision = readAoiDecision(opts.aoiFrom ?? opts.outRoot);
  if (opts.pendingOnly || decision === "PENDING") {
    if (decision === "PENDING" && !opts.pendingOnly) {
      // the mission record itself is PENDING → the mission runs on the labelled fixture
      em.emit(MISSION_JSON, stableJson({ ...fixture, missionId: MISSION_ID }));
      log(`${MISSION_JSON}: aoi.decision is PENDING → wrote TEST_FIXTURE mission`);
    }
    return { files: em.files, stats: [], mission: null, fixture, referencePixels: 0, referenceAreaKm2: 0 };
  }

  // ------------------------------------------------------------------ INJECTED mission
  const ctx = makeFieldContext(AOI_BOUNDS, STEP_DEFS);
  const maskGrid = makeGrid(AOI_BOUNDS, MASK_GRID_SIZE);
  const dispGrid = makeGrid(AOI_BOUNDS, DISPLAY_GRID_SIZE);
  const gsMask = gridStatic(ctx, maskGrid);
  const gsDisp = gridStatic(ctx, dispGrid);
  const base = MISSION_DATA_REL;
  const masks: Record<string, MaskAsset> = {};
  const stats: StepStats[] = [];
  const steps: TemporalStep[] = [];
  const evidenceIndex: unknown[] = [];
  const los = lineOfSight(PLATFORM_HEADING_DEG, INCIDENCE_DEG);
  const kmPerDegLon = ctx.frame.kx;
  const resolutionMeters = Math.round(
    Math.max(
      ((AOI_BOUNDS[2] - AOI_BOUNDS[0]) / DISPLAY_GRID_SIZE) * kmPerDegLon,
      ((AOI_BOUNDS[3] - AOI_BOUNDS[1]) / DISPLAY_GRID_SIZE) * ctx.frame.ky,
    ) * 1000,
  );
  const refDef = STEP_DEFS.find((s) => s.stepId === REFERENCE_STEP_ID);
  if (!refDef) throw new Error("reference step missing");

  em.emit(
    pub(`${base}/evidence/ASSET_LICENSE.json`),
    licenseRecord(
      "packages/data-forge/src/forge.ts",
      "SIMULATED cumulative line-of-sight displacement (mm). Display PNGs: 1024×1024, EPSG:4326, matte 3-step subsidence ramp. " +
        ".f32: 512×512 Float32 little-endian, mm, NaN = invalid (QA). Only the acquisition dates/track/frame/orbit direction are real (NISAR catalogue).",
    ),
  );
  em.emit(
    pub(`${base}/qa/ASSET_LICENSE.json`),
    licenseRecord(
      "packages/data-forge/src/forge.ts",
      "SIMULATED coherence/QA masks. .bin: 512×512 Uint8 row-major, 1 = valid, 0 = invalid. .png: same grid, hatched matte pattern on invalid pixels.",
    ),
  );
  em.emit(
    pub(`${base}/reference/ASSET_LICENSE.json`),
    licenseRecord(
      "packages/data-forge/src/reference.ts",
      "AUTHORED reference change mask (mission answer key, not a scientific product): polygons rasterised by pixel-centre containment (even-odd) on the 512×512 grid.",
      "AUTHORED",
    ),
  );

  for (const def of STEP_DEFS) {
    if (!def.available) {
      const reason =
        `No acquisition: NISAR track 0${NISAR_TRACK} frame 0${NISAR_FRAME} (${NISAR_ORBIT_DIRECTION}) has no GCOV and no GUNW granule for ` +
        `repeat cycle ${String(def.cycle).padStart(3, "0")} (${def.day}) in the NASA CMR catalogue (collection C2854335566-ASF, queried 2026-11-15) ` +
        "or in ../sars/EDA/data/granules_GCOV_PROVISIONAL.csv / granules_GUNW_PROVISIONAL.csv. Nothing is interpolated for this date.";
      steps.push({
        schemaVersion: 2,
        stepId: def.stepId,
        date: def.day,
        acquisitionStart: def.day,
        acquisitionEnd: def.day,
        isAvailable: false,
        platform: "NISAR",
        instrument: "L-SAR (L-band SAR)",
        processingVersion: "NONE (no acquisition)",
        sourceId: `NO_ACQUISITION:nisar-042-D-070:cycle-${String(def.cycle).padStart(3, "0")}`,
        layerId: "blindrev-sim-los-displacement",
        tileUrlTemplate: "",
        crs: "EPSG:4326",
        bounds: [...AOI_BOUNDS],
        resolutionMeters,
        noDataValue: null,
        displacement: null,
        acquisition: null,
        tiling: { tileMatrixSet: "SINGLE_TILE", minZoom: 0, maxZoom: 0 },
        qaMaskId: null,
        qaMaskUrlTemplate: null,
        evidenceMaskId: null,
        evidenceMaskUrlTemplate: null,
        uncertainty: null,
        uncertaintyType: "none",
        license: "n/a — no data for this date (metadata CC0-1.0)",
        attribution: "NISAR catalogue: NASA/JPL-Caltech, ASF DAAC (NASA CMR)",
        citation: reason,
      });
      stats.push({
        stepId: def.stepId,
        date: def.day,
        isAvailable: false,
        validPixels: 0,
        totalPixels: 0,
        coverage: 0,
        invalidByReason: { OUTSIDE_FRAME: 0, PERSISTENT_LOW_COHERENCE: 0, CROPLAND_DECORRELATION: 0 },
        minMm: null,
        maxMm: null,
        classPixels: { low: 0, mid: 0, high: 0 },
      });
      evidenceIndex.push({ stepId: def.stepId, date: def.day, isAvailable: false });
      log(`  ${def.stepId} ${def.day}  NO ACQUISITION`);
      continue;
    }

    // ---- scoring grid: displacement .f32 + QA .bin/.png
    const m = evalStep(ctx, gsMask, def);
    const n = maskGrid.width * maskGrid.height;
    const valid = new Uint8Array(n);
    const f32 = new Float32Array(n);
    const byReason = { OUTSIDE_FRAME: 0, PERSISTENT_LOW_COHERENCE: 0, CROPLAND_DECORRELATION: 0 };
    let minMm = Number.POSITIVE_INFINITY;
    let maxMm = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const rsn = m.reason[i] as number;
      if (rsn === 0) {
        valid[i] = 1;
        const d = m.disp[i] as number;
        f32[i] = d;
        const df = f32[i] as number;
        if (df < minMm) minMm = df;
        if (df > maxMm) maxMm = df;
      } else {
        f32[i] = Number.NaN;
        if (rsn === 1) byReason.OUTSIDE_FRAME++;
        else if (rsn === 2) byReason.PERSISTENT_LOW_COHERENCE++;
        else byReason.CROPLAND_DECORRELATION++;
      }
    }
    const qaId = `qa-${def.stepId}`;
    const qaBin = em.emit(pub(`${base}/qa/${def.stepId}.bin`), valid);
    em.emit(pub(`${base}/qa/${def.stepId}.png`), encodeQaPng(valid, maskGrid));
    em.emit(pub(`${base}/evidence/${def.stepId}.f32`), float32LeBytes(f32));
    masks[qaId] = {
      ...maskGrid,
      bounds: [...maskGrid.bounds],
      maskId: qaId,
      version: FORGE_VERSION,
      binUrl: `${base}/qa/${def.stepId}.bin`,
      pngUrl: `${base}/qa/${def.stepId}.png`,
      sha256: qaBin.sha256,
    };

    // ---- display grid: classified evidence PNG (same analytic field, 2× sampling)
    const d = evalStep(ctx, gsDisp, def);
    const nd = dispGrid.width * dispGrid.height;
    const idx = new Uint8Array(nd);
    const cls = { low: 0, mid: 0, high: 0 };
    for (let i = 0; i < nd; i++) {
      if ((d.reason[i] as number) !== 0) continue;
      const k = evidenceClass(d.disp[i] as number);
      idx[i] = k;
      if (k === 1) cls.low++;
      else if (k === 2) cls.mid++;
      else if (k === 3) cls.high++;
    }
    em.emit(
      pub(`${base}/evidence/${def.stepId}.png`),
      encodeIndexedPng(dispGrid.width, dispGrid.height, idx, evidencePalette(RAMP)),
    );

    const validPixels = countOnes(valid);
    const st: StepStats = {
      stepId: def.stepId,
      date: def.day,
      isAvailable: true,
      validPixels,
      totalPixels: n,
      coverage: validPixels / n,
      invalidByReason: byReason,
      minMm: Number.isFinite(minMm) ? Math.round(minMm * 10) / 10 : null,
      maxMm: Number.isFinite(maxMm) ? Math.round(maxMm * 10) / 10 : null,
      classPixels: cls,
    };
    stats.push(st);
    evidenceIndex.push({
      stepId: def.stepId,
      date: def.acquisitionStart,
      isAvailable: true,
      pngUrl: `${base}/evidence/${def.stepId}.png`,
      f32Url: `${base}/evidence/${def.stepId}.f32`,
      qaBinUrl: `${base}/qa/${def.stepId}.bin`,
      qaPngUrl: `${base}/qa/${def.stepId}.png`,
      validCoverage: Math.round(st.coverage * 10000) / 10000,
      minMm: st.minMm,
      maxMm: st.maxMm,
    });
    log(
      `  ${def.stepId} ${def.day}  coverage ${(st.coverage * 100).toFixed(1)} %  min ${st.minMm} mm  LOW/MID/HIGH px ${cls.low}/${cls.mid}/${cls.high}`,
    );

    const isRef = def.stepId === REFERENCE_STEP_ID;
    steps.push({
      schemaVersion: 2,
      stepId: def.stepId,
      date: def.acquisitionStart ?? def.day,
      acquisitionStart: def.acquisitionStart ?? def.day,
      acquisitionEnd: def.acquisitionEnd ?? def.day,
      isAvailable: true,
      platform: "NISAR",
      instrument: "L-SAR (L-band SAR)",
      processingVersion: `SIMULATED/${FORGE_VERSION} (seeded synthetic values; no NISAR measurement)`,
      sourceId: `SIMULATED:${MISSION_ID}:${def.stepId} (real acquisition metadata: ${def.gcovGranule})`,
      layerId: "blindrev-sim-los-displacement",
      tileUrlTemplate: `${base}/evidence/${def.stepId}.png`,
      crs: "EPSG:4326",
      bounds: [...AOI_BOUNDS],
      resolutionMeters,
      noDataValue: null,
      displacement: {
        quantity: "los",
        unit: "mm",
        signConvention:
          "Cumulative line-of-sight displacement since the reference acquisition (s01, 2025-12-31). Positive = motion toward the satellite; " +
          "negative = motion away from the satellite (subsidence). Display classes show subsidence magnitude.",
        referenceStepId: REFERENCE_STEP_ID,
        referencePoint: { ...REFERENCE_POINT },
        incidenceAngleDeg: INCIDENCE_DEG,
        lineOfSight: los,
      },
      acquisition: { track: NISAR_TRACK, frame: NISAR_FRAME, orbitDirection: NISAR_ORBIT_DIRECTION },
      tiling: { tileMatrixSet: "SINGLE_TILE", minZoom: 0, maxZoom: 0 },
      qaMaskId: qaId,
      qaMaskUrlTemplate: `${base}/qa/${def.stepId}.png`,
      evidenceMaskId: null,
      evidenceMaskUrlTemplate: null,
      uncertainty: isRef ? null : UNCERTAINTY_RMSE_MM,
      uncertaintyType: isRef ? "none" : "rmse_mm",
      license: SIMULATED_LICENSE,
      attribution: SIMULATED_ATTRIBUTION,
      citation:
        (isRef ? "Reference epoch: displacement is zero by definition. " : "") +
        `SIMULATED values (BlindRev data-forge ${FORGE_VERSION}, seeds ${Object.values(SEEDS)
          .map((s) => `0x${s.toString(16)}`)
          .join("/")}). Only the acquisition metadata is real: NISAR L2 GCOV granule ${def.gcovGranule}; ` +
        `GUNW pair ${def.gunwGranule} (NASA/JPL-Caltech & ISRO; ASF DAAC; NASA CMR collection C2854335566-ASF, queried 2026-11-15).`,
    });
  }

  // ------------------------------------------------------------------ reference mask (answer key)
  const refMask = rasterizePolygonsPnpoly(REFERENCE_POLYGONS, maskGrid);
  const refId = `reference-${REFERENCE_MASK_VERSION}`;
  const refBin = em.emit(pub(`${base}/reference/mask-${REFERENCE_MASK_VERSION}.bin`), refMask);
  em.emit(pub(`${base}/reference/mask-${REFERENCE_MASK_VERSION}.png`), encodeMaskPng(refMask, maskGrid));
  masks[refId] = {
    ...maskGrid,
    bounds: [...maskGrid.bounds],
    maskId: refId,
    version: REFERENCE_MASK_VERSION,
    binUrl: `${base}/reference/mask-${REFERENCE_MASK_VERSION}.bin`,
    pngUrl: `${base}/reference/mask-${REFERENCE_MASK_VERSION}.png`,
    sha256: refBin.sha256,
  };
  const referencePixels = countOnes(refMask);
  // pixel area on the sphere-ish grid (cos-lat per row) — informative only
  let referenceAreaKm2 = 0;
  for (let r = 0; r < maskGrid.height; r++) {
    const lat = centreLat(maskGrid, r);
    const pxKm2 =
      ((AOI_BOUNDS[2] - AOI_BOUNDS[0]) / maskGrid.width) *
      111.32 *
      Math.cos((lat * Math.PI) / 180) *
      (((AOI_BOUNDS[3] - AOI_BOUNDS[1]) / maskGrid.height) * 110.57);
    for (let c = 0; c < maskGrid.width; c++) if (refMask[r * maskGrid.width + c] === 1) referenceAreaKm2 += pxKm2;
  }
  referenceAreaKm2 = Math.round(referenceAreaKm2 * 10) / 10;
  log(`  reference mask ${refId}: ${referencePixels} px ≈ ${referenceAreaKm2} km²`);

  em.emit(
    pub(`${base}/evidence/index.json`),
    stableJson({
      schema: "blindrev.evidence-index/1",
      label: "SIMULATED",
      grid: { ...maskGrid },
      displayGrid: { ...dispGrid },
      f32: {
        dtype: "float32",
        endianness: "little",
        unit: "mm",
        quantity: "los",
        noData: "NaN",
        rowOrder: "north-to-south",
      },
      legend: {
        ramp: RAMP,
        labels: LEGEND_LABELS,
        unit: LEGEND_UNIT,
        floorMm: DISPLAY_FLOOR_MM,
        thresholdsMm: THRESHOLDS_MM,
      },
      referenceStepId: REFERENCE_STEP_ID,
      steps: evidenceIndex,
    }),
  );

  // ------------------------------------------------------------------ manifest
  const first = STEP_DEFS[0] as StepDef;
  const last = STEP_DEFS[STEP_DEFS.length - 1] as StepDef;
  const centre = { lon: (AOI_BOUNDS[0] + AOI_BOUNDS[2]) / 2, lat: (AOI_BOUNDS[1] + AOI_BOUNDS[3]) / 2 };
  const mission: MissionManifest = {
    schemaVersion: 1,
    missionId: MISSION_ID,
    caseId: "CASE_001",
    title: "The Sinking City",
    kicker: "Shifting ground",
    theme: "subsidence",
    aoi: {
      decision: "INJECTED",
      bounds: [...AOI_BOUNDS],
      name: AOI_NAME,
      source: AOI_SOURCE,
      injectedBy: AOI_INJECTED_BY,
      injectedAt: AOI_INJECTED_AT,
    },
    effectiveBounds: [...AOI_BOUNDS],
    labels: ["SIMULATED"],
    briefing: {
      question: "Where has the ground changed?",
      summary:
        "Farms along the California Aqueduct pump groundwater, and the land above can sink. Follow ten months of radar passes and mark the ground that keeps going down.",
      body: [
        "This is the San Joaquin Valley between Huron and Kettleman City. The aqueduct carries water south right through it.",
        "Every step is a real NISAR pass: track 042, descending, frame 070. The ground motion you see is SIMULATED for this case. Only the dates and the orbit geometry are real.",
        "Some changes are just weather in the radar signal. They show up once and are gone on the next pass. Look for ground that keeps sinking, step after step.",
        "Hatched areas had low radar coherence on that pass, so there is nothing reliable to read there.",
        'Two passes are missing from the record. They are marked "No acquisition", and nothing is filled in for them.',
        "Pick two dates at least 24 days apart, outline your region and validate it. The score compares your region with an authored answer mask. It is a mission score, not a scientific measurement.",
      ],
      location: `${AOI_NAME} · ${centre.lat.toFixed(2)}° N, ${Math.abs(centre.lon).toFixed(2)}° W`,
      dates: `${fmtDay(first.day)} – ${fmtDay(last.day)} · ${STEP_DEFS.length} passes, every third 12-day cycle · ${STEP_DEFS.filter((s) => !s.available).length} with no acquisition`,
      source:
        "Dates, track and frame: NISAR catalogue (NASA CMR, ASF DAAC). Displacement and coherence: SIMULATED by BlindRev data-forge. Context imagery: NASA GIBS (HLS S30 Sentinel-2 true colour — contains modified Copernicus Sentinel-2 data; MODIS Terra; NISAR GCOV; Blue Marble).",
      facts: [
        {
          text: "In 2014, the second year of extreme drought, pumping opened a subsidence bowl across the California Aqueduct. The closest parts of the canal sank more than 12 inches.",
          source:
            "../sars/08_NISAR_White_Papers/text/NISAR_Applications_Drought_and_Groundwater_Withdrawal1.txt (l.89–97)",
        },
        {
          text: "Airborne radar (UAVSAR) watched the same bowl from June 2013 to November 2017. Parts of it sank more than 40 inches.",
          source:
            "../sars/07_NISAR_StoryMaps/Land_Subsidence/Land_Subsidence_narrative.md (l.48; Miller et al. 2020, Remote Sensing of Environment 251:112063; Jones et al. 2020)",
        },
        {
          text: "Near Huron and Kettleman City, the ground sank more than 7 inches between July 2013 and March 2015.",
          source: "../sars/09_UAVSAR_Postcards/postcards.csv (row 5, 'UAVSAR-postcard-CA-drought')",
        },
        {
          text: "When groundwater is pumped out, the soil compacts and the surface sinks, sometimes for good. That can crack canals and cut how much water they carry.",
          source: "../sars/07_NISAR_StoryMaps/Land_Subsidence/Land_Subsidence_narrative.md (l.39–41)",
        },
        {
          text: "NISAR images in L-band (about 24 cm wavelength), which keeps a better lock on the ground in vegetated farmland.",
          source: "../sars/07_NISAR_StoryMaps/Land_Subsidence/Land_Subsidence_narrative.md (l.88)",
        },
        {
          text: "NISAR looks to the left and repeats every track every 12 days. Track 042 missed two passes over this frame: 5 Feb and 4 Aug 2026.",
          source:
            "../sars/03_NISAR_Data_User_Guide/site_mirror/text/nisar-intro.md (l.118); ../sars/03_NISAR_Data_User_Guide/site_mirror/text/gcov.md (l.154); NASA CMR collection C2854335566-ASF (queried 2026-11-15)",
        },
      ],
    },
    steps,
    masks,
    referenceMaskId: refId,
    referencePolygons: REFERENCE_POLYGONS.map((ring) => ring.map((p) => ({ lon: p.lon, lat: p.lat }))),
    contextLayers: contextLayers(),
    legend: { ramp: [...RAMP], labels: [...LEGEND_LABELS], unit: LEGEND_UNIT, thresholds: [...THRESHOLDS_MM] },
    camera: {
      home: { lon: -119.4, lat: 36.8, heightM: 1_400_000 },
      aoi: { lon: Math.round(centre.lon * 1000) / 1000, lat: Math.round(centre.lat * 1000) / 1000, heightM: 95_000 },
    },
    attributions: [
      `Context imagery: ${GIBS_ACK}`,
      "Blue Marble Shaded Relief and Bathymetry: NASA Earth Observatory (MODIS), via NASA GIBS.",
      "HLS S30 Nadir BRDF-Adjusted Reflectance (Sentinel-2, 30 m): NASA LP DAAC (doi:10.5067/HLS/HLSS30.002), via NASA GIBS. Contains modified Copernicus Sentinel-2 data (ESA).",
      "MODIS Terra Corrected Reflectance (True Color): NASA LANCE / EOSDIS, via NASA GIBS.",
      "NISAR L2 GCOV backscatter: NASA/JPL-Caltech & ISRO, ASF DAAC, via NASA GIBS.",
      "NISAR acquisition dates, track, frame and orbit direction: NISAR catalogue, NASA CMR / ASF DAAC (collection C2854335566-ASF).",
      "Displacement and coherence values: SIMULATED by BlindRev data-forge — not NISAR measurements.",
      "Reference change mask: authored by BlindRev (mission answer key, not a scientific product).",
      "NISAR orbit: CelesTrak GP data (NORAD 65053), propagated with SGP4 (satellite.js).",
      "Globe: CesiumJS (Apache-2.0); Cesium ion / Cesium World Terrain when a token is configured.",
      "Case background: NISAR StoryMaps 'Land Subsidence' (Peacock, An, Pinto & Lou 2024, doi:10.5281/zenodo.10818833); Miller et al. 2020; Jones et al. 2020.",
    ],
  };
  em.emit(MISSION_JSON, stableJson(mission));

  // ------------------------------------------------------------------ basemap prefab
  em.emit(
    BASEMAP_JSON,
    stableJson({
      online: {
        layerId: BASEMAP.layerId,
        urlTemplate: `${GIBS_3857}/${BASEMAP.layerId}/default/${BASEMAP.date}/${BASEMAP.tileMatrixSet}/{z}/{y}/{x}.${BASEMAP.ext}`,
        minZoom: 0,
        maxZoom: BASEMAP.regionalMaxZoom,
        tileMatrixSet: "GoogleMapsCompatible",
        crs: "EPSG:3857",
        date: BASEMAP.date,
        attribution: BASEMAP.attribution,
        license: NASA_OPEN_LICENSE,
      },
      offline: {
        urlTemplate: `offline-tiles/bluemarble/{z}/{y}/{x}.${BASEMAP.ext}`,
        minZoom: 0,
        maxZoom: BASEMAP.globalMaxZoom,
        regionalMaxZoom: BASEMAP.regionalMaxZoom,
        regionalBounds: [...BASEMAP.regionalBounds],
        tileMatrixSet: "GoogleMapsCompatible",
        crs: "EPSG:3857",
        attribution: BASEMAP.attribution,
        license: NASA_OPEN_LICENSE,
        notes:
          "Global coverage z0–maxZoom; z(maxZoom+1)–regionalMaxZoom only inside regionalBounds (AOI ± 2°). Clamp the provider to regionalBounds above maxZoom.",
      },
    }),
  );

  return { files: em.files, stats, mission, fixture, referencePixels, referenceAreaKm2 };
}
