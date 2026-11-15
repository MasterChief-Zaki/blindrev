/**
 * 2D canvas artwork: mission screens, telemetry strip, banner logo, surface detail.
 * Pure Canvas2D — the resulting canvases are wrapped in THREE.CanvasTexture by the scene code.
 */
import { AMBER, CYAN, FONT_DISPLAY, FONT_MONO, INK, MAGENTA, PEARL } from "./palette";
import type { HubMission, HubOrbitState } from "./types";

export const SCREEN_W = 1024;
export const SCREEN_H = 440;

/** Largest font size (px) in [min, max] at which `text` fits `maxW` on one line. */
function fitFont(
  g: CanvasRenderingContext2D,
  text: string,
  weight: number,
  family: string,
  maxW: number,
  max: number,
  min: number,
): number {
  let size = max;
  for (; size > min; size -= 4) {
    g.font = `${weight} ${size}px ${family}`;
    if (g.measureText(text).width <= maxW) break;
  }
  g.font = `${weight} ${size}px ${family}`;
  return size;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas2D unavailable");
  return g;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Softened hexagon path (flat-top) with rounded corners. */
function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, round: number): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  g.beginPath();
  const p0 = pts[0] as [number, number];
  const p5 = pts[5] as [number, number];
  g.moveTo((p0[0] + p5[0]) / 2, (p0[1] + p5[1]) / 2);
  for (let i = 0; i < 6; i++) {
    const a = pts[i] as [number, number];
    const b = pts[(i + 1) % 6] as [number, number];
    g.arcTo(a[0], a[1], b[0], b[1], round);
  }
  g.closePath();
}

/** Outpost Signal mark: softened hex ring with a gap ("the open signal") around a clear observation point. */
export function drawLogo(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  lineW: number,
): void {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = lineW;
  g.lineCap = "round";
  const perim = 6 * r * 0.93;
  const gap = perim * 0.11;
  g.setLineDash([perim - gap, gap]);
  g.lineDashOffset = -perim * 0.02;
  hexPath(g, cx, cy, r, r * 0.28);
  g.stroke();
  g.setLineDash([]);
  g.beginPath();
  g.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function lockGlyph(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string): void {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = s * 0.12;
  g.beginPath();
  g.arc(cx, cy - s * 0.18, s * 0.3, Math.PI, 0);
  g.lineTo(cx + s * 0.3, cy + s * 0.02);
  g.moveTo(cx - s * 0.3, cy + s * 0.02);
  g.lineTo(cx - s * 0.3, cy - s * 0.18);
  g.stroke();
  const bw = s * 0.86;
  const bh = s * 0.62;
  g.beginPath();
  g.roundRect(cx - bw / 2, cy, bw, bh, s * 0.1);
  g.fill();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(cx, cy + bh * 0.42, s * 0.08, 0, Math.PI * 2);
  g.fill();
  g.fillRect(cx - s * 0.035, cy + bh * 0.42, s * 0.07, bh * 0.32);
  g.restore();
}

function wrapLines(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
    return kept;
  }
  return lines;
}

/** Draws one mission screen. Background stays dark; scan lines/curvature are added in the screen shader. */
export function themeRamp(theme: string): [string, string, string] {
  const t = theme.toLowerCase();
  if (t.startsWith("subsid")) return ["#8F5236", "#C9784A", "#E2B08A"];
  if (t.startsWith("defor") || t.startsWith("forest")) return ["#2F6B4C", "#4F8F6A", "#8DBF8A"];
  if (t.startsWith("wet")) return ["#2A7471", "#3E9C9A", "#8CCFC8"];
  if (t.startsWith("glac") || t.startsWith("ice")) return ["#8FB8D4", "#BFE3F2", "#EAF6FB"];
  return ["#3a3f5a", "#6c7290", "#c4c8d2"];
}

