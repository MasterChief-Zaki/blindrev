import type { MaskGrid, ScoringConfig, TemporalStep } from "../contracts";
import { digestHex, sha256Hex } from "../util/digest";
import { daysBetween } from "../util/time";
import { rasterizeRings } from "./rasterize";
import type { ScoreInput, ScoreOutcome, ScoreTier } from "./types";

/** Exact diagnostic wording from spec §10. */
export const LOW_COHERENCE_MESSAGE = "Low interferometric coherence in selected zone; inspect high-coherence mask";
export const CLOUD_COVER_MESSAGE = "Too much cloud over selected zone; inspect cloud-free mask";

/** Version tag folded into every score digest; bump when the canonical serialisation changes. */
export const SCORE_DIGEST_VERSION = "blindrev.score.v1";

const SAR_RE = /sar|radar|interferom/i;

/** A step is SAR when it carries a displacement product or its instrument names SAR/radar. */
export function isSarStep(step: TemporalStep): boolean {
  return step.displacement !== null || SAR_RE.test(step.instrument ?? "");
}

type Rejected = Extract<ScoreOutcome, { kind: "REJECTED" }>;
const reject = (code: Rejected["code"], message: string): Rejected => ({ kind: "REJECTED", code, message });

function sameBounds(a: MaskGrid, b: MaskGrid): boolean {
  return (
    a.bounds[0] === b.bounds[0] &&
    a.bounds[1] === b.bounds[1] &&
    a.bounds[2] === b.bounds[2] &&
    a.bounds[3] === b.bounds[3]
  );
}

function gridIsSound(g: MaskGrid): boolean {
  if (!g || !(g.data instanceof Uint8Array)) return false;
  if (!Number.isInteger(g.width) || !Number.isInteger(g.height) || g.width <= 0 || g.height <= 0) return false;
  if (!Array.isArray(g.bounds) || g.bounds.length !== 4 || !g.bounds.every((v) => Number.isFinite(v))) return false;
  if (!(g.bounds[0] < g.bounds[2]) || !(g.bounds[1] < g.bounds[3])) return false;
  return g.data.length === g.width * g.height;
}

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

function fmtDays(d: number): string {
  return Number.isInteger(d) ? String(d) : d.toFixed(1);
}

/** Pack a 0/non-zero byte mask into bits (MSB first) — the canonical form hashed into the digest. */
function packBits(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array((mask.length + 7) >>> 3);
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) out[i >>> 3] = (out[i >>> 3] as number) | (0x80 >>> (i & 7));
  return out;
}

const CONFIG_KEYS: ReadonlyArray<keyof ScoringConfig> = [
  "dtMinDays",
  "iouPass",
  "iouPartial",
  "advisoryPrecisionRecall",
  "roiAreaMinKm2",
  "roiAreaMaxKm2",
  "qaMinCoverage",
  "qaMinValidPixels",
  "maskRegistrationMaxPx",
];

const stepKey = (s: TemporalStep): string => `${s.date}|${s.stepId}|${s.processingVersion}`;

/**
 * Score a player ROI against the authored reference mask (spec §10). **Bit-deterministic.**
 *
 * Order of gates: STEP_UNAVAILABLE → DT_TOO_SHORT (|Δt| between `stepA.date` and `stepB.date`) →
 * CRS_MISMATCH (every grid EPSG:4326) → GRID_MISMATCH (identical width/height/bounds, sound data) →
 * ROI_INVALID (no rings / non-finite / covers no pixel) → QA coverage (LOW_COHERENCE, or
 * CLOUD_COVER when both steps are optical) → TOO_FEW_VALID_PIXELS → SCORE.
 *
 * - ROI raster = `rasterizeRings(rings, reference)` (pixel-centre, even-odd).
 * - A pixel is *valid* iff it is non-zero in every QA grid (no QA grids → every pixel valid).
 * - `coverage = validPixels / roiPixels` over the ROI raster.
 * - tp / fp count valid ROI pixels inside / outside the reference; fn counts valid reference pixels
 *   outside the ROI over the whole grid. **Invalid reference pixels are excluded from fn** (the
 *   player cannot be blamed for change hidden by low coherence / cloud).
 * - Counting is integer-only and order-independent; each ratio is a single IEEE division of two
 *   integers. Same inputs → identical outcome object and digest on every platform, regardless of
 *   ring winding, starting vertex, ring order, QA-grid order or A/B step order.
 * - `digest` = SHA-256 over a canonical serialisation: version tag, grid spec, bit-packed ROI raster,
 *   reference and validity masks, the step pair (sorted), every `ScoringConfig` field, and the result.
 */
