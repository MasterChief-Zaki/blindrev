#!/usr/bin/env node
// Plays the whole BlindRev loop in headless Chromium (GPU via ANGLE, SwiftShader fallback) and writes a
// screenshot per stage. Drives the real UI where it matters (buttons, keyboard) and the window.__BLINDREV__
// harness for deterministic ROI placement.
//
//   node packages/app-shell/scripts/play-loop.mjs --base http://localhost:5173/ --out shots/ [--query "stub=1"]
//        [--width 1920 --height 1080] [--gpu auto|gpu|swiftshader] [--reduced-motion]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const a = {
  base: "http://localhost:5173/",
  out: "shots",
  query: "",
  width: 1920,
  height: 1080,
  gpu: "auto",
  rm: false,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  const v = () => argv[++i];
  if (k === "--base") a.base = v();
  else if (k === "--out") a.out = v();
  else if (k === "--query") a.query = v();
  else if (k === "--width") a.width = Number(v());
  else if (k === "--height") a.height = Number(v());
  else if (k === "--gpu") a.gpu = v();
  else if (k === "--reduced-motion") a.rm = true;
}
const outDir = resolve(a.out);
mkdirSync(outDir, { recursive: true });

const GPU = ["--use-angle=d3d11", "--use-gl=angle", "--ignore-gpu-blocklist", "--enable-gpu", "--enable-webgl"];
const SWS = ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--enable-webgl"];
const browser = await chromium.launch({ headless: true, args: a.gpu === "swiftshader" ? SWS : GPU });
const ctx = await browser.newContext({
  viewport: { width: a.width, height: a.height },
  reducedMotion: a.rm ? "reduce" : "no-preference",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const log = [];
let stage = "boot";
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") log.push({ stage, type: m.type(), text: m.text().slice(0, 400) });
});
page.on("pageerror", (e) => log.push({ stage, type: "pageerror", text: String(e).slice(0, 400) }));
page.on("requestfailed", (r) =>
  log.push({ stage, type: "requestfailed", text: `${r.url()} ${r.failure()?.errorText}` }),
);

const H = (expr, arg) => page.evaluate(expr, arg);
const idle = () =>
  page.waitForFunction(() => window.__BLINDREV__?.state().wipe.phase === "idle", null, { timeout: 60000 });
const shot = async (name) => {
  const p = resolve(outDir, `${name}.png`);
  await page.screenshot({ path: p });
  console.log(`[play] ${name} -> ${p}`);
};
const sleep = (ms) => page.waitForTimeout(ms);
const results = {};

