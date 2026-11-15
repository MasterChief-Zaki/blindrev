import { describe, expect, it } from "vitest";
import type { LonLat } from "../contracts";
import { AUTHALIC_RADIUS_M, ROI_MESSAGES, nudgeVertex, pointInRings, sphericalAreaKm2, validateRoi } from "./index";

const CFG = { roiAreaMinKm2: 25, roiAreaMaxKm2: 2500 };
const R_KM = AUTHALIC_RADIUS_M / 1000;
const D2R = Math.PI / 180;

const P = (lon: number, lat: number): LonLat => ({ lon, lat });
/** Axis-aligned lon/lat box, counter-clockwise from SW. */
const box = (w: number, s: number, e: number, n: number): LonLat[] => [P(w, s), P(e, s), P(e, n), P(w, n)];
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const codes = (v: ReturnType<typeof validateRoi>) => v.errors.map((e) => e.code);

/** Analytic area of a lon/lat cell bounded by parallels: R²·Δλ·(sin φ2 − sin φ1). */
const cellAreaKm2 = (dLonDeg: number, lat1: number, lat2: number) =>
  R_KM * R_KM * dLonDeg * D2R * (Math.sin(lat2 * D2R) - Math.sin(lat1 * D2R));

/** Independent oracle: Girard's theorem (Σ interior angles − (n−2)π) for a convex great-circle polygon. */
function girardAreaKm2(ring: LonLat[]): number {
  const v = ring.map(({ lon, lat }) => [
    Math.cos(lat * D2R) * Math.cos(lon * D2R),
    Math.cos(lat * D2R) * Math.sin(lon * D2R),
    Math.sin(lat * D2R),
  ]);
  const n = v.length;
  const dot = (a: number[], b: number[]) =>
    (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
  const tangent = (from: number[], to: number[]) => {
    const d = dot(to, from);
    const t = to.map((x, i) => x - d * (from[i] as number));
    const len = Math.hypot(...t);
    return t.map((x) => x / len);
  };
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const b = v[i] as number[];
    const a = v[(i + n - 1) % n] as number[];
    const c = v[(i + 1) % n] as number[];
    const ta = tangent(b, a);
    const tc = tangent(b, c);
    sum += Math.acos(Math.max(-1, Math.min(1, dot(ta, tc))));
  }
  return (sum - (n - 2) * Math.PI) * R_KM * R_KM;
}

// Base valid ROI: ~0.2° box in the San Joaquin Valley (~400 km²).
const SJV = box(-119.9, 36.0, -119.7, 36.2);

describe("validateRoi — baseline", () => {
  it("accepts a plain box and reports its area", () => {
    const v = validateRoi(SJV, CFG);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.rings).toHaveLength(1);
    expect(rel(v.areaKm2, cellAreaKm2(0.2, 36.0, 36.2))).toBeLessThan(1e-4);
  });

  it("is deterministic: 100 runs → deep-equal results", () => {
    const first = validateRoi(SJV, CFG);
    for (let i = 0; i < 100; i++) expect(validateRoi(SJV, CFG)).toEqual(first);
  });
});

