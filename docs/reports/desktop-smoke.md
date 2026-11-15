# Desktop smoke test — packaged Tauri app in the real WebView2 (agent X)

Run 2026-11-15, 22:20–22:45 local, on the dev laptop. Everything below was observed in the **packaged release exe**
(`pnpm desktop:build` → `packages/app-shell/src-tauri/target/release/blindrev.exe`, 63.7 MB, unsigned, `--no-bundle`),
driven over CDP by `tools/webview2-drive.mjs` (launch → `connectOverCDP` → scenario → screenshots + JSON → kill).
Raw JSON: `docs/reports/telemetry/webview2-{play,measure,offline,soak,measure2}.json`.

## Environment (measured)

| Item                 | Value                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| WebView2 runtime     | **157.0.4341.46** (Evergreen, `Edg/157.0.4341.46`, Chromium 157)                                              |
| App origin           | `http://tauri.localhost/` (Tauri v2 Windows default, `useHttpsScheme` off)                                    |
| WebGL                | WebGL2 ✓ — `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU (0x00002D18) Direct3D11 vs_5_0 ps_5_0, D3D11)`  |
| Display              | 1280×800 CSS px @ devicePixelRatio **2** (2560×1600 panel); refresh ≈ 165 Hz (rAF interval 6.1 ms)            |
| Window used for runs | `BLINDREV_WINDOW_SIZE=1920x1080` clamped by the shell to the work area → viewport **1260×760 CSS px** @ DPR 2 |
| Drawing buffers      | hub (Three.js) 2472×1491 px; globe (Cesium, browser-recommended resolution) 1260×760 px                       |
| Quality preset       | Medium (default settings, fresh profile)                                                                      |

1920×1080 CSS px cannot be shown on this 1280×800-CSS display. The hub therefore renders **more** pixels than 1080p
(3.69 MP vs 2.07 MP); the globe renders fewer (0.96 MP). Neither is a min-spec result.

## Game loop in the packaged app — verified

Scenario `play` (`node tools/webview2-drive.mjs --scenario play`), all steps passed. It ran on the build _before_ the
`'wasm-unsafe-eval'` fix (it is what surfaced the 5 WASM CompileErrors); the later `measure`, `measure2`, `offline` and
`soak` runs on the final exe had 0 page errors and only the harmless zod `eval` report:

| Step                                      | Result                                                                                                                                                                       | Screenshot                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Menu (Outfit wordmark + menu, plate)      | ✓ items `new, continue, settings, credits, quit` (Quit is Tauri-only and present)                                                                                            | `docs/reports/desktop-shots/01-menu.png`             |
| Hub, 3D                                   | ✓ `hub/three`, `hubMode 3d`, WebGL2 canvas, no fallback                                                                                                                      | `docs/reports/desktop-shots/02-hub.png`              |
| Travel hub → case (wipe + data tunnel)    | ✓ `menu→hub` 747 ms blankMs (cold), `hub→mission` 1521 ms (incl. 1.2 s tunnel)                                                                                               | —                                                    |
| Mission globe + briefing                  | ✓ `mission/cesium`, `sceneReady true`, terrain `ELLIPSOID` ("no ion token" INFO badge), imagery `ONLINE` (GIBS)                                                              | `docs/reports/desktop-shots/03-mission-briefing.png` |
| Watch (auto-play)                         | ✓ `PLAYING`, evidence rasters swap per step                                                                                                                                  | `docs/reports/desktop-shots/04-mission-watch.png`    |
| "No acquisition" step                     | ✓ `PAUSED_UNAVAILABLE` at s02 2026-02-05, amber card + timeline label, nothing drawn                                                                                         | `docs/reports/desktop-shots/05-no-acquisition.png`   |
| Date pair                                 | ✓ s01 → s09, Δt 288 d, `pairStatus ok`                                                                                                                                       | —                                                    |
| ROI                                       | ✓ via `__BLINDREV__.actions.setRoi(referencePolygon())`, `validateStatus ok`                                                                                                 | `docs/reports/desktop-shots/06-roi.png`              |
| Validate → verdict                        | ✓ PASS, IoU 0.799, P 1.000, R 0.799, QA coverage 74.1 %, digest `ffb9fab1…`                                                                                                  | `docs/reports/desktop-shots/07-verdict.png`          |
| Save to journal                           | ✓ `journalCount 1`                                                                                                                                                           | —                                                    |
| Back to hub                               | ✓ lifecycle created 3 / destroyed 2 / **maxLive 1**                                                                                                                          | `docs/reports/desktop-shots/08-hub-again.png`        |
| Menu → **Quit**                           | ✓ process exited with code 0, 0.23–0.89 s after the click, in 3 runs incl. the final exe (needed a new capability, see below)                                                | —                                                    |
| Offline mode (`?offline=1&route=mission`) | ✓ `imagery OFFLINE_BUNDLED`, OFFLINE badge, 25 bundled tiles `offline-tiles/bluemarble/*` 200 from `http://tauri.localhost/`, 0 GIBS requests, TLE refresh `skipped-offline` | `docs/reports/desktop-shots/09-offline-mission.png`  |

