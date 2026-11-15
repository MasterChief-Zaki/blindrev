/**
 * SIMULATED analytic fields: LOS displacement (mm) and interferometric coherence validity.
 *
 * Every field is a pure function of (lon, lat, step, seeds) — no Math.random, no clock, no
 * resolution-dependent state — so the 512² scoring grid and the 1024² display rasters sample
 * one and the same field and are registered exactly by construction.
 */
import type { Bounds, LonLat } from "@blindrev/core-sim";
import { mulberry32 } from "@blindrev/core-sim";
import {
  APS_AMPLITUDE_MM,
  APS_RAMP_MM,
  BOWLS,
  type BowlDef,
  CROPLAND_DECORRELATION_FRACTION,
  FRAME_POLYGON,
  LOW_COHERENCE_ZONE,
  PIXEL_NOISE_MM,
  REFERENCE_POINT,
  REFERENCE_STEP_ID,
  SEASONAL_ZONE,
  SEEDS,
  type StepDef,
  TRANSIENTS,
} from "./config";

// ---------------------------------------------------------------------------
// Hash-based value noise (lattice values from an integer hash — position-addressable)
// ---------------------------------------------------------------------------

function hash2(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [-1, 1]; x, y in lattice units. */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return (top + (bot - top) * fy) * 2 - 1;
}

/** Fractal value noise in ≈[-1, 1]; scaleKm = wavelength of the first octave. */
export function fbm(xKm: number, yKm: number, scaleKm: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1 / scaleKm;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(xKm * f + o * 17.31, yKm * f - o * 9.73, (seed + Math.imul(o, 0x9e3779b1)) | 0);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Local metric frame (km) around the AOI centre
// ---------------------------------------------------------------------------

export interface Frame {
  lon0: number;
  lat0: number;
  kx: number; // km per degree lon
  ky: number; // km per degree lat
}

export function makeFrame(bounds: Bounds): Frame {
  const lon0 = (bounds[0] + bounds[2]) / 2;
  const lat0 = (bounds[1] + bounds[3]) / 2;
  return { lon0, lat0, kx: 111.32 * Math.cos((lat0 * Math.PI) / 180), ky: 110.57 };
}

export function toKm(f: Frame, lon: number, lat: number): { x: number; y: number } {
  return { x: (lon - f.lon0) * f.kx, y: (lat - f.lat0) * f.ky };
}

/** Normalised elliptical radius² of (x, y) for an ellipse at `c` with semi-axes (major, minor) at azimuth (° from north). */
function ellipseR2(
  f: Frame,
  x: number,
  y: number,
  c: LonLat,
  majorKm: number,
  minorKm: number,
  azimuthDeg: number,
): number {
  const cc = toKm(f, c.lon, c.lat);
  const dx = x - cc.x;
  const dy = y - cc.y;
  const az = (azimuthDeg * Math.PI) / 180;
  // unit vector of the major axis (east = sin az, north = cos az)
  const ue = Math.sin(az);
  const un = Math.cos(az);
  const u = dx * ue + dy * un;
  const v = -dx * un + dy * ue;
  return (u / majorKm) ** 2 + (v / minorKm) ** 2;
}

/** Bowl shape in [0, 1] with a noise-modulated (natural-looking) outline. */
export function bowlShape(f: Frame, x: number, y: number, b: BowlDef, bowlIndex: number): number {
  const r2 = ellipseR2(f, x, y, b.center, b.majorKm, b.minorKm, b.azimuthDeg);
  const wobble = 1 + 0.16 * fbm(x, y, 6, (SEEDS.fields + bowlIndex * 101) | 0, 3);
  const r = Math.sqrt(r2) * wobble;
  return Math.exp(-r * r);
}

// ---------------------------------------------------------------------------
// Displacement model
// ---------------------------------------------------------------------------

export interface StepNoise {
  apsSeed: number;
  rampE: number;
  rampN: number;
}

/** Per-step atmospheric parameters, derived from the seeded PRNG (stable order = STEP_DEFS order). */
export function stepNoiseParams(steps: StepDef[]): Map<string, StepNoise> {
  const rnd = mulberry32(SEEDS.atmosphere);
  const out = new Map<string, StepNoise>();
  for (const s of steps) {
    const apsSeed = Math.floor(rnd() * 0x7fffffff);
    const ang = rnd() * Math.PI * 2;
    const mag = 0.4 + 0.6 * rnd();
    out.set(s.stepId, { apsSeed, rampE: Math.cos(ang) * mag, rampN: Math.sin(ang) * mag });
  }
  return out;
}

export interface FieldContext {
  frame: Frame;
  halfWidthKm: number;
  halfHeightKm: number;
  noise: Map<string, StepNoise>;
  refXY: { x: number; y: number };
}

export function makeFieldContext(bounds: Bounds, steps: StepDef[]): FieldContext {
  const frame = makeFrame(bounds);
  return {
    frame,
    halfWidthKm: ((bounds[2] - bounds[0]) / 2) * frame.kx,
    halfHeightKm: ((bounds[3] - bounds[1]) / 2) * frame.ky,
    noise: stepNoiseParams(steps),
    refXY: toKm(frame, REFERENCE_POINT.lon, REFERENCE_POINT.lat),
  };
}

/** Persistent, growing signal (the answer): the bowls at growth = 1. */
export function persistentSignal(ctx: FieldContext, x: number, y: number): number {
  let d = 0;
  BOWLS.forEach((b, i) => {
    d += b.peakMm * bowlShape(ctx.frame, x, y, b, i);
  });
  return d;
}

/** Seasonal (elastic) decoy shape in [0, ~1.1]; multiplied by the step's seasonalMm. */
export function seasonalShape(ctx: FieldContext, x: number, y: number): number {
  const sr2 = ellipseR2(
    ctx.frame,
    x,
    y,
    SEASONAL_ZONE.center,
    SEASONAL_ZONE.majorKm,
    SEASONAL_ZONE.minorKm,
    SEASONAL_ZONE.azimuthDeg,
  );
  const sWobble = 1 + 0.2 * fbm(x, y, 5, (SEEDS.fields + 777) | 0, 3);
  return Math.exp(-sr2 * sWobble * sWobble) * (1 + 0.12 * fbm(x, y, 2.5, (SEEDS.fields + 778) | 0, 2));
}

/** Step-specific terms: single-date artefacts, atmospheric phase screen, ramp, pixel noise. */
export function dynamicTerms(ctx: FieldContext, step: StepDef, x: number, y: number): number {
  const n = ctx.noise.get(step.stepId);
  let d = 0;
  // single-date atmospheric artefacts
  for (const t of TRANSIENTS) {
    if (t.stepId !== step.stepId) continue;
    const c = toKm(ctx.frame, t.center.lon, t.center.lat);
    const rr = Math.hypot(x - c.x, y - c.y) / t.radiusKm;
    const edge = 1 + 0.3 * fbm(x, y, 3, (SEEDS.turbulence + t.center.lon * 1000) | 0, 3);
    const r = rr * edge;
    d += t.peakMm * Math.exp(-r * r);
  }
  if (n) {
    // smooth atmospheric phase screen (changes every step) + long-wavelength ramp
    d += APS_AMPLITUDE_MM * fbm(x, y, 22, n.apsSeed, 4);
    d += APS_RAMP_MM * ((n.rampE * x) / ctx.halfWidthKm + (n.rampN * y) / ctx.halfHeightKm);
    // pixel-scale decorrelation noise (fine lattice, still analytic)
    d += PIXEL_NOISE_MM * valueNoise(x / 0.35, y / 0.35, (n.apsSeed ^ SEEDS.noise) | 0);
  }
  return d;
}

/** Un-referenced LOS displacement from its components. */
export function composeRaw(step: StepDef, persistent: number, seasonal: number, dynamic: number): number {
  return step.growth * persistent + step.seasonalMm * seasonal + dynamic;
}

function rawDisplacement(ctx: FieldContext, step: StepDef, x: number, y: number): number {
  return composeRaw(step, persistentSignal(ctx, x, y), seasonalShape(ctx, x, y), dynamicTerms(ctx, step, x, y));
}

/** Value subtracted from every pixel so that the reference point reads 0 mm. */
export function referenceOffset(ctx: FieldContext, step: StepDef): number {
  return rawDisplacement(ctx, step, ctx.refXY.x, ctx.refXY.y);
}

/** Cumulative LOS displacement (mm) at a point for a step, referenced to REFERENCE_POINT (= 0 there). */
export function displacementMm(ctx: FieldContext, step: StepDef, lon: number, lat: number): number {
  // the reference acquisition is zero by definition (time series referenced to it)
  if (step.stepId === REFERENCE_STEP_ID) return 0;
  const { x, y } = toKm(ctx.frame, lon, lat);
  return rawDisplacement(ctx, step, x, y) - rawDisplacement(ctx, step, ctx.refXY.x, ctx.refXY.y);
}

// ---------------------------------------------------------------------------
// Coherence / QA model
// ---------------------------------------------------------------------------

/** Even-odd point-in-polygon (PNPOLY crossing test) — independent of core-sim's rasteriser. */
export function pointInPolygon(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as LonLat;
    const b = ring[j] as LonLat;
    if (a.lat > lat !== b.lat > lat) {
      const xc = a.lon + ((lat - a.lat) * (b.lon - a.lon)) / (b.lat - a.lat);
      if (lon < xc) inside = !inside;
    }
  }
  return inside;
}