describe("validateRoi — adversarial geometry (spec gate D)", () => {
  it("bow-tie → SELF_INTERSECTION", () => {
    const v = validateRoi([P(-119.9, 36.0), P(-119.7, 36.2), P(-119.7, 36.0), P(-119.9, 36.2)], CFG);
    expect(codes(v)).toEqual(["SELF_INTERSECTION"]);
    expect(v.ok).toBe(false);
    expect(v.rings).toEqual([]);
    expect(v.errors[0]?.message).toBe(ROI_MESSAGES.selfIntersection);
  });

  it("figure-eight through a shared vertex → SELF_INTERSECTION", () => {
    const c = P(-119.8, 36.1);
    const v = validateRoi([c, P(-119.9, 36.0), P(-119.9, 36.2), c, P(-119.7, 36.2), P(-119.7, 36.0)], CFG);
    expect(codes(v)).toEqual(["SELF_INTERSECTION"]);
  });

  it("figure-eight crossing mid-edge (no shared vertex) → SELF_INTERSECTION", () => {
    const v = validateRoi([P(-119.9, 36.0), P(-119.7, 36.2), P(-119.7, 36.0), P(-119.9, 36.2), P(-120.0, 36.1)], CFG);
    expect(codes(v)).toEqual(["SELF_INTERSECTION"]);
  });

  it("collinear overlap between non-adjacent edges → SELF_INTERSECTION", () => {
    // Edge (-119.8,36.0)→(-119.9,36.0) runs back over the first edge.
    const v = validateRoi([P(-119.9, 36.0), P(-119.7, 36.0), P(-119.7, 36.2), P(-119.8, 36.2), P(-119.8, 36.0)], CFG);
    expect(codes(v)).toEqual(["SELF_INTERSECTION"]);
  });

  it("fold-back spike (adjacent edges overlapping) → SELF_INTERSECTION", () => {
    const v = validateRoi([P(-119.9, 36.0), P(-119.7, 36.0), P(-119.8, 36.0), P(-119.8, 36.2)], CFG);
    expect(codes(v)).toEqual(["SELF_INTERSECTION"]);
  });

  it("collinear interior vertices are harmless (valid; area within the great-circle bulge of the plain box)", () => {
    const withMid = [
      P(-119.9, 36.0),
      P(-119.8, 36.0),
      P(-119.7, 36.0),
      P(-119.7, 36.1),
      P(-119.7, 36.2),
      P(-119.9, 36.2),
    ];
    const a = validateRoi(withMid, CFG);
    const b = validateRoi(SJV, CFG);
    expect(a.ok).toBe(true);
    // The bounds-check area treats edges as great circles: a vertex inserted on a parallel shortens
    // the arc and its poleward bulge (≈ Δλ²·sinφ·cosφ/(12·Δφ) ≈ 1.4e-4 rel for this 0.2° box).
    // Measured 1.04e-4. The rasterised ROI (straight lon/lat edges) is identical — see scoring tests.
    expect(rel(a.areaKm2, b.areaKm2)).toBeLessThan(2e-4);
  });

  it("consecutive duplicates and a closing duplicate are dropped", () => {
    const dup = [SJV[0], SJV[0], SJV[1], SJV[2], SJV[2], SJV[2], SJV[3], SJV[0]] as LonLat[];
    const v = validateRoi(dup, CFG);
    expect(v.ok).toBe(true);
    expect(v.rings[0]).toHaveLength(4);
    expect(v.areaKm2).toBe(validateRoi(SJV, CFG).areaKm2);
  });

  it("fewer than 3 distinct vertices → TOO_FEW_VERTICES", () => {
    expect(codes(validateRoi([], CFG))).toEqual(["TOO_FEW_VERTICES"]);
    expect(codes(validateRoi([P(1, 1), P(2, 2)], CFG))).toEqual(["TOO_FEW_VERTICES"]);
    expect(codes(validateRoi([P(1, 1), P(1, 1), P(1, 1), P(1, 1)], CFG))).toEqual(["TOO_FEW_VERTICES"]);
    expect(codes(validateRoi([P(1, 1), P(2, 2), P(1, 1), P(2, 2)], CFG))).toEqual(["TOO_FEW_VERTICES"]);
    // 180 and -180 are the same meridian
    expect(codes(validateRoi([P(180, 0), P(-180, 0), P(10, 10)], CFG))).toEqual(["TOO_FEW_VERTICES"]);
  });

  it("zero-area sliver (all collinear) → DEGENERATE", () => {
    expect(codes(validateRoi([P(-119.9, 36.0), P(-119.8, 36.0), P(-119.7, 36.0)], CFG))).toEqual(["DEGENERATE"]);
    expect(codes(validateRoi([P(0, 0), P(1, 1), P(2, 2), P(3, 3)], CFG))).toEqual(["DEGENERATE"]);
    // Sub-lattice deviation (1e-12°) snaps onto the line: still zero area.
    expect(codes(validateRoi([P(0, 0), P(1, 1e-12), P(2, 0)], CFG))).toEqual(["DEGENERATE"]);
    expect(validateRoi([P(0, 0), P(1, 0), P(2, 0)], CFG).errors[0]?.message).toBe(ROI_MESSAGES.collinear);
  });

  it("near-zero-area sliver with real width → AREA_TOO_SMALL (not a crash, not DEGENERATE)", () => {
    const v = validateRoi([P(-119.9, 36.0), P(-119.7, 36.0), P(-119.8, 36.000001)], CFG);
    expect(codes(v)).toEqual(["AREA_TOO_SMALL"]);
    expect(v.areaKm2).toBeGreaterThan(0);
    // Lon/lat area ≈ 0.001 km²; the great-circle base bulges ~7 m north of the 0.1 m-high apex, so
    // the bounds-check area (measured 0.0405 km²) differs — still orders of magnitude below A_min.
    expect(v.areaKm2).toBeLessThan(0.1);
  });

  it("non-finite coordinates → DEGENERATE", () => {
    expect(codes(validateRoi([P(0, 0), P(Number.NaN, 1), P(1, 1)], CFG))).toEqual(["DEGENERATE"]);
    expect(codes(validateRoi([P(0, 0), P(Number.POSITIVE_INFINITY, 1), P(1, 1)], CFG))).toEqual(["DEGENERATE"]);
  });

  it("antimeridian-crossing square: area equals the same square at lon 0 (≤ 1e-9 rel); split into two rings", () => {
    const am = validateRoi([P(179.9, 10.0), P(-179.9, 10.0), P(-179.9, 10.2), P(179.9, 10.2)], CFG);
    const zero = validateRoi([P(-0.1, 10.0), P(0.1, 10.0), P(0.1, 10.2), P(-0.1, 10.2)], CFG);
    expect(am.ok).toBe(true);
    expect(zero.ok).toBe(true);
    expect(rel(am.areaKm2, zero.areaKm2)).toBeLessThan(1e-9);
    expect(am.rings).toHaveLength(2);
    for (const ring of am.rings) for (const p of ring) expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    // Splitting inserts vertices on the (great-circle) top/bottom edges, so the halves' bounds-check
    // areas differ slightly from the whole (measured 6.9e-7 rel).
    const split = am.rings.reduce((s, r) => s + sphericalAreaKm2(r), 0);
    expect(rel(split, am.areaKm2)).toBeLessThan(5e-6);
    expect(pointInRings(179.95, 10.1, am.rings)).toBe(true);
    expect(pointInRings(-179.95, 10.1, am.rings)).toBe(true);
    expect(pointInRings(0, 10.1, am.rings)).toBe(false);
    expect(pointInRings(179.85, 10.1, am.rings)).toBe(false);
  });

  it("antimeridian square given in unwrapped longitudes (179.9 → 180.1) normalises identically", () => {
    const a = validateRoi([P(179.9, 10.0), P(180.1, 10.0), P(180.1, 10.2), P(179.9, 10.2)], CFG);
    const b = validateRoi([P(179.9, 10.0), P(-179.9, 10.0), P(-179.9, 10.2), P(179.9, 10.2)], CFG);
    expect(a).toEqual(b);
  });

  it("a ring that loops around the pole → DEGENERATE", () => {
    const loop = [0, 90, 180, 270].map((lon) => P(lon, 89.8));
    const v = validateRoi(loop, CFG);
    expect(codes(v)).toEqual(["DEGENERATE"]);
    expect(v.errors[0]?.message).toBe(ROI_MESSAGES.poleLoop);
  });

  it("polygon touching the pole clamp: |lat| clamped to 89.9°, deterministic, area of the clamped cell", () => {
    const v = validateRoi([P(0, 89.7), P(10, 89.7), P(10, 90), P(0, 95)], CFG);
    expect(v.ok).toBe(true);
    const lats = v.rings.flat().map((p) => p.lat);
    expect(Math.max(...lats)).toBe(89.9);
    expect(v.rings[0]).toHaveLength(4);
    // Great-circle edges near the pole bulge poleward; compare with the Girard oracle on the clamped ring.
    expect(rel(v.areaKm2, girardAreaKm2(v.rings[0] as LonLat[]))).toBeLessThan(1e-6);
    expect(validateRoi([P(0, 89.7), P(10, 89.7), P(10, 90), P(0, 95)], CFG)).toEqual(v);
    // South pole too
    const s = validateRoi([P(0, -89.7), P(0, -91), P(10, -90), P(10, -89.7)], CFG);
    expect(Math.min(...s.rings.flat().map((p) => p.lat))).toBe(-89.9);
  });

  it("clockwise and counter-clockwise give the same verdict and area", () => {
    const ccw = validateRoi(SJV, CFG);
    const cw = validateRoi([...SJV].reverse(), CFG);
    expect(cw.ok).toBe(true);
    expect(rel(cw.areaKm2, ccw.areaKm2)).toBeLessThan(1e-12);
  });

  it("rotated starting vertex gives the same verdict and area", () => {
    for (let k = 1; k < 4; k++) {
      const rot = [...SJV.slice(k), ...SJV.slice(0, k)];
      const v = validateRoi(rot, CFG);
      expect(v.ok).toBe(true);
      expect(rel(v.areaKm2, validateRoi(SJV, CFG).areaKm2)).toBeLessThan(1e-12);
    }
  });

  it("tiny ROI (< 25 km²) → AREA_TOO_SMALL with a plain message", () => {
    const v = validateRoi(box(-119.9, 36.0, -119.87, 36.03), CFG); // ~9 km²
    expect(codes(v)).toEqual(["AREA_TOO_SMALL"]);
    expect(v.areaKm2).toBeGreaterThan(5);
    expect(v.areaKm2).toBeLessThan(25);
    expect(v.errors[0]?.message).toContain("at least 25 km²");
    expect(v.rings).toHaveLength(1); // geometry is fine, only the size is off
  });

  it("huge ROI (> 2,500 km²) → AREA_TOO_LARGE", () => {
    const v = validateRoi(box(-120.5, 35.5, -119.5, 36.5), CFG); // ~10,000 km²
    expect(codes(v)).toEqual(["AREA_TOO_LARGE"]);
    expect(v.areaKm2).toBeGreaterThan(2500);
    expect(v.errors[0]?.message).toContain("under 2500 km²");
  });

  it("area bounds are inclusive", () => {
    const a = validateRoi(SJV, CFG).areaKm2;
    expect(validateRoi(SJV, { roiAreaMinKm2: a, roiAreaMaxKm2: a }).ok).toBe(true);
  });

  it("messages are short and plain (brand voice)", () => {
    const msgs = [
      ...Object.values(ROI_MESSAGES),
      validateRoi(box(-119.9, 36.0, -119.87, 36.03), CFG).errors[0]?.message ?? "",
      validateRoi(box(-120.5, 35.5, -119.5, 36.5), CFG).errors[0]?.message ?? "",
    ];
    for (const m of msgs) {
      expect(m.length).toBeGreaterThan(10);
      expect(m.length).toBeLessThan(110);
      expect(m).not.toMatch(/error|invalid|protocol|initiate/i);
    }
  });
});

