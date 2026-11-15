/* Anomaly Detector (ARCHITECTURE §10): threshold + 4-connected components over the current step's
 * displacement grid (`.f32`, SIMULATED). Flags candidates — decoys included — and never says which is real. */
import { assetUrl } from "../env";
import type { Bounds, LonLat, TemporalStep } from "../types";

export interface Anomaly {
  id: string;
  label: string;
  centre: LonLat;
  ring: LonLat[];
  peak: number;
  unit: string;
  pixels: number;
  areaKm2: number;
}

export interface DisplacementGrid {
  width: number;
  height: number;
  bounds: Bounds;
  data: Float32Array;
}

const gridCache = new Map<string, Promise<DisplacementGrid | null>>();

/** The `.f32` sits next to the evidence PNG (same basename). Grid size is inferred: QA grid, or square. */
export function f32UrlFor(step: TemporalStep): string | null {
  if (!step.isAvailable || !step.tileUrlTemplate || /\{/.test(step.tileUrlTemplate)) return null;
  return step.tileUrlTemplate.replace(/\.(png|webp|jpg)$/i, ".f32");
}

export function loadDisplacement(
  step: TemporalStep,
  hint?: { width: number; height: number },
): Promise<DisplacementGrid | null> {
  const url = f32UrlFor(step);
  if (!url) return Promise.resolve(null);
  let p = gridCache.get(url);
  if (!p) {
    p = fetch(assetUrl(url))
      .then(async (r) => {
        if (!r.ok || (r.headers.get("content-type") ?? "").includes("text/html")) return null;
        const buf = await r.arrayBuffer();
        if (buf.byteLength % 4) return null;
        const n = buf.byteLength / 4;
        let w = 0;
        let h = 0;
        if (hint && hint.width * hint.height === n) {
          w = hint.width;
          h = hint.height;
        } else {
          const s = Math.round(Math.sqrt(n));
          if (s * s !== n) return null;
          w = s;
          h = s;
        }
        // explicit little-endian decode
        const dv = new DataView(buf);
        const data = new Float32Array(n);
        for (let i = 0; i < n; i++) data[i] = dv.getFloat32(i * 4, true);
        return { width: w, height: h, bounds: step.bounds, data };
      })
      .catch(() => null);
    gridCache.set(url, p);
  }
  return p;
}

export function sampleGrid(g: DisplacementGrid, lon: number, lat: number, noData: number | null): number | null {
  const [w, s, e, n] = g.bounds;
  if (lon < w || lon > e || lat < s || lat > n) return null;
  const col = Math.min(g.width - 1, Math.floor(((lon - w) / (e - w)) * g.width));
  const row = Math.min(g.height - 1, Math.floor(((n - lat) / (n - s)) * g.height));
  const v = g.data[row * g.width + col];
  if (v === undefined || !Number.isFinite(v) || (noData !== null && v === noData)) return null;
  return v;
}

/** |value| ≥ threshold → candidate pixel; components smaller than minPixels are dropped; top `max` by |peak|×size. */
export function detectAnomalies(
  g: DisplacementGrid,
  threshold: number,
  unit: string,
  opts: { minPixels?: number; max?: number } = {},
): Anomaly[] {
  const { width: W, height: H, data } = g;
  const minPixels = opts.minPixels ?? Math.max(6, Math.round((W * H) / 20000));
  const max = opts.max ?? 6;
  const lab = new Int32Array(W * H).fill(-1);
  const stack: number[] = [];
  const comps: {
    px: number;
    peak: number;
    minC: number;
    maxC: number;
    minR: number;
    maxR: number;
    sc: number;
    sr: number;
  }[] = [];
  for (let i = 0; i < W * H; i++) {
    const v = data[i] as number;
    if (lab[i] !== -1 || !(Math.abs(v) >= threshold)) continue;
    const id = comps.length;
    const c = { px: 0, peak: 0, minC: W, maxC: 0, minR: H, maxR: 0, sc: 0, sr: 0 };
    lab[i] = id;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop() as number;
      const r = (k / W) | 0;
      const col = k - r * W;
      const val = data[k] as number;
      c.px++;
      if (Math.abs(val) > Math.abs(c.peak)) c.peak = val;
      c.minC = Math.min(c.minC, col);
      c.maxC = Math.max(c.maxC, col);
      c.minR = Math.min(c.minR, r);
      c.maxR = Math.max(c.maxR, r);
      c.sc += col;
      c.sr += r;
      const nb = [col > 0 ? k - 1 : -1, col < W - 1 ? k + 1 : -1, r > 0 ? k - W : -1, r < H - 1 ? k + W : -1];
      for (const q of nb) {
        if (q < 0 || lab[q] !== -1) continue;
        if (Math.abs(data[q] as number) >= threshold) {
          lab[q] = id;
          stack.push(q);
        }
      }
    }
    comps.push(c);
  }
  const [w, s, e, n] = g.bounds;
  const dLon = (e - w) / W;
  const dLat = (n - s) / H;
  const midLat = ((n + s) / 2) * (Math.PI / 180);
  const pxKm2 = dLon * 111.32 * Math.cos(midLat) * dLat * 110.57;
  return comps
    .filter((c) => c.px >= minPixels)
    .sort((a, b) => Math.abs(b.peak) * b.px - Math.abs(a.peak) * a.px)
    .slice(0, max)
    .sort((a, b) => a.sc / a.px - b.sc / b.px)
    .map((c, i) => {
      const lon0 = w + c.minC * dLon;
      const lon1 = w + (c.maxC + 1) * dLon;
      const lat1 = n - c.minR * dLat;
      const lat0 = n - (c.maxR + 1) * dLat;
      return {
        id: `anomaly-${i + 1}`,
        label: `A${i + 1}`,
        centre: { lon: w + (c.sc / c.px + 0.5) * dLon, lat: n - (c.sr / c.px + 0.5) * dLat },
        ring: [
          { lon: lon0, lat: lat0 },
          { lon: lon1, lat: lat0 },
          { lon: lon1, lat: lat1 },
          { lon: lon0, lat: lat1 },
        ],
        peak: c.peak,
        unit,
        pixels: c.px,
        areaKm2: c.px * pxKm2,
      };
    });
}
