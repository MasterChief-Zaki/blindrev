import { describe, expect, it } from "vitest";
import type { GridSpec, LonLat, MaskAsset, MaskGrid, ScoringConfig } from "../contracts";
import { pointInRings, validateRoi } from "../roi";
import { mulberry32 } from "../util";
import { sha256Hex } from "../util/digest";
import { makeOpticalStep, makeStep } from "../util/testFixtures";
import {
  CLOUD_COVER_MESSAGE,
  LOW_COHERENCE_MESSAGE,
  MaskDecodeError,
  countSet,
  decodeMask,
  pixelCentreLats,
  pixelCentreLons,
  rasterizeRings,
  reprojectMercatorMaskTo4326,
  scoreRoi,
} from "./index";
import type { ScoreInput, ScoreOutcome } from "./index";

// Appendix A defaults.
const CONFIG: ScoringConfig = {
  dtMinDays: 24,
  iouPass: 0.5,
  iouPartial: 0.35,
  advisoryPrecisionRecall: 0.6,
  roiAreaMinKm2: 25,
  roiAreaMaxKm2: 2500,
  qaMinCoverage: 0.6,
  qaMinValidPixels: 500,
  maskRegistrationMaxPx: 1,
};

// 100 × 100 grid, 0.01° pixels over the San Joaquin Valley test window (TEST_FIXTURE).
const GRID: GridSpec = { width: 100, height: 100, bounds: [-120, 36, -119, 37], crs: "EPSG:4326" };
const N = GRID.width * GRID.height;

const P = (lon: number, lat: number): LonLat => ({ lon, lat });
const box = (w: number, s: number, e: number, n: number): LonLat[] => [P(w, s), P(e, s), P(e, n), P(w, n)];

/** Mask with 1s on cols [c0, c1) × rows [r0, r1) — built by index, independent of the rasteriser. */
function rectMask(c0: number, c1: number, r0: number, r1: number, grid: GridSpec = GRID): MaskGrid {
  const data = new Uint8Array(grid.width * grid.height);
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) data[r * grid.width + c] = 1;
  return { ...grid, bounds: [...grid.bounds] as GridSpec["bounds"], data };
}
const allValid = (grid: GridSpec = GRID): MaskGrid => ({
  ...grid,
  data: new Uint8Array(grid.width * grid.height).fill(1),
});

// Reference: box lon −119.8…−119.5, lat 36.3…36.6 → cols 20..49, rows 40..69 (900 px).
const REF_BOX = box(-119.8, 36.3, -119.5, 36.6);
const REFERENCE = rectMask(20, 50, 40, 70);

// 450-px ROIs need a lower valid-pixel floor than the 500 default.
const CFG400: ScoringConfig = { ...CONFIG, qaMinValidPixels: 400 };

const A = makeStep("s0", "2026-01-01T00:00:00Z", true);
const B = makeStep("s2", "2026-01-25T00:00:00Z", true); // Δt = 24 d

const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  rings: [REF_BOX],
  reference: REFERENCE,
  qa: [allValid()],
  stepA: A,
  stepB: B,
  config: CONFIG,
  ...over,
});

function expectScore(o: ScoreOutcome): Extract<ScoreOutcome, { kind: "SCORE" }> {
  expect(o.kind).toBe("SCORE");
  return o as Extract<ScoreOutcome, { kind: "SCORE" }>;
}