export type InvalidReason = "VALID" | "OUTSIDE_FRAME" | "PERSISTENT_LOW_COHERENCE" | "CROPLAND_DECORRELATION";

/** ~0.5 mile (quarter-section) field cells, the scale of San Joaquin Valley farm parcels. */
const FIELD_CELL_DEG_LON = 0.009;
const FIELD_CELL_DEG_LAT = 0.00725;

export function qaReason(ctx: FieldContext, step: StepDef, lon: number, lat: number): InvalidReason {
  if (!pointInPolygon(lon, lat, FRAME_POLYGON)) return "OUTSIDE_FRAME";
  const { x, y } = toKm(ctx.frame, lon, lat);
  const lr2 = ellipseR2(
    ctx.frame,
    x,
    y,
    LOW_COHERENCE_ZONE.center,
    LOW_COHERENCE_ZONE.majorKm,
    LOW_COHERENCE_ZONE.minorKm,
    LOW_COHERENCE_ZONE.azimuthDeg,
  );
  const lw = 1 + 0.18 * fbm(x, y, 4, (SEEDS.coherence + 31) | 0, 3);
  if (lr2 * lw * lw < 1) return "PERSISTENT_LOW_COHERENCE";
  // cropland decorrelation: whole field cells drop out, clustered by a smooth per-step field
  const cx = Math.floor((lon + 180) / FIELD_CELL_DEG_LON);
  const cy = Math.floor((lat + 90) / FIELD_CELL_DEG_LAT);
  const stepSeed = (SEEDS.coherence + Math.imul(step.cycle, 0x632be5ab)) | 0;
  const cluster = fbm(x, y, 9, stepSeed, 3); // ≈[-1, 1]
  const p = CROPLAND_DECORRELATION_FRACTION * (1 + 1.6 * cluster);
  if (hash2(cx, cy, stepSeed ^ 0x5bd1e995) < p) return "CROPLAND_DECORRELATION";
  return "VALID";
}
