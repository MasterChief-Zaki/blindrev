import { describe, expect, it } from "vitest";
import type { Bounds } from "../coreTypes";
import {
  clampToBounds,
  editorSizeForBounds,
  editorToLonLat,
  formatLat,
  formatLon,
  graticuleLines,
  lonLatToEditor,
  niceStep,
} from "./mapping";

// Huron – Kettleman City corridor-ish box (San Joaquin Valley).
const B: Bounds = [-120.2, 35.9, -119.7, 36.3];

describe("editorSizeForBounds", () => {
  it("corrects aspect by cos(mid-latitude)", () => {
    const s = editorSizeForBounds(B, 1000);
    const k = Math.cos((36.1 * Math.PI) / 180);
    expect(s.width).toBe(1000);
    expect(s.height).toBeCloseTo((1000 * 0.4) / (0.5 * k), 9);
  });
  it("is square-ish at the equator for a square degree box", () => {
    const s = editorSizeForBounds([10, -0.5, 11, 0.5], 800);
    expect(s.height).toBeCloseTo(800, 6);
  });
  it("falls back to a square for degenerate bounds", () => {
    expect(editorSizeForBounds([1, 1, 1, 2], 500)).toEqual({ width: 500, height: 500 });
  });
});

describe("lonLatToEditor / editorToLonLat", () => {
  const size = editorSizeForBounds(B, 1000);
  it("maps the corners exactly", () => {
    expect(lonLatToEditor({ lon: -120.2, lat: 36.3 }, B, size)).toEqual({ x: 0, y: 0 });
    const se = lonLatToEditor({ lon: -119.7, lat: 35.9 }, B, size);
    expect(se.x).toBeCloseTo(1000, 9);
    expect(se.y).toBeCloseTo(size.height, 9);
  });
  it("is linear (centre maps to the centre)", () => {
    const c = lonLatToEditor({ lon: -119.95, lat: 36.1 }, B, size);
    expect(c.x).toBeCloseTo(500, 9);
    expect(c.y).toBeCloseTo(size.height / 2, 9);
  });
  it("y grows southward", () => {
    const n = lonLatToEditor({ lon: -120, lat: 36.2 }, B, size);
    const s = lonLatToEditor({ lon: -120, lat: 36.0 }, B, size);
    expect(s.y).toBeGreaterThan(n.y);
  });
  it("round-trips to < 1e-9 degrees", () => {
    for (let i = 0; i < 200; i++) {
      const p = { lon: -120.2 + ((i * 37) % 101) / 200, lat: 35.9 + ((i * 53) % 97) / 240 };
      const q = editorToLonLat(lonLatToEditor(p, B, size), B, size);
      expect(Math.abs(q.lon - p.lon)).toBeLessThan(1e-9);
      expect(Math.abs(q.lat - p.lat)).toBeLessThan(1e-9);
    }
  });
  it("inverse maps editor pixels back to lon/lat", () => {
    const p = editorToLonLat({ x: 250, y: size.height * 0.75 }, B, size);
    expect(p.lon).toBeCloseTo(-120.075, 9);
    expect(p.lat).toBeCloseTo(36.0, 9);
  });
  it("is deterministic (bit-identical across calls)", () => {
    const a = lonLatToEditor({ lon: -119.8123, lat: 36.0456 }, B, size);
    const b = lonLatToEditor({ lon: -119.8123, lat: 36.0456 }, B, size);
    expect(Object.is(a.x, b.x) && Object.is(a.y, b.y)).toBe(true);
  });
});

describe("helpers", () => {
  it("clampToBounds", () => {
    expect(clampToBounds({ lon: -121, lat: 37 }, B)).toEqual({ lon: -120.2, lat: 36.3 });
  });
  it("niceStep picks 1/2/2.5/5 × 10^n", () => {
    expect(niceStep(0.5, 5)).toBeCloseTo(0.1, 12);
    expect(niceStep(0.4, 5)).toBeCloseTo(0.1, 12);
    expect(niceStep(12, 5)).toBeCloseTo(2.5, 12);
  });
  it("graticuleLines are strictly inside the range", () => {
    expect(graticuleLines(-120.2, -119.7, 0.1)).toEqual([-120.1, -120, -119.9, -119.8]);
    expect(graticuleLines(35.9, 36.3, 0.1)).toEqual([36, 36.1, 36.2]);
  });
  it("formats hemispheres", () => {
    expect(formatLon(-119.80001)).toBe("119.8000°W");
    expect(formatLat(36.12346)).toBe("36.1235°N");
  });
});
