// Parity set (spec §8): core-sim vs CesiumJS. Separate vitest project — a failure here is a
// parity-only failure and does not affect the correctness project.
import { describe, expect, it } from "vitest";
import { gating } from "../../src/metric";
import { runParity } from "../../src/parity";

describe("core-sim geodesy — parity vs CesiumJS", () => {
  const metrics = runParity();
  for (const m of gating(metrics)) {
    it(`${m.id} ${m.op}: ${m.quantity} ≤ ${m.tolerance} ${m.unit} (n=${m.n})`, () => {
      expect(m.n).toBeGreaterThan(0);
      if (!m.pass) throw new Error(`${m.id} max error ${m.maxError} > ${m.tolerance} at ${m.worst}`);
      expect(m.maxError).toBeLessThanOrEqual(m.tolerance);
    });
  }
});
