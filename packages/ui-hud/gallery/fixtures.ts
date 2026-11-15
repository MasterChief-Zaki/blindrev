// Gallery-only fixtures: fake temporal steps + a procedurally drawn SIMULATED displacement backdrop.
import type { Bounds, TemporalStep } from "@blindrev/core-sim";

export const GALLERY_BOUNDS: Bounds = [-120.25, 35.85, -119.75, 36.25];

const DATES = [
  "2026-01-07",
  "2026-01-19",
  "2026-01-31",
  "2026-02-12",
  "2026-02-24",
  "2026-03-08",
  "2026-03-20",
  "2026-04-01",
  "2026-04-13",
];
const UNAVAILABLE = new Set([2, 6]);

export function fakeSteps(): TemporalStep[] {
  return DATES.map((date, i) => {
    const ok = !UNAVAILABLE.has(i);
    return {
      schemaVersion: 2,
      stepId: `s${String(i + 1).padStart(2, "0")}`,
      date,
      acquisitionStart: `${date}T01:52:10Z`,
      acquisitionEnd: `${date}T01:52:40Z`,
      isAvailable: ok,
      platform: "NISAR",
      instrument: "L-SAR",
      processingVersion: "GALLERY_FIXTURE",
      sourceId: "TEST_FIXTURE",
      layerId: `evidence-${i}`,
      tileUrlTemplate: "",
      crs: "EPSG:4326",
      bounds: GALLERY_BOUNDS,
      resolutionMeters: 80,
      noDataValue: null,
      displacement: null,
      acquisition: { track: 137, frame: 40, orbitDirection: "ASCENDING" },
      tiling: { tileMatrixSet: "SINGLE_TILE", minZoom: 0, maxZoom: 0 },
      qaMaskId: null,
      qaMaskUrlTemplate: null,
      evidenceMaskId: null,
      evidenceMaskUrlTemplate: null,
      uncertainty: null,
      uncertaintyType: "none",
      license: "TEST_FIXTURE",
      attribution: "Gallery fixture",
      citation: "Gallery fixture",
    } satisfies TemporalStep;
  });
}

/** Deterministic "busy" displacement-ish raster in the subsidence ramp, as a data URL. */
export function makeBackdrop(w = 640, h = 520): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return "";
  const img = g.createImageData(w, h);
  const ramp = [
    [0x2a, 0x2f, 0x4a],
    [0x8f, 0x52, 0x36],
    [0xc9, 0x78, 0x4a],
    [0xe2, 0xb0, 0x8a],
  ];
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const bowl = Math.exp(-(((u - 0.56) / 0.2) ** 2 + ((v - 0.48) / 0.26) ** 2));
      const bowl2 = 0.6 * Math.exp(-(((u - 0.3) / 0.1) ** 2 + ((v - 0.7) / 0.12) ** 2));
      const fringe = 0.18 * Math.sin((u * 31 + v * 17) * 1.3) * Math.cos(v * 23);
      const t = Math.max(0, Math.min(0.999, bowl + bowl2 + fringe + (rnd() - 0.5) * 0.35));
      const k = t * (ramp.length - 1);
      const i0 = Math.floor(k);
      const f = k - i0;
      const a = ramp[i0]!;
      const b = ramp[Math.min(ramp.length - 1, i0 + 1)]!;
      const o = (y * w + x) * 4;
      img.data[o] = a[0]! + (b[0]! - a[0]!) * f;
      img.data[o + 1] = a[1]! + (b[1]! - a[1]!) * f;
      img.data[o + 2] = a[2]! + (b[2]! - a[2]!) * f;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Field lines: a canal + roads, for visual busyness.
  g.strokeStyle = "rgba(140,207,200,0.85)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(w * 0.05, h * 0.1);
  g.bezierCurveTo(w * 0.4, h * 0.3, w * 0.5, h * 0.6, w * 0.95, h * 0.92);
  g.stroke();
  g.strokeStyle = "rgba(243,245,247,0.35)";
  g.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    g.beginPath();
    g.moveTo(0, (h * i) / 8);
    g.lineTo(w, (h * i) / 8 + 6);
    g.stroke();
  }
  return c.toDataURL("image/png");
}