Asset checks in the packaged app (resource timing + `document.fonts`):

- **Fonts**: Outfit 600/800, IBM Plex Sans 400/600, IBM Plex Mono 400 all `loaded` from `/assets/*.woff2` (status 200);
  `document.fonts.check` true for all three families; no font errors. Body font `"IBM Plex Sans"`.
- **Audio**: 5 files (`ui-press`, `ui-confirm`, `scan-ping`, `travel-shutter`, ambient loop) loaded from `/audio/` (200).
- **Mission rasters**: 36 `mission-data/sinking-city/*` requests, all 200 from the custom origin (relative URLs resolved
  against `document.baseURI = http://tauri.localhost/`).
- **Cesium static files**: `cesium/Workers/*` (28 requests), `cesium/Assets/*` (3) all 200.
- **Cesium web workers work under `worker-src 'self' blob:`**: 8 dedicated workers started from
  `http://tauri.localhost/cesium/Workers/` (`createGeometry`, `transferTypedArrayTest`, `createVerticesFromHeightmap`,
  `incrementallyBuildTerrainPicker`, `combineGeometry`); terrain tiles meshed (globe drawn, `sceneReady true`), no worker
  errors, no `worker-src` violations.
- **Online NASA GIBS**: 74 `gibs.earthdata.nasa.gov/wmts/...BlueMarble_ShadedRelief_Bathymetry...` tiles, all 200,
  no `img-src`/`connect-src` violations.
