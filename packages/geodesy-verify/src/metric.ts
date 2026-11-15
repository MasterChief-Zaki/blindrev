/** A measured verification result: max error over a vector set vs a tolerance (spec §8). */
export interface Metric {
  id: string;
  set: "correctness" | "parity";
  op: "geodeticToEcef" | "ecefToGeodetic" | "enuBasis" | "scaleToAltitude";
  quantity: string;
  unit: "m" | "rad" | "1";
  tolerance: number;
  maxError: number;
  n: number;
  pass: boolean;
  /** Where the maximum occurred (for diagnostics). */
  worst: string;
  /** Diagnostic metrics attribute a discrepancy (e.g. Cesium vs the independent oracle); they are
   *  reported with their own pass/fail but never gate their set. */
  diagnostic?: boolean;
}

export class MaxTracker {
  max = 0;
  worst = "";
  n = 0;
  add(err: number, where: () => string): void {
    this.n++;
    // NaN must fail loudly
    if (!(err <= this.max)) {
      this.max = Number.isNaN(err) ? Number.POSITIVE_INFINITY : err;
      this.worst = where();
    }
  }
}

export function metric(base: Omit<Metric, "maxError" | "n" | "pass" | "worst">, t: MaxTracker): Metric {
  return { ...base, maxError: t.max, n: t.n, pass: t.max <= base.tolerance, worst: t.worst };
}

/** Gating metrics of a set (diagnostics excluded). */
export function gating(ms: Metric[]): Metric[] {
  return ms.filter((m) => !m.diagnostic);
}

export function fmtSample(lon: number, lat: number, h: number): string {
  const d = 180 / Math.PI;
  return `λ=${(lon * d).toFixed(9)}° φ=${(lat * d).toFixed(9)}° h=${h.toPrecision(9)} m`;
}

export function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}
