# Manual GPU checklist (SPEC §12, §14)

CI cannot measure GPU frame times or GPU memory. This checklist is the record. Run it on real Windows 10/11 machines with an up-to-date WebView2 runtime. Fill one results table per machine. Leave a cell as `NOT MEASURED` (with the reason) rather than guessing.

## Targets

From SPEC §12 and `data/prefabs/quality.json`:

| Preset | tileCacheSize | maximumScreenSpaceError | renderScale | 4K  | Target machine                              | Frame-time target                   |
| ------ | ------------- | ----------------------- | ----------- | --- | ------------------------------------------- | ----------------------------------- |
| Low    | 100           | 4                       | 0.75        | no  | Intel Iris Xe (integrated minimum)          | p95 ≤ 33 ms at 1080p (30 FPS floor) |
| Medium | 200           | 2                       | 1.0         | no  | GTX 1650 4 GB or RX 6400 (discrete minimum) | p95 ≤ 16.6 ms at 1080p (60 FPS)     |
| High   | 400           | 1.5                     | 1.0         | yes | RTX 3050-class                              | p95 ≤ 16.6 ms at 4K                 |

Other §12 gates that this checklist records on each machine:

| Gate                       | Pass                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Route-switch visible blank | p95 ≤ 500 ms, with the progress HUD shown while held                                                        |
| Context loss               | 10 × `WEBGL_lose_context`, 0 unrecovered, each recovery ≤ 5 s                                               |
| Soak                       | 30 min, JS heap snapshot every 60 s, peak − baseline ≤ 200 MB, no 5 consecutive rises after a 5-min warm-up |
| GPU process memory         | Record only (no numeric gate in the SPEC). Use Task Manager.                                                |

## Machine matrix

| ID  | GPU class                 | Example                              | Preset to test | Resolution  |
| --- | ------------------------- | ------------------------------------ | -------------- | ----------- |
| M1  | Discrete minimum (NVIDIA) | GeForce GTX 1650 4 GB                | Medium         | 1920 × 1080 |
| M2  | Discrete minimum (AMD)    | Radeon RX 6400                       | Medium         | 1920 × 1080 |
| M3  | Integrated minimum        | Intel Iris Xe (11th–13th gen Core)   | Low            | 1920 × 1080 |
| M4  | 4K tier                   | GeForce RTX 3050 (desktop or laptop) | High           | 3840 × 2160 |

Also run Low on M1 / M2 and Medium on M3 if time allows; those rows are informative, not gates.

## Setup (once per machine)

1. Install the same build on every machine. Preferred: a **debug shell with the production web bundle**, because release builds of Tauri do not open devtools and the harness is driven from the console:

   ```
   pnpm install
   pnpm --filter @blindrev/app-shell tauri build --debug --no-bundle
   ```

   The exe is `packages\app-shell\src-tauri\target\debug\blindrev.exe`. `tauri build` runs `pnpm exec vite build` first, so the page is the production bundle with the production CSP. (Agent W did not run this command; see `docs/security/threat-model-csp-cors.md` §4.)
2. Record: Windows version, GPU, driver version, WebView2 runtime version (`edge://version` is not available inside the app; use Settings → Apps → "Microsoft Edge WebView2 Runtime", or `navigator.userAgent` in the devtools console), display resolution and scaling, power plan (use "Best performance" and keep laptops on mains power).
3. Close other GPU-heavy programs. Turn off frame-rate overlays and recording tools.
4. Laptops with two GPUs: in Windows Settings → System → Display → Graphics, set `blindrev.exe` to the GPU under test. Confirm it in step 6 below.

## Opening the harness

1. Start `blindrev.exe`. Right-click anywhere → **Inspect** opens the WebView2 devtools (debug builds only).
2. In the console, reload with the harness drawer and a direct route:

   ```js
   location.href = location.origin + "/?harness=1&route=mission"
   ```

   URL flags read by `packages/app-shell/src/env.ts`:

   | Flag                               | Effect                                                                                     |
   | ---------------------------------- | ------------------------------------------------------------------------------------------ |
   | `?harness=1`                       | Shows the diagnostics drawer (frames ▶ / ■, ctx-loss ×10, soak 1 min, export).             |
   | `?route=hub` or `?route=mission`   | Jumps straight to that route after start-up.                                               |
   | `?soak=<minutes>`                  | Starts the heap soak and the frame sampler at start-up.                                    |
   | `?hub=2d`                          | Uses the static 2D command board instead of the 3D hub (A1 kill fallback).                 |
   | `?stub=1`                          | Replaces both renderers with deterministic Canvas2D stubs. **Do not use for GPU numbers.** |
   | `?offline=1`                       | Never touches the network (bundled imagery, ellipsoid terrain, snapshot TLE).              |
   | `?motion=reduced` / `?motion=full` | Overrides reduced motion for the session.                                                  |

   The window must not be resized during a measurement. The app enforces a 1280 × 720 minimum; for 1080p and 4K runs, maximise the window on a display of that resolution and record the actual `innerWidth × innerHeight` and `devicePixelRatio` (they are in the exported telemetry under `viewport`).