describe("sphericalAreaKm2", () => {
  it("1°×1° equator cell vs the analytic spherical value", () => {
    const ring = box(0, 0, 1, 1);
    const a = sphericalAreaKm2(ring);
    const analytic = cellAreaKm2(1, 0, 1); // parallel-bounded cell: R²·Δλ·(sin 1° − sin 0°)
    expect(a).toBeGreaterThan(12_300);
    expect(a).toBeLessThan(12_400);
    // Great-circle top edge bulges poleward: ≈ Δλ³·sinφ·cos²φ/12 ≈ 2.5e-5 relative. Documented.
    expect(rel(a, analytic)).toBeLessThan(5e-5);
    expect(a).toBeGreaterThan(analytic);
    // Exact great-circle oracle (Girard's theorem, independent vector maths).
    expect(rel(a, girardAreaKm2(ring))).toBeLessThan(1e-9);
  });

  it("equator-centred 1° cell and a mid-latitude cell match the Girard oracle", () => {
    for (const ring of [box(-0.5, -0.5, 0.5, 0.5), box(-120, 36, -119, 37), box(10, -60, 11, -59)]) {
      expect(rel(sphericalAreaKm2(ring), girardAreaKm2(ring))).toBeLessThan(1e-9);
    }
  });

  it("winding-independent, wrap-independent", () => {
    const r = box(-120, 36, -119.8, 36.2);
    expect(rel(sphericalAreaKm2([...r].reverse()), sphericalAreaKm2(r))).toBeLessThan(1e-12);
    expect(rel(sphericalAreaKm2(r.map((p) => P(p.lon + 360, p.lat))), sphericalAreaKm2(r))).toBeLessThan(1e-9);
  });

  it("fewer than 3 vertices → 0", () => {
    expect(sphericalAreaKm2([])).toBe(0);
    expect(sphericalAreaKm2([P(0, 0), P(1, 1)])).toBe(0);
  });
});