describe("rasterizeRings", () => {
  it("rectangle aligned to pixel edges covers exactly the expected pixels", () => {
    const m = rasterizeRings([REF_BOX], GRID);
    expect(countSet(m)).toBe(900);
    expect(Array.from(m)).toEqual(Array.from(REFERENCE.data));
  });

  it("row 0 is north: a box in the northern strip lands in the first rows", () => {
    const m = rasterizeRings([box(-120, 36.98, -119, 37)], GRID); // top 2 rows
    expect(countSet(m)).toBe(200);
    for (let i = 0; i < 200; i++) expect(m[i]).toBe(1);
  });

  it("a ring passing exactly through pixel centres: left/bottom edges in, right/top edges out", () => {
    const xs = pixelCentreLons(GRID);
    const ys = pixelCentreLats(GRID);
    const ring = [
      P(xs[2] as number, ys[5] as number),
      P(xs[5] as number, ys[5] as number),
      P(xs[5] as number, ys[2] as number),
      P(xs[2] as number, ys[2] as number),
    ];
    const expected = rectMask(2, 5, 3, 6).data; // cols 2,3,4 × rows 3,4,5
    const variants = [
      ring,
      [...ring].reverse(),
      [...ring.slice(1), ring[0] as LonLat],
      [...ring.slice(2), ...ring.slice(0, 2)],
    ];
    for (const v of variants) {
      const m = rasterizeRings([v], GRID);
      expect(countSet(m)).toBe(9);
      expect(Array.from(m)).toEqual(Array.from(expected));
    }
  });

  it("matches pointInRings at every pixel centre (seeded random polygons, some self-intersecting)", () => {
    const g: GridSpec = { width: 64, height: 48, bounds: [-120, 36, -119.36, 36.48], crs: "EPSG:4326" };
    const xs = pixelCentreLons(g);
    const ys = pixelCentreLats(g);
    const rnd = mulberry32(20261115);
    for (let t = 0; t < 25; t++) {
      const nv = 3 + Math.floor(rnd() * 10);
      const ring: LonLat[] = [];
      for (let k = 0; k < nv; k++) {
        // Half the vertices snap to exact pixel centres to exercise ties.
        if (rnd() < 0.5)
          ring.push(P(xs[Math.floor(rnd() * g.width)] as number, ys[Math.floor(rnd() * g.height)] as number));
        else ring.push(P(-120.05 + rnd() * 0.75, 35.95 + rnd() * 0.6));
      }
      const rings = t % 5 === 0 ? [ring, box(-119.9, 36.1, -119.6, 36.3)] : [ring];
      const m = rasterizeRings(rings, g);
      for (let r = 0; r < g.height; r++) {
        for (let c = 0; c < g.width; c++) {
          expect(m[r * g.width + c] === 1).toBe(pointInRings(xs[c] as number, ys[r] as number, rings));
        }
      }
    }
  });

  it("even-odd: a nested ring is a hole", () => {
    const m = rasterizeRings([REF_BOX, box(-119.7, 36.4, -119.6, 36.5)], GRID);
    expect(countSet(m)).toBe(900 - 100);
  });

  it("antimeridian: split rings from validateRoi rasterise onto a grid spanning ±180°", () => {
    const v = validateRoi([P(179.9, 10.0), P(-179.9, 10.0), P(-179.9, 10.2), P(179.9, 10.2)], CONFIG);
    expect(v.rings).toHaveLength(2);
    const g: GridSpec = { width: 40, height: 40, bounds: [179.8, 10.0, 180.2, 10.4], crs: "EPSG:4326" };
    const m = rasterizeRings(v.rings, g);
    expect(Array.from(m)).toEqual(Array.from(rectMask(10, 30, 20, 40, g).data));
  });

  it("rejects bad grids and non-finite rings", () => {
    expect(() => rasterizeRings([REF_BOX], { ...GRID, width: 0 })).toThrow(RangeError);
    expect(() => rasterizeRings([REF_BOX], { ...GRID, bounds: [1, 0, 0, 1] })).toThrow(RangeError);
    expect(() => rasterizeRings([[P(0, 0), P(Number.NaN, 1), P(1, 1)]], GRID)).toThrow(RangeError);
  });

  it("is fast enough for 1024² grids", () => {
    const g: GridSpec = { width: 1024, height: 1024, bounds: [-120, 36, -119, 37], crs: "EPSG:4326" };
    const rnd = mulberry32(7);
    const ring: LonLat[] = [];
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * 2 * Math.PI;
      const rad = 0.3 + rnd() * 0.15;
      ring.push(P(-119.5 + rad * Math.cos(a), 36.5 + rad * Math.sin(a)));
    }
    const t0 = performance.now();
    const m = rasterizeRings([ring], g);
    const ms = performance.now() - t0;
    expect(countSet(m)).toBeGreaterThan(100_000);
    expect(ms).toBeLessThan(1000); // generous CI bound; measured value is logged in docs/reports/spike-D-roi.md
  });
});

