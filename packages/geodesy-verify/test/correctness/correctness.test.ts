// Correctness set (spec §8): independent analytic oracles + round-trip closure. Never imports Cesium.
import { describe, expect, it } from "vitest";
import { analyticForwardVectors, oracleEcefToGeodetic, oracleGeodeticToEcef, runCorrectness } from "../../src/index";
import { gating } from "../../src/metric";

describe("oracle self-consistency (the oracles agree with each other and with exact values)", () => {
  it("reduced-latitude forward oracle reproduces the exact analytic vectors", () => {
    for (const v of analyticForwardVectors()) {
      const p = oracleGeodeticToEcef(v.lon, v.lat, v.h);
      expect(Math.abs(p.x - v.ecef.x)).toBeLessThan(1e-6);
      expect(Math.abs(p.y - v.ecef.y)).toBeLessThan(1e-6);
      expect(Math.abs(p.z - v.ecef.z)).toBeLessThan(1e-6);
    }
  });
  it("bisection inverse oracle inverts the forward oracle", () => {
    for (const v of analyticForwardVectors()) {
      const g = oracleEcefToGeodetic(v.ecef);
      expect(Math.abs(g.h - v.h)).toBeLessThan(1e-6);
      expect(Math.abs(g.lat - v.lat)).toBeLessThan(1e-9);
    }
  });
});

describe("core-sim geodesy — correctness vector set", () => {
  const metrics = runCorrectness();
  for (const m of gating(metrics)) {
    it(`${m.id} ${m.op}: ${m.quantity} ≤ ${m.tolerance} ${m.unit} (n=${m.n})`, () => {
      expect(m.n).toBeGreaterThan(0);
      if (!m.pass) throw new Error(`${m.id} max error ${m.maxError} > ${m.tolerance} at ${m.worst}`);
      expect(m.maxError).toBeLessThanOrEqual(m.tolerance);
    });
  }
});
