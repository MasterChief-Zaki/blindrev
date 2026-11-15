#!/usr/bin/env node
// Headless Chromium screenshot tool with real WebGL2 (GPU via ANGLE/D3D11, SwiftShader fallback).
//
//   node tools/shot.mjs --url <url> --out <png> [--wait 4000] [--width 1920] [--height 1080]
//                       [--eval "<js expression run in the page before the shot>"] [--after 500]
//                       [--reduced-motion] [--gpu auto|gpu|swiftshader] [--full-page] [--headed]
//                       [--timeout 30000] [--quiet]
//
// Order: launch → probe WebGL2 → goto(url, load) → wait <--wait> ms → eval (awaited, result printed)
//        → wait <--after> ms → screenshot.
// Stdout reports: renderer string (GPU vs SwiftShader), console errors/warnings, page errors,
// failed requests, and a final JSON summary line prefixed with "[shot] summary".
// Exit codes: 0 ok, 1 navigation/eval/screenshot failure, 2 bad arguments, 3 no WebGL2 at all.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright";

function parseArgs(argv) {
  const a = {
    url: null,
    out: null,
    wait: 4000,
    after: 500,
    width: 1920,
    height: 1080,
    eval: null,
    reducedMotion: false,
    gpu: "auto",
    fullPage: false,
    headed: false,
    timeout: 30000,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`missing value for ${k}`);
      return v;
    };
    switch (k) {
      case "--url":
        a.url = next();
        break;
      case "--out":
        a.out = next();
        break;
      case "--wait":
        a.wait = Number(next());
        break;
      case "--after":
        a.after = Number(next());
        break;
      case "--width":
        a.width = Number(next());
        break;
      case "--height":
        a.height = Number(next());
        break;
      case "--eval":
        a.eval = next();
        break;
      case "--reduced-motion":
        a.reducedMotion = true;
        break;
      case "--gpu":
        a.gpu = next();
        break;
      case "--full-page":
        a.fullPage = true;
        break;
      case "--headed":
        a.headed = true;
        break;
      case "--timeout":
        a.timeout = Number(next());
        break;
      case "--quiet":
        a.quiet = true;
        break;
      case "-h":
      case "--help":
        console.log(
          "usage: node tools/shot.mjs --url <url> --out <png> [--wait ms] [--width px] [--height px] " +
            '[--eval "<js>"] [--after ms] [--reduced-motion] [--gpu auto|gpu|swiftshader] [--full-page] [--headed]',
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument ${k}`);
    }
  }
  if (!a.url || !a.out) fail("--url and --out are required");
  if (!["auto", "gpu", "swiftshader"].includes(a.gpu)) fail("--gpu must be auto|gpu|swiftshader");
  for (const n of ["wait", "after", "width", "height", "timeout"]) {
    if (!Number.isFinite(a[n]) || a[n] < 0) fail(`--${n} must be a non-negative number`);
  }
  return a;
}

function fail(msg) {
  console.error(`[shot] error: ${msg}`);
  process.exit(2);
}

const BASE_ARGS = ["--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio"];
const GPU_ARGS = ["--use-angle=d3d11", "--use-gl=angle", "--ignore-gpu-blocklist", "--enable-gpu", "--enable-webgl"];
const SWIFTSHADER_ARGS = ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--enable-webgl"];

async function probeWebGL2(page) {
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return { webgl2: false, renderer: null, vendor: null };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { webgl2: true, renderer: String(renderer), vendor: String(vendor) };
  });
}

async function launch(mode, args) {
  const flags = [...BASE_ARGS, ...(mode === "gpu" ? GPU_ARGS : SWIFTSHADER_ARGS)];
  // channel "chromium" = full Chromium in new headless mode (the headless-shell build has weaker GPU support).
  let browser;
  try {
    browser = await chromium.launch({ channel: "chromium", headless: !args.headed, args: flags });
  } catch (e) {
    if (!args.quiet)
      console.log(`[shot] channel "chromium" launch failed (${e.message.split("\n")[0]}); retrying default`);
    browser = await chromium.launch({ headless: !args.headed, args: flags });
  }
  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
    reducedMotion: args.reducedMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const probe = await probeWebGL2(page);
  return { browser, context, page, probe, mode };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });

  let session = null;
  const order = args.gpu === "auto" ? ["gpu", "swiftshader"] : [args.gpu];
  for (const mode of order) {
    const s = await launch(mode, args);
    const software = s.probe.renderer ? /swiftshader|llvmpipe|software|basic render/i.test(s.probe.renderer) : true;
    if (s.probe.webgl2 && (mode === "swiftshader" || !software || order.length === 1)) {
      session = s;
      break;
    }
    if (!args.quiet)
      console.log(`[shot] ${mode}: webgl2=${s.probe.webgl2} renderer=${s.probe.renderer}; trying next mode`);
    if (mode === order[order.length - 1] && s.probe.webgl2) {
      session = s;
      break;
    }
    await s.browser.close();
  }
  if (!session) {
    console.log("[shot] FATAL: no WebGL2 context available in any mode");
    process.exit(3);
  }
  const { browser, page, probe } = session;
  const isSoftware = /swiftshader|llvmpipe|software/i.test(probe.renderer ?? "");
  console.log(
    `[shot] webgl2=${probe.webgl2} backend=${isSoftware ? "SWIFTSHADER" : "GPU"} renderer="${probe.renderer}" vendor="${probe.vendor}"`,
  );

  const counts = { consoleErrors: 0, consoleWarnings: 0, pageErrors: 0, failedRequests: 0 };
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error") counts.consoleErrors++;
    else if (t === "warning") counts.consoleWarnings++;
    if (t === "error" || t === "warning" || (!args.quiet && t !== "debug")) {
      const loc = msg.location();
      const where = loc?.url ? ` (${loc.url}:${loc.lineNumber ?? 0})` : "";
      console.log(`[console.${t}] ${msg.text()}${t === "error" ? where : ""}`);
    }
  });
  page.on("pageerror", (err) => {
    counts.pageErrors++;
    console.log(`[pageerror] ${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ""}`);
  });
  page.on("requestfailed", (req) => {
    counts.failedRequests++;
    console.log(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "unknown"}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) console.log(`[http ${res.status()}] ${res.url()}`);
  });

  let exitCode = 0;
  let evalResult;
  try {
    await page.goto(args.url, { waitUntil: "load", timeout: args.timeout });
    if (args.wait > 0) await page.waitForTimeout(args.wait);
    if (args.eval) {
      evalResult = await page.evaluate(args.eval);
      if (evalResult !== undefined) console.log(`[eval] ${safeJson(evalResult)}`);
      if (args.after > 0) await page.waitForTimeout(args.after);
    }
    await page.screenshot({ path: out, fullPage: args.fullPage });
    console.log(`[shot] wrote ${out}`);
  } catch (e) {
    exitCode = 1;
    console.log(`[shot] FAILED: ${e.message}`);
  }
  console.log(
    `[shot] summary ${JSON.stringify({ ok: exitCode === 0, out, backend: isSoftware ? "SWIFTSHADER" : "GPU", renderer: probe.renderer, ...counts })}`,
  );
  await browser.close();
  process.exit(exitCode);
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

main().catch((e) => {
  console.log(`[shot] FATAL: ${e.stack ?? e}`);
  process.exit(1);
});