try {
  const url = `${a.base}${a.query ? `?${a.query}` : ""}`;
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => localStorage.removeItem("blindrev.journal.v1"));
  await page.reload({ waitUntil: "load" });
  stage = "menu";
  await page.waitForSelector(".menu");
  await sleep(600);
  await shot("01-menu");

  stage = "hub";
  await page.click("[data-testid=menu-new]");
  await sleep(200);
  await idle();
  await sleep(2500);
  results.hub = await H(() => window.__BLINDREV__.state().scene);
  await shot("02-hub");

  stage = "briefing";
  await page.click("[data-testid=open-briefing]");
  await idle();
  await page.waitForSelector("[data-testid=briefing]", { timeout: 15000 });
  await sleep(1500);
  results.globe = await H(() => ({
    scene: window.__BLINDREV__.state().scene,
    status: window.__BLINDREV__.state().globeStatus,
  }));
  await shot("03-briefing");

  stage = "watch";
  await page.click("[data-testid=start-investigation]");
  await sleep(3500);
  await shot("04-mission-watch");

  stage = "no-acquisition";
  const idx = await H(() => window.__BLINDREV__.mission.steps.findIndex((s) => !s.isAvailable));
  results.noAcqIndex = idx;
  if (idx >= 0) {
    await H(() => window.__BLINDREV__.actions.pause());
    await H((i) => window.__BLINDREV__.actions.scrubTo(i), idx);
    await sleep(800);
    results.noAcqState = await H(() => window.__BLINDREV__.state().watch);
    await shot("05-no-acquisition");
  }

  stage = "pair";
  const pair = await H(() => {
    const st = window.__BLINDREV__.mission.steps.filter((s) => s.isAvailable);
    return [st[0].stepId, st[st.length - 1].stepId];
  });
  await H((p) => window.__BLINDREV__.actions.selectPair(p[0], p[1]), pair);
  await H((i) => window.__BLINDREV__.actions.scrubTo(i), await H(() => window.__BLINDREV__.mission.steps.length - 1));
  await sleep(600);

  stage = "roi";
  // Draw on the map by real clicks where possible (stub renderer); otherwise via the harness.
  await H(() => {
    const ref = window.__BLINDREV__.actions.referencePolygon();
    window.__BLINDREV__.actions.setRoi(
      ref.slice(0, ref.length > 3 && ref[0].lon === ref.at(-1).lon && ref[0].lat === ref.at(-1).lat ? -1 : undefined),
      true,
    );
    window.__BLINDREV__.actions.selectVertex(0);
  });
  await sleep(1200);
  results.roi = await H(() => {
    const s = window.__BLINDREV__.state();
    return {
      validation: s.mission.validation && {
        ok: s.mission.validation.ok,
        area: s.mission.validation.areaKm2,
        errors: s.mission.validation.errors,
      },
      validateStatus: s.validateStatus,
    };
  });
  await shot("06-roi-drawn");

  stage = "validate";
  await page.click("[data-testid=validate]", { timeout: 8000 });
  await page.waitForSelector("[data-testid=results]", { timeout: 15000 });
  await sleep(600);
  results.pass = await H(() => window.__BLINDREV__.actions.getOutcome());
  await shot("07-results-pass");
  await page.click("[data-testid=save-journal]");
  await sleep(300);

  stage = "qa";
  await page.click("[data-testid=try-again]");
  await sleep(300);
  // Find a box with low QA coverage by scanning the QA mask of the pair's first step.
  const qaBox = await H(async () => {
    const api = window.__BLINDREV__;
    const m = api.mission;
    const s = api.state();
    const step = m.steps.find((x) => x.stepId === s.mission.pair.a);
    const asset = m.masks[step.qaMaskId];
    const buf = await (await fetch(new URL(asset.binUrl, document.baseURI))).arrayBuffer();
    const d = new Uint8Array(buf);
    const [w, so, e, n] = asset.bounds;
    const W = asset.width;
    const Hh = asset.height;
    const win = Math.max(8, Math.round(Math.min(W, Hh) / 6));
    let best = null;
    for (let r = 0; r + win <= Hh; r += Math.max(2, win >> 2))
      for (let c = 0; c + win <= W; c += Math.max(2, win >> 2)) {
        let v = 0;
        for (let y = r; y < r + win; y++) for (let x = c; x < c + win; x++) v += d[y * W + x];
        if (!best || v < best.v) best = { v, r, c };
      }
    const lon0 = w + (best.c / W) * (e - w);
    const lon1 = w + ((best.c + win) / W) * (e - w);
    const lat0 = n - (best.r / Hh) * (n - so);
    const lat1 = n - ((best.r + win) / Hh) * (n - so);
    return { box: [lon0, lat1, lon1, lat0], coverage: best.v / (win * win) };
  });
  results.qaBox = qaBox;
  await H((b) => {
    const [w, s, e, n] = b.box;
    window.__BLINDREV__.actions.setRoi(
      [
        { lon: w, lat: s },
        { lon: e, lat: s },
        { lon: e, lat: n },
        { lon: w, lat: n },
      ],
      true,
    );
  }, qaBox);
  await sleep(500);
  results.qaRoi = await H(() => window.__BLINDREV__.state().validateStatus);
  if (results.qaRoi.ok) {
    await page.click("[data-testid=validate]", { timeout: 8000 });
    await page.waitForSelector("[data-testid=results]", { timeout: 15000 });
    await sleep(500);
    results.qa = await H(() => window.__BLINDREV__.actions.getOutcome());
    await shot("08-results-qa");
    await page.click("[data-testid=save-journal]");
    await sleep(200);
    await page.click("[data-testid=try-again]");
  }

  stage = "editor";
  await page.click("[data-testid=open-2d-editor]");
  await sleep(800);
  await shot("09-roi-editor");
  await page.keyboard.press("Escape");
  await sleep(300);

  stage = "journal";
  await H(() => window.__BLINDREV__.actions.openOverlay("journal"));
  await sleep(400);
  const jrow = await page.$(".jrow__head");
  if (jrow) await jrow.click();
  await sleep(300);
  await shot("10-journal");
  await H(() => window.__BLINDREV__.actions.closeOverlay());

  stage = "back-to-hub";
  await H(() => window.__BLINDREV__.actions.goTo("hub"));
  await idle();
  await sleep(1500);
  await shot("11-hub-again");
  results.lifecycle = await H(() => window.__BLINDREV__.state().lifecycle);
  results.routeTimings = await H(() => window.__BLINDREV__.perf.routeTimings());
  results.tle = await H(() => window.__BLINDREV__.state().tle);
} catch (e) {
  console.error(`[play] FAILED at stage ${stage}:`, e.message);
  await shot(`zz-failed-${stage}`).catch(() => {});
  results.failedAt = stage;
  results.error = e.message;
}
writeFileSync(resolve(outDir, "play-results.json"), JSON.stringify({ results, log }, null, 2));
console.log(JSON.stringify({ results, log }, null, 1).slice(0, 6000));
await browser.close();