export function scoreRoi(input: ScoreInput): ScoreOutcome {
  const { rings, reference, qa, stepA, stepB, config } = input;

  for (const s of [stepA, stepB]) {
    if (s?.isAvailable !== true) {
      const when = s?.date ? s.date.slice(0, 10) : "that date";
      return reject("STEP_UNAVAILABLE", `There's no acquisition on ${when}. Pick two dates that have data.`);
    }
  }

  const dt = Math.abs(daysBetween(stepA.date, stepB.date));
  if (!Number.isFinite(dt)) {
    return reject("DT_TOO_SHORT", "We couldn't read the dates on these acquisitions, so we can't compare them.");
  }
  if (dt < config.dtMinDays) {
    return reject(
      "DT_TOO_SHORT",
      `These dates are ${fmtDays(dt)} days apart. Pick two at least ${config.dtMinDays} days apart so change has time to show.`,
    );
  }

  const qaList: ReadonlyArray<MaskGrid> = Array.isArray(qa) ? qa : [];
  const grids: MaskGrid[] = [reference, ...qaList];
  for (const g of grids) {
    if (g?.crs !== "EPSG:4326") {
      return reject(
        "CRS_MISMATCH",
        "A mask isn't on the lon/lat grid (EPSG:4326). It has to be reprojected before this region can be scored.",
      );
    }
  }
  for (const g of grids) {
    if (!gridIsSound(g) || g.width !== reference.width || g.height !== reference.height || !sameBounds(g, reference)) {
      return reject("GRID_MISMATCH", "The masks don't line up on the same grid, so this region can't be scored.");
    }
  }

  if (!Array.isArray(rings) || rings.length === 0 || rings.every((r) => !Array.isArray(r) || r.length < 3)) {
    return reject("ROI_INVALID", "Draw a region first, then check it.");
  }
  for (const r of rings) {
    for (const v of r) {
      if (!v || !Number.isFinite(v.lon) || !Number.isFinite(v.lat)) {
        return reject("ROI_INVALID", "Some corners of your region aren't on the map. Redraw it.");
      }
    }
  }

  const roi = rasterizeRings(rings, reference);
  const N = reference.width * reference.height;
  const ref = reference.data;
  const qaData = qaList.map((g) => g.data);
  const qaCount = qaData.length;
  const validMask = new Uint8Array(N);

  let roiPixels = 0;
  let validPixels = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let p = 0; p < N; p++) {
    let valid = 1;
    for (let k = 0; k < qaCount; k++) {
      if ((qaData[k] as Uint8Array)[p] === 0) {
        valid = 0;
        break;
      }
    }
    validMask[p] = valid;
    const isRef = ref[p] !== 0;
    if (roi[p] !== 0) {
      roiPixels++;
      if (valid === 1) {
        validPixels++;
        if (isRef) tp++;
        else fp++;
      }
    } else if (valid === 1 && isRef) {
      fn++;
    }
  }

  if (roiPixels === 0) {
    return reject("ROI_INVALID", "Your region doesn't cover any part of the mission area. Draw it over the evidence.");
  }

  const coverage = validPixels / roiPixels;
  const optical = !isSarStep(stepA) && !isSarStep(stepB);
  if (coverage < config.qaMinCoverage) {
    return optical
      ? { kind: "QA_DIAGNOSTIC", code: "CLOUD_COVER", message: CLOUD_COVER_MESSAGE, coverage, validPixels, roiPixels }
      : {
          kind: "QA_DIAGNOSTIC",
          code: "LOW_COHERENCE",
          message: LOW_COHERENCE_MESSAGE,
          coverage,
          validPixels,
          roiPixels,
        };
  }
  if (validPixels < config.qaMinValidPixels) {
    const what = optical ? "cloud-free" : "high-coherence";
    return {
      kind: "QA_DIAGNOSTIC",
      code: "TOO_FEW_VALID_PIXELS",
      message: `Only ${validPixels} ${what} pixels in selected zone (${config.qaMinValidPixels} needed); widen the zone or inspect ${what} mask`,
      coverage,
      validPixels,
      roiPixels,
    };
  }

  const iou = ratio(tp, tp + fp + fn);
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const tier: ScoreTier = iou >= config.iouPass ? "PASS" : iou >= config.iouPartial ? "PARTIAL" : "FAIL";
  const advisory: string[] = [];
  if (precision < config.advisoryPrecisionRecall) {
    advisory.push(
      `Precision ${pct(precision)} (recall ${pct(recall)}): much of your region shows no change. Try tightening it.`,
    );
  }
  if (recall < config.advisoryPrecisionRecall) {
    advisory.push(
      `Recall ${pct(recall)} (precision ${pct(precision)}): your region misses part of the change. Try widening it.`,
    );
  }

  const [kA, kB] = [stepKey(stepA), stepKey(stepB)].sort();
  const canonical = [
    SCORE_DIGEST_VERSION,
    `grid=${reference.width}x${reference.height};bounds=${reference.bounds.join(",")};crs=EPSG:4326`,
    `roi=${sha256Hex(packBits(roi))}`,
    `reference=${sha256Hex(packBits(ref))}`,
    `valid=${sha256Hex(packBits(validMask))}`,
    `steps=${kA};${kB}`,
    `config=${CONFIG_KEYS.map((k) => `${k}:${String(config[k])}`).join(",")}`,
    `result=SCORE;iou=${iou};precision=${precision};recall=${recall};tier=${tier};roiPixels=${roiPixels};validPixels=${validPixels};coverage=${coverage};tp=${tp};fp=${fp};fn=${fn}`,
    `advisory=${advisory.join("|")}`,
  ].join("\n");

  return {
    kind: "SCORE",
    iou,
    precision,
    recall,
    tier,
    advisory,
    roiPixels,
    validPixels,
    coverage,
    tp,
    fp,
    fn,
    digest: digestHex(canonical),
  };
}
