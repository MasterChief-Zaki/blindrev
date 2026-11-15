# Decisions — agent X (desktop package + WebView2 measurements)

## Build

- `pnpm desktop:build` (vite build + `cargo build --release` of `blindrev`, `--no-bundle`) succeeded first time; warm
  rebuilds after config changes take ~30–40 s. Exe: `packages/app-shell/src-tauri/target/release/blindrev.exe`,
  66,766,848 bytes (63.7 MB, final build 22:26), unsigned. `cargo fmt --check` and
  `cargo clippy --release --locked -- -D warnings` clean after my Rust change. NSIS bundle not built (PowerShell hang risk; CI does it).
- The exe embeds `packages/app-shell/dist` at build time — F's UI polish pass was in progress, so the frontend inside the
  exe is whatever F had on disk at ~22:26. Rebuild before shipping. The `play` run used the build before the
  `'wasm-unsafe-eval'` change; measure/measure2/offline/soak used the final exe.

## Fixes (all inside `packages/app-shell/src-tauri/**`; no frontend change was needed)

- `capabilities/default.json`: + `core:window:allow-close` — menu Quit was denied (`core:window:default` is read-only).
- `tauri.conf.json` CSP: + `'wasm-unsafe-eval'` in `script-src` (Cesium 1.147's bundled meshoptimizer modules compile
  inline WASM at import → 5 unhandled CompileErrors per globe load without it); + `https://api.cesium.com` in
  `connect-src` (Ion.js asset-endpoint call; orchestrator audit — untested, no token). Details + baseline diff:
  `docs/reports/desktop-smoke.md`.
- `tauri.conf.json` window: `"zoomHotkeysEnabled": true` (Ctrl+= / Ctrl+- / Ctrl+0 text zoom; verified with real key
  input via Windows Script Host SendKeys).
- `src/lib.rs`: `BLINDREV_WINDOW_SIZE=WxH` opt-in measurement hook (logical inner size, clamped to the monitor work
  area, then centred). Unset = config size. Chosen over a permanent 1920×1080 window (would not fit most laptops) and
  over `core:window:allow-set-size` (would widen the frontend's capabilities just for a test).

## Tooling

- `tools/webview2-drive.mjs` — reusable driver: scenarios `play | measure | soak | offline`; WebView2 started with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p> --enable-precise-memory-info` (Chromium buckets
  `performance.memory` and refreshes it only every 20 min otherwise — a soak would read flat lines) and optional
  `WEBVIEW2_USER_DATA_FOLDER` (second instance with different browser args must not share the default UDF).
  The page is reloaded after connecting so console / page errors / failed requests / CSP violations are captured
  from first paint. Kills its own process tree (`taskkill /PID … /T /F`), never `/IM`.
- Route-switch decomposition: the driver records a per-rAF trace of `[data-testid=wipe]` phase, `wipe-hud` and
  `data-tunnel` presence, and derives per switch: total, cover, HUD-visible, tunnel-visible, reveal, and **true blank**
  (frames after cover-complete with neither HUD nor tunnel, plus frames between HUD removal and reveal start).
  Frame-quantised (±1 rAF ≈ 6 ms at 165 Hz). The harness `blankMs` (cover-complete → first frame after ready,
  including the tunnel minimum) is reported alongside.
- Soak: harness `perf.soak.start(8, 30)` + an independent CDP `Runtime.getHeapUsage` / `Performance.getMetrics` sample
  every 30 s; auto-play kept running (re-armed every second when it stops at the last step); one hub round trip
  per minute. Ran in a second exe instance (own UDF, port 9334) so other checks could proceed.

## Findings worth knowing

- CelesTrak returned HTTP 403 to WebView2 **and** to curl from this machine (IP throttled after repeated same-data
  downloads today) → app correctly stayed on the snapshot. Success path in WebView2 NOT MEASURED.
- True blank on route switches is 0 frames: the cover panel becomes the progress HUD in the same frame the cover
  completes, and the reveal starts in the frame the HUD leaves. The 1.2 s tunnel minimum dominates the hub→mission
  total; the main thread does stall during renderer construction (max hold-frame gap up to ~160 ms — HUD frozen, not
  blank).
- One unexplained `hub → menu` route change (17.5 ms, harness-recorded) happened during the first run's 20 s hub frame
  sample — no script action or key press caused it; possibly a physical click on the visible window. That hub frame
  sample was discarded and re-run (`webview2-measure2.json`).

## Unfinished

- 30-min soak (shortened to 8 min), min-spec GPUs, signed installer, ion World Terrain, CelesTrak success path.
- Launcher fallback branch (no exe → dev server) not re-run: the exe was present and locked by the running soak; S's
  dry-run stands. The exe branch was verified (`cmd /c START_BLINDREV.cmd` → `blindrev.exe` PID with window title
  "BlindRev", launcher exit 0, then killed by PID).

STATUS: DONE
