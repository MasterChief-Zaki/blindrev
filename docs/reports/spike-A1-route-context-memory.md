# Spike A1 — context / route / memory, measured in the packaged app (real WebView2)

Agent X, 2026-11-15. Target: SPEC §2 gate A1. All numbers come from the **packaged release exe** (Tauri v2,
`blindrev.exe`) in **WebView2 157.0.4341.46**, driven by `tools/webview2-drive.mjs` over CDP, using the app's
`window.__BLINDREV__` harness. Raw data: `docs/reports/telemetry/webview2-measure.json` (run 1),
`webview2-measure2.json` (run 2), `webview2-soak.json`.

**Machine (not min-spec):** RTX 5070 Laptop GPU — `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU (0x00002D18)
Direct3D11 vs_5_0 ps_5_0, D3D11)`. Display 1280×800 CSS px @ DPR 2, ~165 Hz. Window requested 1920×1080 and clamped
by the shell to the work area → **viewport 1260×760 CSS px @ DPR 2**. Drawing buffers: hub 2472×1491 px (3.69 MP,
more than 1080p's 2.07 MP); globe 1260×760 px (Cesium renders at CSS resolution, 0.96 MP). Preset Medium.

## Verdict per criterion

| A1 criterion                                                                                   | Measured (this machine)                                                                                                                                                                                    | Gate                        | Result                                                                                            | Fallback if missed                                                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ≥ 60 FPS steady @ 1080p                                                                        | Hub: p50 6.1 ms / p95 6.2 ms, 165.0 FPS mean (3 300 frames, 20 s, run 2). Globe: p50 6.1 / p95 6.2 ms, 165.0 FPS (3 300 frames, 20 s). vsync-locked at the panel's 165 Hz.                                 | ≥ 60 FPS (p95 ≤ 16.6 ms)    | **PASS on this GPU** at 1260×760 CSS / DPR 2 (not exactly 1080p). Min-spec GPUs: **NOT MEASURED** | 3D hub → static 2D command board (`?hub=2d`, exists)                                                          |
| 0 unrecovered context losses over 10 forced cycles                                             | Globe: 0/10 unrecovered, recovery 87–132 ms (max 132 run 1, 109 run 2). Hub: 0/10 unrecovered, 277–365 ms (max 365 run 1, 316 run 2). Globe status after the cycles: `contextLost false, sceneReady true`. | 0 unrecovered, each ≤ 5 s   | **PASS** (both renderers, both runs)                                                              | —                                                                                                             |
| Single live canvas                                                                             | 22 renderers created / 21 destroyed across 23 route switches, **maxLive 1** (run 1); run 2: 22 / 21 over 22 switches, maxLive 1; play loop maxLive 1                                                       | 1                           | **PASS**                                                                                          | —                                                                                                             |
| Route-switch visible blank p95 ≤ 500 ms with progress HUD                                      | **True blank p95 = 0 ms** (frame-quantised, ±1 rAF ≈ 6 ms) over 40 switches (2 runs × 10 hub→mission + 10 mission→hub). Harness `blankMs` p95 (which counts the tunnel/HUD hold) = 1 211 ms.               | ≤ 500 ms                    | **PASS on true blank time**; the total switch takes 1.3–2.2 s (see below)                         | warm-viewer retention — **not implemented** (not needed by the true-blank number; would shorten the HUD hold) |
| 30-min soak, 60 s snapshots: peak−baseline ≤ 200 MB, no 5-consecutive rise after 5-min warm-up | Shortened soak: 8 min, 30 s snapshots, globe auto-playing + one hub round trip per minute. Δ 27.6 MB (harness) / 30.0 MB (CDP); max consecutive rise 3.                                                    | 30 min, ≤ 200 MB, < 5 rises | **NOT MEASURED (shortened to 8 min)**; shortened data passes the rule                             | —                                                                                                             |

## Route switching — three numbers per direction (run 2; run 1 in brackets)

Definitions (from a per-frame trace of the wipe overlay, not just the harness):
_total_ = first covering frame → wipe idle; _HUD visible_ = progress HUD and/or data tunnel on screen (the deliberate
loading screen — **not blank**); _true blank_ = Ink-only frames after cover-complete before the HUD appears, plus
Ink-only frames between the HUD leaving and the reveal starting. The 500 ms cover and 500 ms reveal are the SPEC wipe.

| Direction (n = 10 each) | Total p50 / p95                  | Cover  | HUD visible p50 / p95            | of which tunnel              | True blank p95 | Renderer ready p50 / p95 | Harness blankMs p95 |
| ----------------------- | -------------------------------- | ------ | -------------------------------- | ---------------------------- | -------------- | ------------------------ | ------------------- |
| hub → mission           | 2 212 / 2 218 ms [2 212 / 2 218] | 503 ms | 1 206 / 1 212 ms [1 206 / 1 224] | 1 200 ms (the 1.2 s minimum) | **0 ms** [0]   | 275 / 307 ms [358 / 460] | 1 212 ms [1 212]    |
| mission → hub           | 1 261 / 1 449 ms [1 309 / 1 436] | 503 ms | 249 / 442 ms [297 / 424]         | —                            | **0 ms** [0]   | 247 / 433 ms [295 / 410] | 447 ms [429]        |

- hub → mission: the hold is set entirely by the data tunnel's **deliberate 1.2 s minimum** — Cesium is ready after
  ~0.25–0.46 s, so without the tunnel minimum the HUD hold would be ≈ the renderer-ready time (p95 ≤ 460 ms in both runs).
- Cold first loads (not in the 10×-switch stats): menu → hub ready 575 ms / 489 ms (run 1 / run 2);
  menu → mission ready 721 ms (run 1); first hub → mission ready 605 ms (run 2). The HUD covers these too (true blank 0).
- The main thread stalls while a renderer is constructed: longest frame gap during the hold p95 = 91 ms (run 2),
  158 ms max (run 1). The HUD is on screen but its spinner freezes for that long — not blank, but visible jank.
- Why true blank is 0: `WipeOverlay` renders the HUD in the same React commit that sets `phase = covered`, so the frame
  that completes the cover already shows the HUD; the reveal starts in the frame the HUD leaves.
- **≤ 500 ms gate: met on true blank time.** Stated plainly next to it: a full hub → mission journey takes ~2.2 s
  (0.5 s wipe in + 1.2 s tunnel + 0.5 s wipe out) and mission → hub ~1.3 s. Warm-viewer retention (the documented
  fallback) was **not implemented**.

## Context loss (WEBGL_lose_context, `perf.contextLossCycles(10)`)

| Renderer       | Run | Unrecovered | Recovery times (ms)                     | Max    | Gate |
| -------------- | --- | ----------- | --------------------------------------- | ------ | ---- |
| Globe (Cesium) | 1   | 0           | 108 114 110 108 118 114 110 99 115 132  | 132 ms | PASS |
| Globe (Cesium) | 2   | 0           | 106 109 94 108 104 94 98 91 93 87       | 109 ms | PASS |
| Hub (Three.js) | 1   | 0           | 292 311 297 348 300 333 365 306 352 314 | 365 ms | PASS |
| Hub (Three.js) | 2   | 0           | 290 277 284 284 289 287 306 293 302 316 | 316 ms | PASS |

Recovery = `forceContextLoss()` → `contextRestored` event (restore requested after 50 ms). Screenshots after the cycles:
`docs/reports/desktop-shots/measure2-mission-after-ctxloss.png`, `measure2-hub-after-ctxloss.png`.

## Memory soak — shortened

- Run: second exe instance (own WebView2 user-data folder, CDP 9334), `--enable-precise-memory-info` (without it
  Chromium buckets `performance.memory` and refreshes it only every 20 min). Mission globe, auto-play re-armed whenever
  it stopped at the last step, hub round trip at t = 61, 120, 181, 241, 300, 361, 420 s (each ~5 s). 8 min, 30 s
  snapshots. A short offline check and the launcher test ran in other instances during minute 0–1.
- Harness (`performance.memory.usedJSHeapSize`, 17 snapshots): baseline 37.4 MB, peak 65.0 MB, **Δ 27.6 MB**, max
  consecutive rise 3 (harness warm-up is 0 for runs < 10 min).
- Independent CDP `Runtime.getHeapUsage` (18 samples): baseline 32.1 MB, peak 62.1 MB (t = 361 s), **Δ 30.0 MB**, final
  44.4 MB; max consecutive rise 3 over the whole run and 3 over the 8 samples after a 5-min warm-up.
- Caution: the post-GC floor drifts up (≈ 28 MB at 91 s, 30 MB at 241 s, 39–41 MB at 390–420 s, 44 MB at the end) and
  DOM nodes go 656 → 814. Eight minutes cannot separate GC timing from a slow leak (~2 MB/min would be ~60 MB over 30
  min — still under 200 MB). The 30-minute run is needed.
- **30-min gate: NOT MEASURED (shortened to 8 min).** Frame timing during the soak: p50 6.1 / p95 6.2 ms (last 20 000
  frames). GPU-process memory: NOT MEASURED (Windows manual checklist item).

## Not measured

Min-spec GPUs (GTX 1650 / RX 6400 / Iris Xe / RTX 3050-class); exact 1920×1080 viewport (display too small); 30-min
soak; World Terrain (no ion token) — every number above is with ellipsoid terrain + GIBS imagery.
