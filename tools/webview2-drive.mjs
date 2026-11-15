#!/usr/bin/env node
// Drives the PACKAGED BlindRev desktop app (Tauri v2 / real WebView2) over the Chrome DevTools Protocol.
//
//   node tools/webview2-drive.mjs --scenario play|measure|soak [--port 9333] [--size 1920x1080]
//        [--out docs/reports/desktop-shots] [--telemetry docs/reports/telemetry] [--udf <dir>]
//        [--soak-min 8] [--soak-snap 30] [--frames-ms 20000] [--switches 10] [--keep] [--exe <path>]
//
// launch → connect → scenario → screenshots + JSON → kill.
//  - The exe is started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=<port>
//    --enable-precise-memory-info" (precise heap numbers; Chromium otherwise buckets performance.memory and
//    refreshes it only every 20 min) and BLINDREV_WINDOW_SIZE=<size> (main-window inner size in logical px,
//    clamped to the monitor work area by the Rust shell).
//  - --udf sets WEBVIEW2_USER_DATA_FOLDER so a second instance (different debug port = different browser
//    arguments) does not collide with the first one's WebView2 user-data folder.
//  - After connecting, the page is reloaded with listeners + an init script attached, so console errors,
//    page errors, failed requests, HTTP >= 400 and CSP violations (securitypolicyviolation events +
//    "Refused to ..." console lines) are captured from first paint.
// Scenarios:
//  play    — menu → hub → briefing/mission → watch → "No acquisition" → date pair → ROI → validate →
//            verdict → save to journal → hub → menu → Quit (checks that Quit closes the process).
//  measure — frame p50/p95 on hub + mission (steady), N hub↔mission round trips (route timings),
//            10 forced context-loss cycles on each renderer, full telemetry export.
//  soak    — mission globe, auto-play scrub kept running, one hub round trip per minute; harness heap
//            snapshots (perf.soak) + independent CDP Runtime.getHeapUsage samples every --soak-snap s.
// Exit code: 0 = scenario ran (verdicts are in the JSON), 1 = launch/connect/scenario failure.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const a = {
  scenario: "play",
  port: 9333,
  size: "1920x1080",
  out: resolve(ROOT, "docs/reports/desktop-shots"),
  telemetry: resolve(ROOT, "docs/reports/telemetry"),
  udf: null,
  soakMin: 8,
  soakSnap: 30,
  framesMs: 20000,
  switches: 10,
  keep: false,
  exe: resolve(ROOT, "packages/app-shell/src-tauri/target/release/blindrev.exe"),
  tag: "",
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  const v = () => argv[++i];
  if (k === "--scenario") a.scenario = v();
  else if (k === "--port") a.port = Number(v());
  else if (k === "--size") a.size = v();
  else if (k === "--out") a.out = resolve(v());
  else if (k === "--telemetry") a.telemetry = resolve(v());
  else if (k === "--udf") a.udf = resolve(v());
  else if (k === "--soak-min") a.soakMin = Number(v());
  else if (k === "--soak-snap") a.soakSnap = Number(v());
  else if (k === "--frames-ms") a.framesMs = Number(v());
  else if (k === "--switches") a.switches = Number(v());
  else if (k === "--keep") a.keep = true;
  else if (k === "--exe") a.exe = resolve(v());
  else if (k === "--tag") a.tag = v();
  else {
    console.error(`unknown argument ${k}`);
    process.exit(2);
  }
}
if (!existsSync(a.exe)) {
  console.error(`[wv2] exe not found: ${a.exe} — run "pnpm desktop:build" first`);
  process.exit(1);
}
mkdirSync(a.out, { recursive: true });
mkdirSync(a.telemetry, { recursive: true });
const tag = a.tag || a.scenario;
const log = (...m) => console.log(`[wv2:${tag}]`, ...m);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ launch */
const env = {
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${a.port} --enable-precise-memory-info`,
  BLINDREV_WINDOW_SIZE: a.size,
};
if (a.udf) {
  mkdirSync(a.udf, { recursive: true });
  env.WEBVIEW2_USER_DATA_FOLDER = a.udf;
}
const tLaunch = Date.now();
const child = spawn(a.exe, [], { env, stdio: "ignore", detached: false });
let exited = null;
child.on("exit", (code, signal) => {
  exited = { code, signal, atMs: Date.now() - tLaunch };
});
log(`launched pid ${child.pid} (${(statSync(a.exe).size / 1048576).toFixed(1)} MB exe), CDP port ${a.port}`);

function killApp() {
  if (exited) return;
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
}
process.on("exit", () => {
  if (!a.keep) killApp();
});

async function cdpVersion() {
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${a.port}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    if (exited) throw new Error(`app exited before CDP came up: ${JSON.stringify(exited)}`);
    await sleepMs(200);
  }
  throw new Error("CDP endpoint did not come up within 30 s");
}

const out = { scenario: a.scenario, startedAt: new Date().toISOString(), exe: a.exe, exeBytes: statSync(a.exe).size };
const events = { console: [], pageErrors: [], requestFailed: [], httpErrors: [], csp: [], workers: [] };
let stage = "boot";
let page;
let browser;

async function main() {
  const ver = await cdpVersion();
  out.cdpVersion = ver;
  log(`CDP up after ${Date.now() - tLaunch} ms — ${ver.Browser} / ${ver["User-Agent"]}`);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${a.port}`);
  const ctx = browser.contexts()[0];
  for (let i = 0; i < 100 && !page; i++) {
    page = ctx.pages().find((p) => /^(https?:\/\/tauri\.localhost|tauri:)/.test(p.url()));
    if (!page) await sleepMs(100);
  }
  if (!page)
    throw new Error(
      `app page not found; pages: ${ctx
        .pages()
        .map((p) => p.url())
        .join(", ")}`,
    );
  out.appOrigin = new URL(page.url()).origin;
  log(`page ${page.url()}`);

  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || m.type() === "warning")
      events.console.push({ stage, type: m.type(), text: t.slice(0, 500) });
    if (/Content Security Policy|Refused to/i.test(t))
      events.csp.push({ stage, source: "console", text: t.slice(0, 500) });
  });
  page.on("pageerror", (e) => events.pageErrors.push({ stage, text: String(e).slice(0, 500) }));
  page.on("requestfailed", (r) =>
    events.requestFailed.push({ stage, url: r.url().slice(0, 300), error: r.failure()?.errorText }),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) events.httpErrors.push({ stage, url: r.url().slice(0, 300), status: r.status() });
  });
  page.on("worker", (w) => {
    events.workers.push({ stage, url: w.url().slice(0, 300) });
    w.on("console", (m) => {
      if (m.type() === "error") events.console.push({ stage, type: "worker-error", text: m.text().slice(0, 500) });
    });
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations.push({
        directive: e.violatedDirective,
        effective: e.effectiveDirective,
        blocked: String(e.blockedURI).slice(0, 300),
        source: `${e.sourceFile}:${e.lineNumber}`,
        sample: e.sample,
      });
    });
  });
  // Reload so every listener above sees the app from first paint.
  stage = "reload";
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__BLINDREV__, null, { timeout: 30000 });
  out.env = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    const r = {
      userAgent: navigator.userAgent,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      screen: { w: screen.width, h: screen.height, availW: screen.availWidth, availH: screen.availHeight },
      webgl2: !!gl,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl?.getParameter(gl.RENDERER) ?? null),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      isTauri: "__TAURI_INTERNALS__" in window,
      baseURI: document.baseURI,
      precisePerfMemory: !!performance.memory,
    };
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return r;
  });
  log(`env ${JSON.stringify(out.env)}`);

  if (a.scenario === "play") await playScenario();
  else if (a.scenario === "measure") await measureScenario();
  else if (a.scenario === "soak") await soakScenario();
  else if (a.scenario === "offline") await offlineScenario();
  else throw new Error(`unknown scenario ${a.scenario}`);
}

