#!/usr/bin/env node
// Hub renderer harness (A1/A3 evidence). Requires the sandbox dev server: `pnpm --filter @blindrev/renderer-iss dev`.
//   node packages/renderer-iss/sandbox/harness.mjs [--url http://localhost:5182/] [--out <dir>]
// Measures on THIS machine: ready time, rAF frame-time sample, 10 forced context-loss cycles, 5 destroy/re-create
// cycles (old contexts must report isContextLost()), reduced-motion stillness. Prints one JSON object.
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const base = arg("--url", "http://localhost:5182/");
const outDir = resolve(arg("--out", "."));
mkdirSync(outDir, { recursive: true });

const GPU_ARGS = [
  "--use-angle=d3d11",
  "--use-gl=angle",
  "--ignore-gpu-blocklist",
  "--enable-gpu",
  "--enable-webgl",
  "--js-flags=--expose-gc",
  "--enable-precise-memory-info",
];
const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
const result = {};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}?clean=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__hubReady === true, null, { timeout: 20000 });
  result.main = await page.evaluate(async () => {
    const H = window.__hub;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pct = (a, p) => {
      const s = [...a].sort((x, y) => x - y);
      return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
    };
    const withTimeout = (p, ms, what) =>
      Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);
    const out = {};
    const hub = H.get();
    out.info = hub.__debug.info();
    // 1) frame-time sample (rAF intervals, 6 s after a 1.5 s warm-up)
    await sleep(1500);
    const frames = [];
    await new Promise((res) => {
      const t0 = performance.now();
      let last = t0;
      const f = (now) => {
        frames.push(now - last);
        last = now;
        if (now - t0 < 6000) requestAnimationFrame(f);
        else res();
      };
      requestAnimationFrame(f);
    });
    frames.shift();
    out.frames = {
      n: frames.length,
      p50: pct(frames, 50),
      p95: pct(frames, 95),
      max: Math.max(...frames),
      fps: 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length),
    };
    out.drawCalls = hub.__debug.info().drawCalls;
    out.triangles = hub.__debug.info().triangles;
    // 2) 10 forced context-loss cycles
    const cycles = [];
    for (let i = 0; i < 10; i++) {
      const lost = new Promise((r) => {
        const off = hub.on("contextLost", () => {
          off();
          r();
        });
      });
      const restored = new Promise((r) => {
        const off = hub.on("contextRestored", () => {
          off();
          r();
        });
      });
      const t = performance.now();
      hub.forceContextLoss();
      try {
        await withTimeout(lost, 5000, "contextLost");
        hub.forceContextRestore();
        await withTimeout(restored, 5000, "contextRestored");
        const ms = performance.now() - t;
        const before = hub.__debug.frameCount();
        await sleep(250);
        const after = hub.__debug.frameCount();
        cycles.push({ ok: true, recoveryMs: Math.round(ms), framesAfter: after - before });
      } catch (e) {
        cycles.push({ ok: false, error: String(e) });
      }
    }
    out.contextLoss = {
      cycles: cycles.length,
      recovered: cycles.filter((c) => c.ok && c.framesAfter > 0).length,
      maxRecoveryMs: Math.max(...cycles.map((c) => c.recoveryMs ?? 0)),
      detail: cycles,
    };
    out.afterLossInfo = {
      drawCalls: hub.__debug.info().drawCalls,
      earth: hub.__debug.info().earthTextures,
      nisar: hub.__debug.info().nisarLoaded,
    };
    return out;
  });
  await page.screenshot({ path: `${outDir}/hub-after-10-context-loss.png` });

  // Pointer: hover/click the active world label, then a locked one.
  await page.evaluate(() => {
    const h = window.__hub.get();
    window.__ev = [];
    h.on("missionFocus", (id) => window.__ev.push(`focus:${id}`));
    h.on("missionSelect", (id) => window.__ev.push(`select:${id}`));
  });
  for (const i of [0, 1]) {
    const [x, y] = await page.evaluate((k) => window.__hub.get().__debug.labelScreenPos(k), i);
    await page.mouse.move(x, y);
    await page.waitForTimeout(150);
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
    if (i === 0) await page.screenshot({ path: `${outDir}/hub-hover-active.png` });
  }
  await page.mouse.move(960, 1050);
  await page.waitForTimeout(150);
  result.pointer = await page.evaluate(() => window.__ev);

  result.lifecycle = await page.evaluate(async () => {
    const H = window.__hub;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { remountMs: [], oldContextLost: [] };
    if (window.gc) window.gc();
    await sleep(200);
    out.heapBeforeMb = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
    for (let i = 0; i < 5; i++) {
      const gl = H.get().getCanvas().getContext("webgl2");
      const t = performance.now();
      await H.remount();
      out.remountMs.push(Math.round(performance.now() - t));
      out.oldContextLost.push(gl ? gl.isContextLost() : "no-context");
    }
    await sleep(1500);
    out.canvasesInDom = document.querySelectorAll("canvas").length;
    if (window.gc) window.gc();
    await sleep(300);
    out.heapAfterMb = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
    return out;
  });
  await page.screenshot({ path: `${outDir}/hub-after-5-remounts.png` });
  result.finalDestroy = await page.evaluate(async () => {
    const H = window.__hub;
    const gl = H.get().getCanvas().getContext("webgl2");
    H.destroy();
    await new Promise((r) => setTimeout(r, 100));
    return { contextLost: gl.isContextLost(), canvasesInDom: document.querySelectorAll("canvas").length };
  });

  // 3) reduced motion: two screenshots 1.2 s apart must be pixel-identical (static camera, no sway/sweep/bob).
  const page2 = await ctx.newPage();
  page2.on("pageerror", (e) => errors.push(String(e)));
  await page2.goto(`${base}?clean=1&rm=1`, { waitUntil: "load" });
  await page2.waitForFunction(() => window.__hubReady === true, null, { timeout: 20000 });
  await page2.waitForTimeout(2500); // let the progressive 4k Earth upgrade land
  await page2.mouse.move(400, 300);
  await page2.screenshot({ path: `${outDir}/rm-a.png` });
  await page2.mouse.move(1500, 800);
  await page2.waitForTimeout(1200);
  await page2.screenshot({ path: `${outDir}/rm-b.png` });
  const a = PNG.sync.read(readFileSync(`${outDir}/rm-a.png`));
  const b = PNG.sync.read(readFileSync(`${outDir}/rm-b.png`));
  let diff = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) +
        Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2]) >
      6
    )
      diff++;
  }
  result.reducedMotion = { differingPixels: diff, ratio: diff / (a.width * a.height) };
} finally {
  result.errors = errors;
  await browser.close();
}
console.log(JSON.stringify(result, null, 1));