3. Confirm the GPU in the console:

   ```js
   const gl = document.createElement("canvas").getContext("webgl2");
   const ext = gl.getExtension("WEBGL_debug_renderer_info");
   gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
   ```

   Record the string. If it names "SwiftShader" or "Microsoft Basic Render Driver", stop: the GPU is not being used.
4. Choose the preset in **Settings** → **Quality** → Low / Medium / High. Settings opens from the main menu or from the command board (hub); the mission screen has no Settings button. The panel shows the active values (`tile cache … · max SSE … · render scale …`). The preset is read when a renderer is created (`scene/sceneManager.ts`; the app never calls `setQuality` on a live renderer), so after changing it switch route (hub → mission) before measuring. The setting is saved, so it survives a reload.

## Measurements

The harness is `window.__BLINDREV__` (`packages/app-shell/src/harness/harness.ts`). All calls below are typed into the devtools console.

### A. Frame time, per preset

1. Go to the mission (`?route=mission`), close the briefing, and let the globe settle for 30 s at the AOI view.
2. Steady view:

   ```js
   await __BLINDREV__.perf.frames.sample(60000)
   ```

   Returns `{ count, p50Ms, p95Ms, meanFps, route }` from a `requestAnimationFrame` sampler.
3. Moving view: call `__BLINDREV__.perf.frames.start()`, then fly for 60 s with the keyboard (W A S D pan, Z / X zoom, Q / E rotate, R / F tilt) across the AOI and out to the home view and back, then `__BLINDREV__.perf.frames.stop()`.
4. Temporal watch: `__BLINDREV__.perf.frames.start()`, press Play on the timeline and let it run through all steps, then `stop()`.
5. Repeat 2–4 in the hub (`__BLINDREV__.actions.goTo("hub")`, then `await __BLINDREV__.actions.waitIdle()`).

### B. Route switch blank time

Do at least 10 switches, then read the p95:

```js
for (let i = 0; i < 5; i++) {
  await __BLINDREV__.actions.goTo("hub");
  await __BLINDREV__.actions.waitIdle();
  await __BLINDREV__.actions.goTo("mission");
  await __BLINDREV__.actions.waitIdle();
}
__BLINDREV__.perf.routeBlankP95();
```

Also note by eye whether the progress HUD ("Preparing your expedition") appears whenever the wipe holds.

### C. Context loss

On the mission route, then again on the hub route:

```js
await __BLINDREV__.perf.contextLossCycles(10);
```

Returns `{ cycles, unrecovered, recoveryMs, p95RecoveryMs, maxRecoveryMs, scene, status }`. `status` is `PASS` only if all 10 recovered within 5 s each.

### D. Soak (30 min)

Start from a fresh launch with `location.href = location.origin + "/?harness=1&soak=30"`, play normally (route switches, timeline, ROI drawing) for 30 minutes, then:

```js
__BLINDREV__.perf.soak.status();
```

The harness reports `NOT MEASURED` if `performance.memory` is unavailable, and adds a note if the run is shorter than 30 min.

### E. GPU process memory (Task Manager)

1. Open Task Manager → **Details** tab → right-click a column header → Select columns → tick **Dedicated GPU memory** and **Shared GPU memory**.
2. WebView2 runs as several `msedgewebview2.exe` processes. The GPU process is the one whose command line contains `--type=gpu-process` (add the **Command line** column to see it).
3. Read both columns: (a) at the menu, (b) after 2 min on the mission globe, (c) after 2 min in the hub, (d) at the end of the 30-min soak.
4. Optional: Performance tab → GPU → "Dedicated GPU memory usage" for the whole system at the same moments.

### F. Export

```js
__BLINDREV__.exportTelemetry();
```

Downloads `blindrev-telemetry-<timestamp>.json` (schema `blindrev.telemetry.v1`: frame stats, route-switch timings, soak verdict, context-loss result, user agent, viewport). Save it next to the results table as `docs/reports/gpu/<machine-id>-<preset>.json`.

## Results