describe("nudgeVertex", () => {
  const verts = [P(-119.9, 36.0), P(-119.7, 36.0), P(-119.7, 36.2)];

  it("moves one vertex by 0.001° (×10 coarse) and returns a new array", () => {
    const n = nudgeVertex(verts, 1, "N", false);
    expect(n).not.toBe(verts);
    expect(n[1]).toEqual(P(-119.7, 36.001));
    expect(n[0]).toEqual(verts[0]);
    expect(verts[1]).toEqual(P(-119.7, 36.0)); // input untouched
    expect(nudgeVertex(verts, 1, "S", true)[1]).toEqual(P(-119.7, 35.99));
    expect(nudgeVertex(verts, 1, "E", false)[1]).toEqual(P(-119.699, 36.0));
    expect(nudgeVertex(verts, 1, "W", true)[1]).toEqual(P(-119.71, 36.0));
  });

  it("repeated nudges do not drift (lattice snap)", () => {
    let v = verts;
    for (let i = 0; i < 3; i++) v = nudgeVertex(v, 0, "N", false);
    expect(v[0]?.lat).toBe(36.003);
    for (let i = 0; i < 1000; i++) v = nudgeVertex(v, 0, "E", false);
    expect(v[0]?.lon).toBe(-118.9);
  });

  it("clamps latitude at ±89.9° and wraps longitude across ±180°", () => {
    expect(nudgeVertex([P(0, 89.8995)], 0, "N", true)[0]?.lat).toBe(89.9);
    expect(nudgeVertex([P(0, -89.8995)], 0, "S", false)[0]?.lat).toBe(-89.9);
    expect(nudgeVertex([P(179.9995, 0)], 0, "E", false)[0]?.lon).toBeCloseTo(-179.9995, 12);
    expect(nudgeVertex([P(-179.9995, 0)], 0, "W", false)[0]?.lon).toBeCloseTo(179.9995, 12);
    expect(nudgeVertex([P(179.999, 0)], 0, "E", false)[0]?.lon).toBe(180);
    expect(nudgeVertex([P(180, 0)], 0, "E", false)[0]?.lon).toBe(-179.999);
  });

  it("custom step and coarse factor; out-of-range index → unchanged copy", () => {
    expect(nudgeVertex(verts, 2, "N", true, 0.002, 5)[2]?.lat).toBe(36.21);
    const same = nudgeVertex(verts, 7, "N", false);
    expect(same).toEqual(verts);
    expect(same).not.toBe(verts);
  });
});