/** World label screen: case number, title, kicker, objective task light (active) or lock glyph + "Locked". */
export function drawMissionScreen(c: HTMLCanvasElement, m: HubMission, focused: boolean, index: number): void {
  const g = ctx2d(c);
  const W = c.width;
  const H = c.height;
  g.save();
  g.clearRect(0, 0, W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, m.locked ? "#141729" : "#10263a");
  bg.addColorStop(1, INK);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = m.locked ? "rgba(243,245,247,0.035)" : "rgba(61,224,208,0.06)";
  g.lineWidth = 2;
  for (let x = 48; x < W; x += 48) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  const pad = 44;
  const num = String(index + 1).padStart(2, "0");
  const ramp = themeRamp(m.theme);
  g.textBaseline = "alphabetic";
  // Ramp swatch (the world's 3-step terrain colours) along the left edge.
  ramp.forEach((col, i) => {
    g.fillStyle = col;
    g.globalAlpha = m.locked ? 0.45 : 1;
    g.fillRect(0, (H / 3) * i, 16, H / 3);
  });
  g.globalAlpha = 1;
  const innerW = W - pad * 2 - 8;
  if (m.locked) {
    // Type is sized for 720p legibility: the world name is the headline, the lock glyph + word the state.
    g.fillStyle = "rgba(243,245,247,0.78)";
    g.font = `400 42px ${FONT_MONO}`;
    g.fillText(`${num} / ${m.caseId}`, pad, pad + 36);
    g.fillStyle = PEARL;
    fitFont(g, m.title, 800, FONT_DISPLAY, innerW, 116, 56);
    g.fillText(m.title, pad, 212);
    lockGlyph(g, pad + 46, 292, 88, PEARL);
    g.fillStyle = PEARL;
    g.font = `600 78px ${FONT_DISPLAY}`;
    g.fillText("Locked", pad + 116, 292 + 62);
  } else {
    g.fillStyle = CYAN;
    g.font = `400 42px ${FONT_MONO}`;
    g.fillText(`${num} / ${m.caseId}`, pad, pad + 36);
    g.textAlign = "right";
    g.fillText(focused ? "SELECTED" : "READY", W - pad, pad + 36);
    g.textAlign = "left";
    g.fillStyle = PEARL;
    fitFont(g, m.title, 800, FONT_DISPLAY, innerW, 132, 64);
    g.fillText(m.title, pad, 206);
    g.fillStyle = AMBER;
    g.font = `600 48px ${FONT_DISPLAY}`;
    fitFont(g, m.kicker, 600, FONT_DISPLAY, innerW, 48, 34);
    g.fillText(wrapLines(g, m.kicker, innerW, 1)[0] ?? "", pad, 282);
    const oy = H - pad + 6;
    g.fillStyle = AMBER;
    g.beginPath();
    g.arc(pad + 16, oy - 14, 16, 0, Math.PI * 2);
    g.fill();
    g.font = `400 38px ${FONT_MONO}`;
    g.fillText("OBJECTIVE", pad + 46, oy);
    const ox = pad + 46 + g.measureText("OBJECTIVE").width + 22;
    g.font = `600 42px ${FONT_DISPLAY}`;
    const openW = focused ? g.measureText("Open case ›").width : 0;
    // Both lines when they fit; under focus the call to action wins the row.
    if (!focused || ox + g.measureText("Find the evidence.").width + 28 <= W - pad - openW) {
      g.fillStyle = PEARL;
      g.fillText("Find the evidence.", ox, oy);
    }
    if (focused) {
      g.textAlign = "right";
      g.fillStyle = CYAN;
      g.fillText("Open case ›", W - pad, oy);
      g.textAlign = "left";
    }
  }
  g.restore();
}