- **CelesTrak TLE refresh**: **degraded to the snapshot** — `https://celestrak.org/NORAD/elements/gp.php?CATNR=65053&FORMAT=TLE`
  returned **HTTP 403** (`refreshLog: http-error "HTTP 403"`; HUD keeps `TLE 8.0 h`, source `snapshot`, not stale).
  Not a CSP/CORS problem: the request was allowed by `connect-src` and reached the server; a plain `curl` from this
  machine at the same time also got `403 - Forbidden: Access is denied` (IIS page). CelesTrak blocks clients that
  re-download unchanged GP data too often; this IP fetched it repeatedly today. Evidence: the first `play` run
  (22:24, build without the WASM fix) logged `refreshLog [{outcome:"http-error", detail:"HTTP 403"}]` plus the 403
  response; that JSON was overwritten by the final-exe re-run (22:42), where the app correctly **skipped** the refresh
  (`skipped-cache-fresh`, 2 h minimum) — so did a fresh-profile run (`webview2-play-fresh-profile.json`; its one
  attempt happened before the driver's reload). curl re-check 20:43Z: `docs/reports/telemetry/celestrak-curl-check.txt`
  (HTTP 403). Whether the refresh succeeds from WebView2 on a non-throttled IP is **NOT MEASURED**.
- **Cesium ion / World Terrain**: no ion token in this build → `EllipsoidTerrainProvider` + INFO badge. The World Terrain
  path (ion endpoint, quantized-mesh) is **NOT MEASURED**.

## CSP — findings and every change against the SPEC §13 baseline

SPEC §13 baseline: `default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:
https://assets.ion.cesium.com https://gibs.earthdata.nasa.gov; connect-src 'self' https://ion.cesium.com
https://assets.ion.cesium.com https://gibs.earthdata.nasa.gov https://celestrak.org; style-src 'self' 'unsafe-inline'`.

Shipped (`packages/app-shell/src-tauri/tauri.conf.json`):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
img-src 'self' data: blob: https://assets.ion.cesium.com https://gibs.earthdata.nasa.gov;
connect-src 'self' ipc: http://ipc.localhost https://api.cesium.com https://ion.cesium.com https://assets.ion.cesium.com
            https://gibs.earthdata.nasa.gov https://celestrak.org;
style-src 'self' 'unsafe-inline'
```
plus `dangerousDisableAssetCspModification: ["style-src"]` (Tauri appends hashes to `script-src` only).

| Addition                                | By                         | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Tested                                                                                                         |
| --------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `connect-src ipc: http://ipc.localhost` | S                          | Tauri v2 IPC transport (WebView2 uses `http://ipc.localhost`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✓ Quit (`window.close` over IPC) works                                                                         |
| `script-src 'wasm-unsafe-eval'`         | **X**                      | Measured: without it, loading the globe chunk raised **5 unhandled `CompileError: WebAssembly.instantiate() … violates … script-src`** page errors (and 5 `wasm-eval` `securitypolicyviolation` events). Source: the meshoptimizer encoder/decoder/simplifier modules that Cesium 1.147 bundles compile **inline** WebAssembly at module evaluation (`WebAssembly.instantiate(new Uint8Array([...]))` in `assets/src-*.js`). The globe still drew without it, but any `EXT_meshopt_compression` glTF / 3D Tiles content would fail. `'wasm-unsafe-eval'` permits only WebAssembly compilation — JS `eval` / `new Function` stay blocked. | ✓ after the change: 0 page errors, 0 `wasm-eval` violations (`webview2-measure.json`, `webview2-offline.json`) |
| `connect-src https://api.cesium.com`    | **X** (orchestrator audit) | CesiumJS calls `https://api.cesium.com/v1/assets/<id>/endpoint` first (Ion.js) whenever an ion token is set; with only `ion.cesium.com` + `assets.ion.cesium.com` World Terrain could never load in the packaged app.                                                                                                                                                                                                                                                                                                                                                                                                                    | Config only — **NOT MEASURED** (no ion token on this machine)                                                  |

Remaining, harmless violation (kept blocked on purpose): one `script-src` **`eval`** report per page load from
`assets/src-*.js:1` — zod 4's JIT probe (`new Function("")` inside try/catch). Zod falls back to its non-JIT
validator; all bundled data validated. Not adding `'unsafe-eval'`.

Not needed (verified): `data:` in `connect-src`; `font-src` (fonts are `'self'` files); `media-src` (audio is `'self'`);
`blob:` workers (Cesium loaded same-origin worker URLs). No inline `<script>` blocked (Tauri's hashes cover its init scripts).

## Window / capability changes

- `capabilities/default.json`: **`core:window:allow-close`** added. `core:default` → `core:window:default` contains only
  read-only window permissions, so the menu's Quit (`getCurrentWindow().close()`) was rejected. Verified: Quit exits
  the process (code 0, ~0.2 s).
- `tauri.conf.json` window: **`"zoomHotkeysEnabled": true`** (Tauri default is off → WebView2 `IsZoomControlEnabled`
  false → Ctrl+Plus/Minus did nothing; needed for the 200 % text-zoom accessibility check). Verified in the running exe
  with **real keyboard input** (Windows Script Host `SendKeys`, not CDP): Ctrl+= → DPR 2.0 → 2.2 → 2.5 (110 %, 125 %),
  Ctrl+0 → 2.0. CDP-synthesised key events do **not** reach WebView2's browser accelerators (expected).
- `src/lib.rs`: opt-in measurement hook `BLINDREV_WINDOW_SIZE=WxH` (logical px, clamped to the monitor work area);
  no effect when unset.

## Not verified / open

- Signed NSIS installer, SmartScreen, updater: not built here (see `packaging.md`).
- CelesTrak success path inside WebView2 (403 from this IP), ion World Terrain (no token).
- HUD layout at 1260×760: the mission top bar overlaps the case-title plate ("NISAR L-S…" clipped) and the
  SIMULATED badge sits under the locked tool icons (`04-mission-watch.png`) — reported to F (UI owner), not changed here.
- Min-spec GPUs (GTX 1650 / RX 6400 / Iris Xe / RTX 3050): not available.
