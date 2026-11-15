#!/usr/bin/env node
// Draws the BlindRev app icon (matte, no glow): a softened hexagonal instrument ring in Cyan #3DE0D0
// with a gap ("the open signal") around a clear observation point, on an Ink #0E1020 rounded square.
//   node tools/make-icon.mjs [out.png] [size]
// Then: pnpm --filter @blindrev/app-shell tauri icon src-tauri/app-icon.png
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const out = process.argv[2] ?? "packages/app-shell/src-tauri/app-icon.png";
const N = Number(process.argv[3] ?? 1024);
const INK = [0x0e, 0x10, 0x20];
const CYAN = [0x3d, 0xe0, 0xd0];
const SS = 4; // supersamples per axis

// Signed distances in units of the icon size (0..1 space centred at 0).
function sdRoundRect(x, y, half, r) {
  const qx = Math.abs(x) - half + r;
  const qy = Math.abs(y) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
// Pointy-top regular hexagon with apothem r (iq's sdHexagon with axes swapped).
function sdHexagon(px, py, r) {
  const kx = -0.866025404,
    ky = 0.5,
    kz = 0.577350269;
  let x = Math.abs(py),
    y = Math.abs(px);
  const d = 2 * Math.min(kx * x + ky * y, 0);
  x -= d * kx;
  y -= d * ky;
  x -= Math.min(Math.max(x, -kz * r), kz * r);
  y -= r;
  return Math.hypot(x, y) * Math.sign(y);
}
const APOTHEM = 0.27,
  ROUND = 0.05,
  WIDTH = 0.07;
const GAP_CENTER = (-50 * Math.PI) / 180; // upper-right, screen coords (y down)
const GAP_HALF = (17 * Math.PI) / 180;
const DOT_R = 0.062;

function coverage(x, y) {
  // returns [bgAlpha, cyanAlpha]
  const bg = sdRoundRect(x, y, 0.47, 0.11) <= 0 ? 1 : 0;
  if (!bg) return [0, 0];
  const hex = Math.abs(sdHexagon(x, y, APOTHEM - ROUND) - ROUND) - WIDTH / 2;
  let ring = hex <= 0;
  if (ring) {
    let a = Math.atan2(y, x) - GAP_CENTER;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(a) < GAP_HALF) ring = false;
  }
  const dot = Math.hypot(x, y) <= DOT_R;
  return [1, ring || dot ? 1 : 0];
}

const png = new PNG({ width: N, height: N });
for (let py = 0; py < N; py++) {
  for (let px = 0; px < N; px++) {
    let bgA = 0,
      cyA = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / N - 0.5;
        const y = (py + (sy + 0.5) / SS) / N - 0.5;
        const [b, c] = coverage(x, y);
        bgA += b;
        cyA += c;
      }
    }
    bgA /= SS * SS;
    cyA /= SS * SS;
    const i = (py * N + px) * 4;
    const t = bgA > 0 ? cyA / bgA : 0;
    for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(INK[k] + (CYAN[k] - INK[k]) * t);
    png.data[i + 3] = Math.round(bgA * 255);
  }
}
writeFileSync(out, PNG.sync.write(png));
console.log(`wrote ${out} (${N}x${N})`);