Every cell starts as NOT MEASURED. Replace it only with a value from the harness or Task Manager.

### Machine details

| Field                                       | M1 (GTX 1650)             | M2 (RX 6400)              | M3 (Iris Xe)              | M4 (RTX 3050)             |
| ------------------------------------------- | ------------------------- | ------------------------- | ------------------------- | ------------------------- |
| Windows version                             | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet |
| GPU driver                                  | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet |
| WebView2 version                            | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet |
| `UNMASKED_RENDERER_WEBGL`                   | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet |
| Viewport (`innerWidth × innerHeight @ dpr`) | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet |
| Build (commit / date)                       | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet | NOT MEASURED — no run yet |

### Frame time (ms)

| Machine | Preset    | Scene                     | p50          | p95          | Mean FPS     | Target p95 | Pass?        |
| ------- | --------- | ------------------------- | ------------ | ------------ | ------------ | ---------- | ------------ |
| M1      | Medium    | Mission, steady           | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M1      | Medium    | Mission, moving           | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M1      | Medium    | Mission, timeline playing | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M1      | Medium    | Hub                       | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M2      | Medium    | Mission, steady           | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M2      | Medium    | Mission, moving           | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M2      | Medium    | Mission, timeline playing | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M2      | Medium    | Hub                       | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M3      | Low       | Mission, steady           | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 33       | NOT MEASURED |
| M3      | Low       | Mission, moving           | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 33       | NOT MEASURED |
| M3      | Low       | Mission, timeline playing | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 33       | NOT MEASURED |
| M3      | Low       | Hub                       | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 33       | NOT MEASURED |
| M4      | High (4K) | Mission, steady           | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M4      | High (4K) | Mission, moving           | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M4      | High (4K) | Mission, timeline playing | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |
| M4      | High (4K) | Hub                       | NOT MEASURED | NOT MEASURED | NOT MEASURED | ≤ 16.6     | NOT MEASURED |

### Route switch, context loss, soak

| Machine | Route blank p95 (ms) | Progress HUD seen when held? | Ctx-loss mission: unrecovered / max recovery (ms) | Ctx-loss hub: unrecovered / max recovery (ms) | Soak Δheap (MB) | Soak max consecutive rise | Soak verdict |
| ------- | -------------------- | ---------------------------- | ------------------------------------------------- | --------------------------------------------- | --------------- | ------------------------- | ------------ |
| M1      | NOT MEASURED         | NOT MEASURED                 | NOT MEASURED                                      | NOT MEASURED                                  | NOT MEASURED    | NOT MEASURED              | NOT MEASURED |
| M2      | NOT MEASURED         | NOT MEASURED                 | NOT MEASURED                                      | NOT MEASURED                                  | NOT MEASURED    | NOT MEASURED              | NOT MEASURED |
| M3      | NOT MEASURED         | NOT MEASURED                 | NOT MEASURED                                      | NOT MEASURED                                  | NOT MEASURED    | NOT MEASURED              | NOT MEASURED |
| M4      | NOT MEASURED         | NOT MEASURED                 | NOT MEASURED                                      | NOT MEASURED                                  | NOT MEASURED    | NOT MEASURED              | NOT MEASURED |

### GPU process memory (Task Manager, MB)

| Machine | Menu: dedicated / shared | Mission (2 min): dedicated / shared | Hub (2 min): dedicated / shared | End of soak: dedicated / shared |
| ------- | ------------------------ | ----------------------------------- | ------------------------------- | ------------------------------- |
| M1      | NOT MEASURED             | NOT MEASURED                        | NOT MEASURED                    | NOT MEASURED                    |
| M2      | NOT MEASURED             | NOT MEASURED                        | NOT MEASURED                    | NOT MEASURED                    |
| M3      | NOT MEASURED             | NOT MEASURED                        | NOT MEASURED                    | NOT MEASURED                    |
| M4      | NOT MEASURED             | NOT MEASURED                        | NOT MEASURED                    | NOT MEASURED                    |

### Notes per run

Write anything unusual here: thermal throttling, driver crashes, visual artefacts (z-fighting, flicker, missing tiles), console errors.

| Machine | Preset | Note |
| ------- | ------ | ---- |
| —       | —      | —    |

## Development machine (reference only, not a min-spec result)

Agent S recorded that headless Chromium on the development machine reports `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU … Direct3D11)` (`docs/decisions/S.md`). That machine is far above min-spec. Numbers from it do not satisfy any row above. Where other agents measured on it, their figures are in `docs/reports/` and indexed in `docs/reports/README.md`.