function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(2).padStart(5, "0")}°${lat >= 0 ? "N" : "S"}`;
}
function fmtLon(lon: number): string {
  return `${Math.abs(lon).toFixed(2).padStart(6, "0")}°${lon >= 0 ? "E" : "W"}`;
}

/** Narrow telemetry strip above the board. Labels the value as propagated (SGP4), never as live telemetry. */
export function drawTelemetry(c: HTMLCanvasElement, s: HubOrbitState | null): void {
  const g = ctx2d(c);
  const W = c.width;
  const H = c.height;
  g.save();
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);
  g.font = `400 40px ${FONT_MONO}`;
  g.textBaseline = "middle";
  drawLogo(g, 56, H / 2, 30, CYAN, 7);
  g.fillStyle = CYAN;
  g.fillText("NISAR", 112, H / 2 + 2);
  g.fillStyle = PEARL;
  if (s) {
    const alt = Math.round(s.heightM / 1000);
    g.font = `400 36px ${FONT_MONO}`;
    g.fillText(`${fmtLat(s.latDeg)} ${fmtLon(s.lonDeg)}  ${alt} km`, 250, H / 2 + 2);
    g.fillStyle = AMBER;
    g.textAlign = "right";
    g.font = `400 30px ${FONT_MONO}`;
    g.fillText("PROPAGATED", W - 30, H / 2 + 2);
  } else {
    g.globalAlpha = 0.7;
    g.fillText("No ephemeris loaded", 270, H / 2 + 2);
    g.globalAlpha = 1;
    g.fillStyle = AMBER;
    g.textAlign = "right";
    g.fillText("STANDBY", W - 36, H / 2 + 2);
  }
  g.restore();
}

/** Magenta cloth banner with the cyan hex-ring mark and wordmark. */
export function drawBanner(c: HTMLCanvasElement): void {
  const g = ctx2d(c);
  const W = c.width;
  const H = c.height;
  g.fillStyle = MAGENTA;
  g.fillRect(0, 0, W, H);
  // Woven texture + soft folds.
  for (let x = 0; x < W; x += 4) {
    g.fillStyle = `rgba(14,16,32,${0.035 + 0.035 * Math.sin(x * 0.9)})`;
    g.fillRect(x, 0, 2, H);
  }
  for (let i = 0; i < 5; i++) {
    const fx = (W / 5) * (i + 0.5);
    const grad = g.createLinearGradient(fx - 60, 0, fx + 60, 0);
    grad.addColorStop(0, "rgba(14,16,32,0)");
    grad.addColorStop(0.5, "rgba(14,16,32,0.16)");
    grad.addColorStop(1, "rgba(14,16,32,0)");
    g.fillStyle = grad;
    g.fillRect(fx - 60, 0, 120, H);
  }
  // Hem bands.
  g.fillStyle = "rgba(14,16,32,0.55)";
  g.fillRect(0, 0, W, 34);
  g.fillRect(0, H - 90, W, 12);
  drawLogo(g, W / 2, H * 0.34, W * 0.3, CYAN, W * 0.07);
  g.fillStyle = PEARL;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = `800 ${Math.round(W * 0.15)}px ${FONT_DISPLAY}`;
  g.fillText("BlindRev", W / 2, H * 0.62);
  g.font = `400 ${Math.round(W * 0.055)}px ${FONT_MONO}`;
  g.fillStyle = "rgba(243,245,247,0.85)";
  g.fillText("FIELD BUREAU / ORBITAL", W / 2, H * 0.68);
  // Swallowtail cut is done in geometry; fringe line here.
  g.fillStyle = "rgba(14,16,32,0.4)";
  for (let x = 0; x < W; x += 10) g.fillRect(x, H - 40, 4, 40);
}

export function drawPanel(c: HTMLCanvasElement): void {
  const g = ctx2d(c);
  const W = c.width;
  const H = c.height;
  g.fillStyle = "#c4c8d2";
  g.fillRect(0, 0, W, H);
  // Panel seams + rivets.
  g.strokeStyle = "#565c70";
  g.lineWidth = 4;
  g.strokeRect(6, 6, W - 12, H - 12);
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W, H / 2);
  g.stroke();
  g.fillStyle = "#7d8396";
  for (let x = 22; x < W; x += 40) {
    for (const y of [20, H / 2 - 14, H / 2 + 14, H - 20]) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Grime.
  let s = 1234567;
  for (let i = 0; i < 900; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const x = s % W;
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const y = s % H;
    g.fillStyle = `rgba(28,32,54,${0.03 + (i % 7) * 0.008})`;
    g.fillRect(x, y, 3 + (i % 5) * 4, 2 + (i % 3) * 3);
  }
}

/** Large floor tiles with seams (albedo modulation for the glossy dark floor). */
export function drawTiles(c: HTMLCanvasElement): void {
  const g = ctx2d(c);
  const W = c.width;
  const H = c.height;
  g.fillStyle = "#c9cede";
  g.fillRect(0, 0, W, H);
  let s = 424242;
  for (let i = 0; i < 1400; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const x = s % W;
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const y = s % H;
    g.fillStyle = `rgba(40,44,70,${0.02 + (i % 5) * 0.01})`;
    g.fillRect(x, y, 6 + (i % 7) * 6, 2 + (i % 3) * 2);
  }
  g.fillStyle = "#3a3f5a";
  g.fillRect(0, 0, W, 5);
  g.fillRect(0, 0, 5, H);
  g.fillStyle = "#e2e6f0";
  g.fillRect(0, 5, W, 2);
  g.fillRect(5, 0, 2, H);
}