describe("pointInRings", () => {
  it("even-odd: inner ring is a hole", () => {
    const outer = box(0, 0, 10, 10);
    const inner = box(3, 3, 6, 6);
    expect(pointInRings(1, 1, [outer, inner])).toBe(true);
    expect(pointInRings(4, 4, [outer, inner])).toBe(false);
    expect(pointInRings(11, 4, [outer, inner])).toBe(false);
  });

  it("boundary rule: left/bottom edges inside, right/top edges outside", () => {
    const sq = box(0, 0, 1, 1);
    expect(pointInRings(0, 0.5, [sq])).toBe(true);
    expect(pointInRings(1, 0.5, [sq])).toBe(false);
    expect(pointInRings(0.5, 0, [sq])).toBe(true);
    expect(pointInRings(0.5, 1, [sq])).toBe(false);
  });

  it("winding and start vertex do not matter", () => {
    const sq = box(0, 0, 1, 1);
    const rev = [...sq].reverse();
    const rot = [...sq.slice(2), ...sq.slice(0, 2)];
    for (const [x, y] of [
      [0, 0.5],
      [1, 0.5],
      [0.5, 0],
      [0.5, 1],
      [0.3, 0.7],
      [0, 0],
      [1, 1],
    ] as const) {
      const a = pointInRings(x, y, [sq]);
      expect(pointInRings(x, y, [rev])).toBe(a);
      expect(pointInRings(x, y, [rot])).toBe(a);
    }
  });
});