describe("scoreRoi — verdicts", () => {
  it("perfect overlap → IoU 1, PASS, no advisory", () => {
    const s = expectScore(scoreRoi(input()));
    expect(s).toMatchObject({ iou: 1, precision: 1, recall: 1, tier: "PASS", advisory: [], tp: 900, fp: 0, fn: 0 });
    expect(s).toMatchObject({ roiPixels: 900, validPixels: 900, coverage: 1 });
    expect(s.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("IoU exactly 0.5 → PASS (tier bounds inclusive)", () => {
    const s = expectScore(scoreRoi(input({ rings: [box(-119.7, 36.3, -119.4, 36.6)] }))); // shift 10 cols
    expect(s).toMatchObject({ tp: 600, fp: 300, fn: 300, iou: 0.5, tier: "PASS", advisory: [] });
    expect(s.precision).toBe(600 / 900);
  });

  it("IoU 0.4286 → PARTIAL", () => {
    const s = expectScore(scoreRoi(input({ rings: [box(-119.68, 36.3, -119.38, 36.6)] }))); // shift 12 cols
    expect(s).toMatchObject({ tp: 540, fp: 360, fn: 360, tier: "PARTIAL" });
    expect(s.iou).toBe(540 / 1260);
  });

  it("IoU 0.333 → FAIL with both advisories, each quoting precision and recall", () => {
    const s = expectScore(scoreRoi(input({ rings: [box(-119.65, 36.3, -119.35, 36.6)] }))); // shift 15 cols
    expect(s).toMatchObject({ tp: 450, fp: 450, fn: 450, tier: "FAIL" });
    expect(s.advisory).toHaveLength(2);
    for (const a of s.advisory) {
      expect(a).toContain("50.0%");
      expect(a).toMatch(/precision/i);
      expect(a).toMatch(/recall/i);
    }
  });

  it("only the weak metric triggers an advisory", () => {
    // ROI = left 15 cols of the reference: precision 1, recall 0.5.
    const s = expectScore(scoreRoi(input({ rings: [box(-119.8, 36.3, -119.65, 36.6)], config: CFG400 })));
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(0.5);
    expect(s.advisory).toEqual([
      "Recall 50.0% (precision 100.0%): your region misses part of the change. Try widening it.",
    ]);
  });

  it("invalid reference pixels are excluded from fn", () => {
    const left = box(-119.8, 36.3, -119.65, 36.6); // cols 20..34
    const qaHidesRight = rectMask(0, 35, 0, 100); // cols 35..99 invalid
    const s = expectScore(scoreRoi(input({ rings: [left], qa: [qaHidesRight], config: CFG400 })));
    expect(s).toMatchObject({ tp: 450, fp: 0, fn: 0, iou: 1, coverage: 1 });
    const all = expectScore(scoreRoi(input({ rings: [left], config: CFG400 })));
    expect(all).toMatchObject({ tp: 450, fn: 450, iou: 0.5 });
  });

  it("a pixel is valid only if valid in every QA grid", () => {
    const qa1 = rectMask(0, 45, 0, 100);
    const qa2 = rectMask(25, 100, 0, 100);
    const s = expectScore(scoreRoi(input({ qa: [qa1, qa2], config: { ...CONFIG, qaMinCoverage: 0.5 } })));
    expect(s.validPixels).toBe(20 * 30); // cols 25..44
    expect(s.coverage).toBe(600 / 900);
  });

  it("no QA grids → every pixel valid", () => {
    expect(expectScore(scoreRoi(input({ qa: [] }))).validPixels).toBe(900);
  });
});

describe("scoreRoi — QA diagnostics", () => {
  const lowQa = rectMask(36, 100, 0, 100); // ROI cols 20..49 → 14/30 valid = 0.467

  it("coverage < 60% on SAR steps → LOW_COHERENCE with the spec wording", () => {
    const o = scoreRoi(input({ qa: [lowQa] }));
    expect(o).toEqual({
      kind: "QA_DIAGNOSTIC",
      code: "LOW_COHERENCE",
      message: "Low interferometric coherence in selected zone; inspect high-coherence mask",
      coverage: 420 / 900,
      validPixels: 420,
      roiPixels: 900,
    });
    expect(LOW_COHERENCE_MESSAGE).toBe("Low interferometric coherence in selected zone; inspect high-coherence mask");
  });

  it("CLOUD_COVER only when both steps are optical", () => {
    const oa = makeOpticalStep("o0", "2026-01-01");
    const ob = makeOpticalStep("o1", "2026-02-01");
    const o = scoreRoi(input({ qa: [lowQa], stepA: oa, stepB: ob }));
    expect(o).toMatchObject({ kind: "QA_DIAGNOSTIC", code: "CLOUD_COVER", message: CLOUD_COVER_MESSAGE });
    const mixed = scoreRoi(input({ qa: [lowQa], stepA: oa, stepB: B }));
    expect(mixed).toMatchObject({ kind: "QA_DIAGNOSTIC", code: "LOW_COHERENCE" });
  });

  it("enough coverage but < 500 valid pixels → TOO_FEW_VALID_PIXELS", () => {
    const small = box(-119.8, 36.4, -119.6, 36.6); // 20 × 20 = 400 px
    const o = scoreRoi(input({ rings: [small] }));
    expect(o).toMatchObject({
      kind: "QA_DIAGNOSTIC",
      code: "TOO_FEW_VALID_PIXELS",
      validPixels: 400,
      roiPixels: 400,
      coverage: 1,
    });
    expect((o as { message: string }).message).toContain("400");
    expect((o as { message: string }).message).toContain("high-coherence");
  });

  it("coverage exactly at the threshold passes (≥ 60%)", () => {
    const qa = rectMask(32, 100, 0, 100); // 18/30 cols valid = 0.6
    const s = expectScore(scoreRoi(input({ qa: [qa] })));
    expect(s.coverage).toBe(0.6);
  });
});

describe("scoreRoi — rejections", () => {
  it("STEP_UNAVAILABLE when either step has no acquisition", () => {
    const u = makeStep("s1", "2026-01-13T00:00:00Z", false);
    expect(scoreRoi(input({ stepA: u }))).toMatchObject({ kind: "REJECTED", code: "STEP_UNAVAILABLE" });
    expect(scoreRoi(input({ stepB: u }))).toMatchObject({ kind: "REJECTED", code: "STEP_UNAVAILABLE" });
  });

  it("DT_TOO_SHORT below 24 days (and for the same step twice); 24 days and swapped order are fine", () => {
    const b23 = makeStep("s23", "2026-01-24T00:00:00Z", true);
    expect(scoreRoi(input({ stepB: b23 }))).toMatchObject({ kind: "REJECTED", code: "DT_TOO_SHORT" });
    expect((scoreRoi(input({ stepB: b23 })) as { message: string }).message).toContain("23 days");
    expect(scoreRoi(input({ stepB: A }))).toMatchObject({ kind: "REJECTED", code: "DT_TOO_SHORT" });
    expect(scoreRoi(input()).kind).toBe("SCORE");
    expect(scoreRoi(input({ stepA: B, stepB: A })).kind).toBe("SCORE");
    expect(scoreRoi(input({ stepB: makeStep("bad", "not-a-date", true) }))).toMatchObject({ code: "DT_TOO_SHORT" });
  });

  it("CRS_MISMATCH when any grid is not EPSG:4326 (never mixes CRS at pixel level)", () => {
    const merc = { ...allValid(), crs: "EPSG:3857" } as unknown as MaskGrid;
    expect(scoreRoi(input({ qa: [merc] }))).toMatchObject({ kind: "REJECTED", code: "CRS_MISMATCH" });
    expect(scoreRoi(input({ reference: { ...REFERENCE, crs: "EPSG:3857" } as unknown as MaskGrid }))).toMatchObject({
      code: "CRS_MISMATCH",
    });
  });

  it("GRID_MISMATCH on shape, bounds or data-length differences", () => {
    const narrow: MaskGrid = { ...allValid(), width: 50, data: new Uint8Array(5000).fill(1) };
    const shifted: MaskGrid = { ...allValid(), bounds: [-120, 36, -119, 37.0000001] };
    const short: MaskGrid = { ...allValid(), data: new Uint8Array(N - 1).fill(1) };
    for (const qa of [narrow, shifted, short]) {
      expect(scoreRoi(input({ qa: [qa] }))).toMatchObject({ kind: "REJECTED", code: "GRID_MISMATCH" });
    }
  });

  it("ROI_INVALID for empty rings, too-short rings, non-finite points, or a zone off the grid", () => {
    expect(scoreRoi(input({ rings: [] }))).toMatchObject({ kind: "REJECTED", code: "ROI_INVALID" });
    expect(scoreRoi(input({ rings: [[P(-119.8, 36.3), P(-119.5, 36.6)]] }))).toMatchObject({ code: "ROI_INVALID" });
    expect(scoreRoi(input({ rings: [[P(-119.8, 36.3), P(Number.NaN, 36.6), P(-119.5, 36.6)]] }))).toMatchObject({
      code: "ROI_INVALID",
    });
    expect(scoreRoi(input({ rings: [box(10, 10, 10.3, 10.3)] }))).toMatchObject({ code: "ROI_INVALID" });
  });
});

describe("scoreRoi — bit-determinism (Spike B gate)", () => {
  // A non-trivial validated ROI (heptagon) crossing pixel boundaries at odd angles.
  const HEPTA: LonLat[] = [
    P(-119.83, 36.31),
    P(-119.61, 36.27),
    P(-119.47, 36.42),
    P(-119.52, 36.61),
    P(-119.66, 36.68),
    P(-119.81, 36.6),
    P(-119.88, 36.45),
  ];
  const qa1 = rectMask(0, 47, 0, 100);
  const qa2 = rectMask(0, 100, 33, 100);
  const base = () => input({ rings: [HEPTA], qa: [qa1, qa2], config: { ...CONFIG, qaMinCoverage: 0.5 } });

  it("validated ROI scores (sanity)", () => {
    expect(validateRoi(HEPTA, CONFIG).ok).toBe(true);
    expect(scoreRoi(base()).kind).toBe("SCORE");
  });

  it("100 identical runs → identical outcome objects and digests", () => {
    const first = scoreRoi(base());
    const s = expectScore(first);
    for (let i = 0; i < 100; i++) expect(scoreRoi(base())).toEqual(first);
    expect(Number.isInteger(s.tp) && Number.isInteger(s.fp) && Number.isInteger(s.fn)).toBe(true);
    expect(s.iou).toBe(s.tp / (s.tp + s.fp + s.fn));
  });

  it("rotated vertex order and reversed winding → identical outcome and digest", () => {
    const ref = scoreRoi(base());
    for (let k = 0; k < HEPTA.length; k++) {
      const rot = [...HEPTA.slice(k), ...HEPTA.slice(0, k)];
      expect(scoreRoi({ ...base(), rings: [rot] })).toEqual(ref);
      expect(scoreRoi({ ...base(), rings: [[...rot].reverse()] })).toEqual(ref);
    }
  });

  it("validated rings (lattice-snapped) score identically 100× too", () => {
    const rings = validateRoi(HEPTA, CONFIG).rings;
    const first = scoreRoi({ ...base(), rings });
    for (let i = 0; i < 100; i++)
      expect(scoreRoi({ ...base(), rings: validateRoi(HEPTA, CONFIG).rings })).toEqual(first);
  });

  it("ring order, QA-grid order and A/B order do not change the outcome", () => {
    const hole = box(-119.7, 36.45, -119.65, 36.5);
    const ref = scoreRoi({ ...base(), rings: [HEPTA, hole] });
    expect(scoreRoi({ ...base(), rings: [hole, HEPTA] })).toEqual(ref);
    expect(scoreRoi({ ...base(), rings: [HEPTA, hole], qa: [qa2, qa1] })).toEqual(ref);
    expect(scoreRoi({ ...base(), rings: [HEPTA, hole], stepA: B, stepB: A })).toEqual(ref);
  });

  it("different ROI, config or steps → different digest", () => {
    const d0 = expectScore(scoreRoi(base())).digest;
    const moved = HEPTA.map((p) => P(p.lon + 0.01, p.lat));
    expect(expectScore(scoreRoi({ ...base(), rings: [moved] })).digest).not.toBe(d0);
    expect(
      expectScore(scoreRoi({ ...base(), config: { ...CONFIG, qaMinCoverage: 0.5, iouPass: 0.55 } })).digest,
    ).not.toBe(d0);
    const b2 = makeStep("s9", "2026-03-01T00:00:00Z", true);
    expect(expectScore(scoreRoi({ ...base(), stepB: b2 })).digest).not.toBe(d0);
  });

  it("1024² grid end-to-end stays deterministic", () => {
    const g: GridSpec = { width: 1024, height: 1024, bounds: [-120, 36, -119, 37], crs: "EPSG:4326" };
    const reference: MaskGrid = { ...g, data: rasterizeRings([REF_BOX], g) };
    const qa: MaskGrid = { ...g, data: new Uint8Array(1024 * 1024).fill(1) };
    const t0 = performance.now();
    const first = scoreRoi({ ...input(), rings: [HEPTA], reference, qa: [qa] });
    const ms = performance.now() - t0;
    expect(first.kind).toBe("SCORE");
    expect(scoreRoi({ ...input(), rings: [[...HEPTA].reverse()], reference, qa: [qa] })).toEqual(first);
    expect(ms).toBeLessThan(3000);
  });
});

describe("decodeMask", () => {
  const asset = (bytes: Uint8Array, over: Partial<MaskAsset> = {}): MaskAsset => ({
    maskId: "ref-test",
    version: "1",
    binUrl: "mission-data/test/ref.bin",
    pngUrl: "mission-data/test/ref.png",
    sha256: sha256Hex(bytes),
    width: 4,
    height: 2,
    bounds: [0, 0, 4, 2],
    crs: "EPSG:4326",
    ...over,
  });
  const bytes = Uint8Array.from([0, 1, 1, 0, 255, 0, 0, 7]);

  it("decodes, normalises non-zero to 1, and verifies sha256", () => {
    const g = decodeMask(asset(bytes), bytes.buffer.slice(0));
    expect(Array.from(g.data)).toEqual([0, 1, 1, 0, 1, 0, 0, 1]);
    expect(g).toMatchObject({ width: 4, height: 2, bounds: [0, 0, 4, 2], crs: "EPSG:4326" });
  });

  it("throws MaskDecodeError on length mismatch, hash mismatch, or wrong CRS", () => {
    expect(() => decodeMask(asset(bytes), new Uint8Array(7))).toThrow(MaskDecodeError);
    const tampered = Uint8Array.from(bytes);
    tampered[0] = 1;
    expect(() => decodeMask(asset(bytes), tampered)).toThrow(/integrity/);
    expect(() => decodeMask(asset(bytes, { crs: "EPSG:3857" as unknown as "EPSG:4326" }), bytes)).toThrow(
      MaskDecodeError,
    );
  });

  it("skips verification for placeholder hashes or when disabled", () => {
    expect(() => decodeMask(asset(bytes, { sha256: "PLACEHOLDER" }), bytes)).not.toThrow();
    const tampered = Uint8Array.from(bytes);
    tampered[0] = 1;
    expect(() => decodeMask(asset(bytes), tampered, { verifySha256: false })).not.toThrow();
  });
});

describe("reprojectMercatorMaskTo4326", () => {
  it("resamples a north-half Mercator mask to a clean row split on the lon/lat grid", () => {
    const w = 100;
    const h = 100;
    const data = new Uint8Array(w * h);
    data.fill(1, 0, (w * h) / 2); // north half in Mercator y
    const out = reprojectMercatorMaskTo4326(
      { width: w, height: h, bounds: [-120, 36, -119, 37], crs: "EPSG:3857", data },
      GRID,
    );
    expect(out.crs).toBe("EPSG:4326");
    let split = -1;
    for (let r = 0; r < h; r++) {
      const row = out.data.subarray(r * w, (r + 1) * w);
      const v = row[0] as number;
      expect(row.every((x) => x === v)).toBe(true);
      if (v === 0 && split < 0) split = r;
      if (split >= 0) expect(v).toBe(0);
    }
    // Mercator's equal-y midpoint sits slightly north of 36.5° → split at row 49 or 50.
    expect([49, 50]).toContain(split);
  });

  it("pixels outside the Mercator source are 0", () => {
    const src = {
      width: 10,
      height: 10,
      bounds: [-119.5, 36.5, -119, 37] as GridSpec["bounds"],
      crs: "EPSG:3857" as const,
      data: new Uint8Array(100).fill(1),
    };
    const out = reprojectMercatorMaskTo4326(src, GRID);
    expect(countSet(out.data)).toBe(50 * 50);
    expect(out.data[99 * 100]).toBe(0);
  });
});