/* ------------------------------------------------------------------ helpers */
const H = (fn, arg) => page.evaluate(fn, arg);
const idle = (timeout = 60000) =>
  page.waitForFunction(() => window.__BLINDREV__?.state().wipe.phase === "idle", null, { timeout });
const shot = async (name) => {
  const p = resolve(a.out, `${name}.png`);
  await page.screenshot({ path: p });
  log(`shot ${p}`);
  return p;
};
const goTo = async (route) => {
  await H((r) => window.__BLINDREV__.actions.goTo(r), route);
  await idle();
};
const waitSceneReady = async (timeout = 30000) => {
  try {
    await page.waitForFunction(
      () => {
        const s = window.__BLINDREV__.state();
        return s.route !== "mission" || s.globeStatus?.sceneReady === true || s.globeMode !== "3d";
      },
      null,
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
};
const resources = () =>
  H(() =>
    performance.getEntriesByType("resource").map((e) => ({
      name: e.name.slice(0, 300),
      type: e.initiatorType,
      status: e.responseStatus ?? null,
      bytes: e.transferSize,
      ms: Math.round(e.duration),
    })),
  );

async function assetChecks() {
  const res = await resources();
  const pick = (re) => res.filter((r) => re.test(r.name));
  const summarize = (list) => ({
    count: list.length,
    statuses: [...new Set(list.map((r) => r.status))],
    sample: list.slice(0, 4).map((r) => r.name),
  });
  const fonts = await H(async () => {
    await document.fonts.ready;
    return {
      loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight} ${f.style}`),
      error: [...document.fonts].filter((f) => f.status === "error").map((f) => `${f.family} ${f.weight}`),
      outfit: document.fonts.check("600 16px Outfit"),
      plexSans: document.fonts.check("400 16px 'IBM Plex Sans'"),
      plexMono: document.fonts.check("400 16px 'IBM Plex Mono'"),
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
  });
  return {
    fonts,
    fontFiles: summarize(pick(/\.(woff2?|ttf)(\?|$)/)),
    audio: summarize(pick(/\/audio\/.+\.(mp3|ogg)/)),
    offlineTiles: summarize(pick(/offline-tiles\//)),
    missionData: summarize(pick(/mission-data\//)),
    cesiumWorkers: summarize(pick(/cesium\/Workers\//)),
    cesiumAssets: summarize(pick(/cesium\/(Assets|ThirdParty)\//)),
    wasm: summarize(pick(/\.wasm(\?|$)/)),
    gibs: summarize(pick(/gibs\.earthdata\.nasa\.gov/)),
    ion: summarize(pick(/cesium\.com/)),
    celestrak: summarize(pick(/celestrak\.org/)),
    absoluteSelfUrls: res.filter((r) => r.name.startsWith(out.appOrigin)).length,
    totalResources: res.length,
  };
}

/* ------------------------------------------------------------------ play */
async function playScenario() {
  const r = (out.play = { steps: {} });
  const step = (k, v) => {
    r.steps[k] = v;
    log(`${k}: ${JSON.stringify(v).slice(0, 300)}`);
  };
  stage = "menu";
  await page.evaluate(() => localStorage.removeItem("blindrev.journal.v1"));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-testid=menu]", { timeout: 30000 });
  await sleepMs(1200);
  step("menuItems", await H(() => [...document.querySelectorAll("[data-testid^=menu-]")].map((e) => e.dataset.testid)));
  r.shots = { menu: await shot("01-menu") };

  // Text zoom via hotkeys (tauri.conf.json zoomHotkeysEnabled). CDP key events reach the renderer first;
  // WebView2 handles unconsumed Ctrl+= / Ctrl+- / Ctrl+0 as browser accelerators when zoom control is on.
  stage = "zoom";
  const zr = async () => H(() => ({ dpr: devicePixelRatio, innerW: innerWidth }));
  const z0 = await zr();
  await page.keyboard.press("Control+Equal");
  await sleepMs(600);
  const z1 = await zr();
  await page.keyboard.press("Control+0");
  await sleepMs(600);
  const z2 = await zr();
  step("zoomHotkeys", { before: z0, afterCtrlPlus: z1, afterCtrl0: z2, zoomed: z1.dpr > z0.dpr });

  stage = "hub";
  await page.click("[data-testid=menu-new]");
  await sleepMs(200);
  await idle();
  await sleepMs(3000);
  const hub = await H(() => {
    const s = window.__BLINDREV__.state();
    const c = window.__BLINDREV__.scene?.renderer?.getCanvas?.();
    let ctxType = null;
    if (c) ctxType = c.getContext("webgl2") ? "webgl2" : "other";
    return {
      scene: s.scene,
      hubMode: s.hubMode,
      hubFallbackReason: s.hubFallbackReason,
      canvas: c ? { w: c.width, h: c.height, ctxType } : null,
      lifecycle: s.lifecycle,
    };
  });
  step("hub", hub);
  r.shots.hub = await shot("02-hub");

  stage = "briefing";
  await page.click("[data-testid=open-briefing]");
  await idle();
  await page.waitForSelector("[data-testid=briefing]", { timeout: 20000 });
  const ready = await waitSceneReady(30000);
  await sleepMs(2500);
  step(
    "globe",
    await H(() => {
      const s = window.__BLINDREV__.state();
      const c = window.__BLINDREV__.scene?.renderer?.getCanvas?.();
      return {
        sceneReadyWaitOk: true,
        scene: s.scene,
        globeMode: s.globeMode,
        globeFallbackReason: s.globeFallbackReason,
        globeStatus: s.globeStatus,
        canvas: c ? { w: c.width, h: c.height } : null,
      };
    }),
  );
  r.steps.globe.sceneReadyWaitOk = ready;
  r.shots.briefing = await shot("03-mission-briefing");

  stage = "watch";
  await page.click("[data-testid=start-investigation]");
  await sleepMs(4000);
  step("watchAfterStart", await H(() => window.__BLINDREV__.state().watch));
  r.shots.mission = await shot("04-mission-watch");

  stage = "no-acquisition";
  const idx = await H(() => window.__BLINDREV__.mission.steps.findIndex((s) => !s.isAvailable));
  if (idx >= 0) {
    await H(() => window.__BLINDREV__.actions.pause());
    await H((i) => window.__BLINDREV__.actions.scrubTo(i), idx);
    await sleepMs(900);
    step(
      "noAcquisition",
      await H(() => ({
        watch: window.__BLINDREV__.state().watch,
        flag: window.__BLINDREV__.state().mission.noAcquisition,
        card: !!document.querySelector("[data-testid=no-acquisition], .no-acq, [class*=noacq], [class*=no-acq]"),
      })),
    );
    r.shots.noAcquisition = await shot("05-no-acquisition");
  } else step("noAcquisition", "mission has no unavailable step");

  stage = "pair";
  const pair = await H(() => {
    const st = window.__BLINDREV__.mission.steps.filter((s) => s.isAvailable);
    return [st[0].stepId, st[st.length - 1].stepId];
  });
  await H((p) => window.__BLINDREV__.actions.selectPair(p[0], p[1]), pair);
  await H(() => window.__BLINDREV__.actions.scrubTo(window.__BLINDREV__.mission.steps.length - 1));
  await sleepMs(600);
  step("pair", { pair, status: await H(() => window.__BLINDREV__.state().pairStatus) });

  stage = "roi";
  await H(() => {
    const ref = window.__BLINDREV__.actions.referencePolygon();
    const closedRing = ref.length > 3 && ref[0].lon === ref.at(-1).lon && ref[0].lat === ref.at(-1).lat;
    window.__BLINDREV__.actions.setRoi(closedRing ? ref.slice(0, -1) : ref, true);
  });
  await sleepMs(1200);
  step("roi", await H(() => window.__BLINDREV__.state().validateStatus));
  r.shots.roi = await shot("06-roi");

  stage = "validate";
  await page.click("[data-testid=validate]", { timeout: 10000 });
  await page.waitForSelector("[data-testid=results]", { timeout: 20000 });
  await sleepMs(900);
  step("verdict", await H(() => window.__BLINDREV__.actions.getOutcome()));
  r.shots.verdict = await shot("07-verdict");

  stage = "journal";
  await page.click("[data-testid=save-journal]");
  await sleepMs(500);
  step("journalCount", await H(() => window.__BLINDREV__.state().journalCount));

  r.assets = await assetChecks();
  r.tle = await H(() => window.__BLINDREV__.state().tle);
  r.cspViolationsEvents = await H(() => window.__cspViolations);

  stage = "back-to-hub";
  await H(() => window.__BLINDREV__.actions.closeOverlay());
  await goTo("hub");
  await sleepMs(1500);
  r.shots.hubAgain = await shot("08-hub-again");
  step("lifecycle", await H(() => window.__BLINDREV__.state().lifecycle));
  r.routeTimings = await H(() => window.__BLINDREV__.perf.routeTimings());

  stage = "quit";
  await goTo("menu");
  await page.waitForSelector("[data-testid=menu-quit]", { timeout: 10000 });
  r.cspViolationsEvents = await H(() => window.__cspViolations);
  const tQuit = Date.now();
  await page.click("[data-testid=menu-quit]").catch((e) => log(`quit click: ${e.message}`));
  for (let i = 0; i < 100 && !exited; i++) await sleepMs(100);
  step("quit", { processExited: !!exited, exit: exited, afterMs: Date.now() - tQuit });
}

/* ------------------------------------------------------------------ measure */
async function measureScenario() {
  const m = (out.measure = {});
  stage = "boot";
  await page.waitForSelector("[data-testid=menu]", { timeout: 30000 });
  stage = "hub-frames";
  await goTo("hub");
  await sleepMs(4000);
  m.hubCanvas = await H(() => {
    const c = window.__BLINDREV__.scene?.renderer?.getCanvas?.();
    return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null;
  });
  const nRoutes0 = (await H(() => window.__BLINDREV__.perf.routeTimings())).length;
  m.hubFrames = await H((ms) => window.__BLINDREV__.perf.frames.sample(ms), a.framesMs);
  m.hubFramesRouteChanges = (await H(() => window.__BLINDREV__.perf.routeTimings())).length - nRoutes0;
  log(`hub frames ${JSON.stringify(m.hubFrames)} routeChangesDuringSample=${m.hubFramesRouteChanges}`);

  stage = "mission-frames";
  await goTo("mission");
  m.missionSceneReady = await waitSceneReady(30000);
  await H(() => window.__BLINDREV__.actions.closeOverlay());
  await sleepMs(6000);
  m.missionCanvas = await H(() => {
    const c = window.__BLINDREV__.scene?.renderer?.getCanvas?.();
    return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null;
  });
  m.globeStatus = await H(() => window.__BLINDREV__.state().globeStatus);
  const nRoutes1 = (await H(() => window.__BLINDREV__.perf.routeTimings())).length;
  m.missionFrames = await H((ms) => window.__BLINDREV__.perf.frames.sample(ms), a.framesMs);
  m.missionFramesRouteChanges = (await H(() => window.__BLINDREV__.perf.routeTimings())).length - nRoutes1;
  log(`mission frames ${JSON.stringify(m.missionFrames)} routeChangesDuringSample=${m.missionFramesRouteChanges}`);
  await shot(`${tag}-mission-steady`);

  stage = "ctxloss-globe";
  m.contextLossGlobe = await H(() => window.__BLINDREV__.perf.contextLossCycles(10));
  log(`ctx globe ${JSON.stringify(m.contextLossGlobe)}`);
  await sleepMs(1500);
  m.globeAfterCtxLoss = await H(() => window.__BLINDREV__.state().globeStatus);
  await shot(`${tag}-mission-after-ctxloss`);

  stage = "routes";
  const before = (await H(() => window.__BLINDREV__.perf.routeTimings())).length;
  // Per-frame wipe trace: which of {wipe phase, progress HUD, data tunnel} is on screen each rAF.
  await H(() => {
    const tr = (window.__wipeTrace = []);
    let lastKey = "";
    const loop = (t) => {
      const w = document.querySelector("[data-testid=wipe]");
      const phase = w?.dataset.phase ?? "none";
      const hud = !!document.querySelector("[data-testid=wipe-hud]");
      const tunnel = !!document.querySelector("[data-testid=data-tunnel]");
      const key = `${phase}|${hud}|${tunnel}`;
      if (phase !== "idle" || key !== lastKey) tr.push({ t: Math.round(t * 10) / 10, phase, hud, tunnel });
      lastKey = key;
      if (window.__wipeTraceOn !== false) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  for (let i = 0; i < a.switches; i++) {
    await goTo("hub");
    await sleepMs(800);
    await goTo("mission");
    await sleepMs(800);
  }
  const trace = await H(() => {
    window.__wipeTraceOn = false;
    return window.__wipeTrace;
  });
  const all = await H(() => window.__BLINDREV__.perf.routeTimings());
  m.routeTimingsAll = all;
  m.routeTimingsSwitchRun = all.slice(before);
  // Split the trace into switches (each starts at a "covering" frame after a non-covering one).
  const segs = [];
  for (let i = 0; i < trace.length; i++) {
    const f = trace[i];
    if (f.phase === "covering" && (i === 0 || trace[i - 1].phase !== "covering")) segs.push([]);
    if (segs.length) segs[segs.length - 1].push(f);
  }
  m.wipeTraceSwitches = segs.map((seg, k) => {
    const first = (pred) => seg.find(pred)?.t ?? null;
    const last = (pred) => [...seg].reverse().find(pred)?.t ?? null;
    const tCover = first((f) => f.phase === "covering");
    const tCovered = first((f) => f.phase === "covered");
    const tHud = first((f) => f.hud || f.tunnel);
    const tHudLast = last((f) => f.hud || f.tunnel);
    const tTunnel = first((f) => f.tunnel);
    const tTunnelLast = last((f) => f.tunnel);
    const tReveal = first((f) => f.phase === "revealing");
    const tIdle = first((f) => f.phase === "idle");
    const holdFrames = seg.filter((f) => f.phase === "covered").map((f) => f.t);
    let maxGap = 0;
    for (let i = 1; i < holdFrames.length; i++) maxGap = Math.max(maxGap, holdFrames[i] - holdFrames[i - 1]);
    const timing = m.routeTimingsSwitchRun[k] ?? null;
    return {
      from: timing?.from ?? null,
      to: timing?.to ?? null,
      totalMs: tCover !== null && tIdle !== null ? +(tIdle - tCover).toFixed(1) : null,
      coverMs: tCover !== null && tCovered !== null ? +(tCovered - tCover).toFixed(1) : null,
      // Ink-only time after cover-complete until the progress HUD / tunnel is on screen (frame-quantised).
      blankBeforeHudMs: tCovered !== null && tHud !== null ? +(tHud - tCovered).toFixed(1) : null,
      // Ink-only time between the HUD leaving and the reveal starting (the scene shows on the first reveal frame).
      blankBeforeRevealMs: (() => {
        if (tHudLast === null || tReveal === null) return null;
        const gap = seg.find((f) => f.t > tHudLast && f.phase === "covered" && !f.hud && !f.tunnel);
        return gap ? +(tReveal - gap.t).toFixed(1) : 0;
      })(),
      hudVisibleMs: tHud !== null && tReveal !== null ? +(tReveal - tHud).toFixed(1) : null,
      tunnelVisibleMs: tTunnel !== null && tTunnelLast !== null ? +(tTunnelLast - tTunnel).toFixed(1) : 0,
      revealMs: tReveal !== null && tIdle !== null ? +(tIdle - tReveal).toFixed(1) : null,
      maxFrameGapDuringHoldMs: +maxGap.toFixed(1),
      harnessBlankMs: timing?.blankMs ?? null,
      harnessReadyMs: timing?.readyMs ?? null,
    };
  });
  m.wipeTraceFrames = trace.length;
  m.routeBlankP95All = await H(() => window.__BLINDREV__.perf.routeBlankP95());
  m.lifecycle = await H(() => window.__BLINDREV__.state().lifecycle);

  stage = "ctxloss-hub";
  await goTo("hub");
  await sleepMs(3000);
  m.contextLossHub = await H(() => window.__BLINDREV__.perf.contextLossCycles(10));
  log(`ctx hub ${JSON.stringify(m.contextLossHub)}`);
  await sleepMs(1500);
  await shot(`${tag}-hub-after-ctxloss`);

  m.telemetry = await H(() => window.__BLINDREV__.telemetry());
  m.cspViolationsEvents = await H(() => window.__cspViolations);
}

/* ------------------------------------------------------------------ soak */
async function soakScenario() {
  const s = (out.soak = { cdpHeap: [], actions: [] });
  stage = "soak-setup";
  await page.waitForSelector("[data-testid=menu]", { timeout: 30000 });
  await goTo("hub");
  await sleepMs(1500);
  await goTo("mission");
  await waitSceneReady(30000);
  await H(() => window.__BLINDREV__.actions.closeOverlay());
  await sleepMs(3000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const heapSample = async (label) => {
    const h = await cdp.send("Runtime.getHeapUsage");
    const metrics = (await cdp.send("Performance.getMetrics")).metrics;
    const g = (n) => metrics.find((x) => x.name === n)?.value ?? null;
    const st = await H(() => ({
      route: window.__BLINDREV__.state().route,
      watch: window.__BLINDREV__.state().watch?.state,
      idx: window.__BLINDREV__.state().watch?.index,
    }));
    const rec = {
      tS: Math.round((Date.now() - tSoak) / 1000),
      label,
      usedMb: +(h.usedSize / 1048576).toFixed(2),
      totalMb: +(h.totalSize / 1048576).toFixed(2),
      jsHeapUsedMb: g("JSHeapUsedSize") !== null ? +(g("JSHeapUsedSize") / 1048576).toFixed(2) : null,
      nodes: g("Nodes"),
      listeners: g("JSEventListeners"),
      documents: g("Documents"),
      ...st,
    };
    s.cdpHeap.push(rec);
    log(`heap ${JSON.stringify(rec)}`);
  };
  const play = async () => {
    await H(() => {
      const api = window.__BLINDREV__;
      const w = api.state().watch;
      if (!w) return;
      if (w.state !== "PLAYING") {
        if (w.index >= api.mission.steps.length - 1) api.actions.scrubTo(0);
        api.actions.play();
      }
    });
  };
  const tSoak = Date.now();
  s.harnessStart = await H(([m, snap]) => window.__BLINDREV__.perf.soak.start(m, snap), [a.soakMin, a.soakSnap]);
  await H(() => window.__BLINDREV__.perf.frames.start());
  await play();
  await heapSample("start");
  let nextHeap = a.soakSnap * 1000;
  let nextTrip = 60000;
  const end = a.soakMin * 60000;
  stage = "soak";
  while (Date.now() - tSoak < end + 2000) {
    const t = Date.now() - tSoak;
    if (t >= nextHeap) {
      nextHeap += a.soakSnap * 1000;
      await heapSample("snap");
    }
    if (t >= nextTrip && t < end - 20000) {
      nextTrip += 60000;
      const t0 = Date.now();
      await goTo("hub");
      await sleepMs(1500);
      await goTo("mission");
      await waitSceneReady(20000);
      await H(() => window.__BLINDREV__.actions.closeOverlay());
      s.actions.push({ tS: Math.round(t / 1000), action: "hub round trip", ms: Date.now() - t0 });
    }
    await play();
    await sleepMs(1000);
  }
  await heapSample("end");
  s.harnessVerdict = await H(() => window.__BLINDREV__.perf.soak.status());
  s.frames = await H(() => window.__BLINDREV__.perf.frames.stop());
  s.telemetry = await H(() => window.__BLINDREV__.telemetry());
  await shot(`${tag}-soak-end`);
}

/* ------------------------------------------------------------------ offline */
// ?offline=1: bundled low-zoom tiles + mission rasters only, from the custom origin with relative URLs.
async function offlineScenario() {
  stage = "offline";
  await page.goto(`${out.appOrigin}/?offline=1&route=mission`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__BLINDREV__, null, { timeout: 30000 });
  await idle();
  const ready = await waitSceneReady(30000);
  await H(() => window.__BLINDREV__.actions.closeOverlay());
  await sleepMs(4000);
  out.offline = {
    sceneReady: ready,
    globeStatus: await H(() => window.__BLINDREV__.state().globeStatus),
    tle: await H(() => window.__BLINDREV__.state().tle),
    assets: await assetChecks(),
    cspViolationsEvents: await H(() => window.__cspViolations),
  };
  out.offline.shot = await shot("09-offline-mission");
}

/* ------------------------------------------------------------------ run */
let failed = null;
try {
  await main();
} catch (e) {
  failed = { stage, message: String(e?.message ?? e).slice(0, 1000) };
  console.error(`[wv2:${tag}] FAILED at ${stage}: ${failed.message}`);
  if (page) await shot(`zz-failed-${tag}-${stage}`).catch(() => {});
}
try {
  if (page && !exited) out.cspViolationsFinal = await page.evaluate(() => window.__cspViolations).catch(() => null);
} catch {}
out.failed = failed;
out.events = events;
out.exitedByItself = exited;
out.finishedAt = new Date().toISOString();
const jsonPath = resolve(a.telemetry, `webview2-${tag}.json`);
writeFileSync(jsonPath, JSON.stringify(out, null, 2));
log(`json ${jsonPath}`);
log(
  `summary ${JSON.stringify({ failed, consoleErrors: events.console.filter((c) => c.type !== "warning").length, pageErrors: events.pageErrors.length, requestFailed: events.requestFailed.length, httpErrors: events.httpErrors.length, csp: events.csp.length, workers: events.workers.length })}`,
);
if (browser) await browser.close().catch(() => {});
if (!a.keep) killApp();
process.exit(failed ? 1 : 0);
