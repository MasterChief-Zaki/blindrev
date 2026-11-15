# Decisions — agent F (app-shell, screens, integration)

## Defaults chosen

- Routes `menu → hub → mission`, overlays `briefing | journal | settings | credits | results | roi-editor` in one zustand store (`src/store.ts`). Settings + Case Journal persist in localStorage (`blindrev.settings.v1`, `blindrev.journal.v1`); TLE cache `blindrev.tle.v1`.
- Single live canvas: `src/scene/sceneManager.ts` owns one persistent `.scene-root`; each route gets a fresh host div. The outgoing renderer is `destroy()`ed while the wipe covers the screen, then the incoming one is created and awaited (`ready`, hard limit 20 s, then reveal anyway). The harness records `created / destroyed / maxLive` — every run so far: maxLive = 1.
- Fallbacks: globe import/creation/ready failure → Canvas2D fixture map (`src/dev/stubRenderers.ts`) with a `TEST_FIXTURE` badge; hub failure or `?hub=2d` → DOM/SVG 2D command board. `?stub=1` → both stubs (offline visual-CI fixture). `?offline=1` → no network (ion token dropped, TLE refresh skipped).
- URL flags: `?route=hub|mission`, `?briefing=1`, `?harness=1`, `?soak=<min>`, `?motion=reduced|full`, `?now=<iso>` (fixed clock; disables TLE refresh).
- Wipe: 500 ms from `constants.json`; hold state = ui-hud `WipeOverlay` loading screen with the owner plate (`public/art/outpost-plate.jpg`); "slow" label after `progressCapMs` (3 s). Reduced motion → instant cut, no tunnel, no auto-play.
- Play timer 1.2 s/step, owned by the UI, dispatches `TICK`. Under reduced motion Play = one `STEP_FORWARD` + announcement (no auto sweep).
- "No acquisition": centred amber state card when the current step is unavailable; a small chip when PLAYING skips one; assertive live-region announcement each time. Never interpolated.
- Validate gating: ROI closed + `validateRoi.ok` + both dates available + Δt ≥ `dtMinDays`; the button stays visible with the reason underneath when disabled.
- Scoring: `scoreRoi` with the reference MaskGrid + the QA grids of both chosen steps (chronological order), all fetched through `fetchMask` → `decodeMask` (sha-verified).
- Ground track: `nadirGroundTrack` ± one orbital period around now (period from TLE mean motion), 20 s step, recomputed every 10 min; current state pushed every 1 s.
- HUD-aware framing: the globe gets a copy of the manifest whose `camera.aoi` is pulled back ×2 (×2.6 on ≤ 820 px tall) and nudged south, so the AOI sits in the free area between the panels. The manifest file is untouched.
- Context imagery: Radar Vision switches the real context layer between optical (first date-independent optical base layer if D ships one, else the optical image of the current date) and the NISAR GCOV radar image of the current date. The SIMULATED displacement stays a separate overlay toggle (Layers tab).
- Anomaly Detector: unlocks when every available date has been viewed; threshold = min(|legend.thresholds|) = 30 mm on the current step's `.f32` (512², little-endian, NaN = invalid), 4-connected components ≥ max(6, W·H/20000) px, top 6 by |peak|×size; shown as `globe.setAnnotations` rings, in an "Anomalies" tab (label, lon/lat, peak, km², "you decide") and as an SVG overlay in the 2D editor. Decoys are whatever the data contains — the UI never says which is real.
- Evidence Connector = Case Journal, unlocked by the first verdict (or any saved entry). Frequency Switch / Terrain Scanner shown Locked — "Later case".
- Hub layout follows H's HUD-safe areas: brand + actions in the top 12 % band, the accessible case list in the left pillar band (x 0–12 %), mission card + compact NISAR panel in the bottom 20 % band; the four worlds (x 12–88 %, y 38–75 %) stay unobstructed at 16:9. Hub failure handling: `createHubRenderer` and `await ready` are both inside the fallback path (→ 2D board).
- Cases on the hub: 01 The Sinking City (playable), 02 The Green Kingdom, 03 The Drowned World, 04 The Frozen Frontier (locked).
- Briefing is a case file: CASE #001, location/dates/source, initial report, evidence list built from the manifest (acquisitions, gaps, QA masks, grouped context layers, NISAR track), sourced facts, every mission label explained in plain words, mission line.
- Quit is rendered only inside Tauri (no dead button in the browser build).
- Sound: ui-hud `initSound({ baseUrl: "audio/" })`; `travel` on every wipe, `scan` for the Anomaly Detector, `confirm` on a saved verdict / PASS, `alert` on No acquisition / FAIL / QA diagnostic; ambient loop on the hub only; gated by Settings.

## Deviations

- **Data tunnel minimum duration**: hub → case shows the Canvas2D tunnel for at least 1.2 s (max 2 s, any key / click skips). That minimum is counted inside the route-switch `blankMs` measurement, so the hub → mission switch can never be < 1.2 s. It is the progress HUD (§10), not an Ink-only blank.
- `vite-plugin-static-copy` v4 copied Cesium with its absolute pnpm path (`dist/cesium/node_modules/.pnpm/...`) and in dev served `index.html` for `/cesium/*`. Replaced by two tiny plugins in `vite.config.ts`: a dev middleware that serves `Build/Cesium/*` at `/cesium/*`, and a build step (`fs.cpSync`) that copies Workers/ThirdParty/Assets/Widgets to `dist/cesium/`. The dependency is still installed but no longer imported.
- `optimizeDeps.include` lists cesium/three/postprocessing/satellite.js/zod/zustand/react so the dev server does not re-optimise (and reload the page) on the first lazy `import()` of a renderer.
- `data/missions/_*.json` files are skipped by the loader (examples/fixtures, e.g. `_fixture-pending.example.json`).

## CelesTrak CORS result (for the §13 matrix)

- `curl -H "Origin: http://localhost:5173"` → `200`, `Access-Control-Allow-Origin: *`, `text/plain`.
- In-browser refresh from `http://localhost:5173` (dev) and `http://localhost:4173` (vite preview): outcome `ok` (TLE parsed, checksums valid, cached). So CORS allows it from any origin, including Tauri's custom origin — **not yet verified inside WebView2 / under the Tauri CSP** (needs `connect-src https://celestrak.org`).
- **Rate limit observed:** after ~8 automated runs from this IP within ~15 min, CelesTrak answered **HTTP 403** (its documented "same data more than once per 2 h" throttle). The app degraded correctly (outcome `http-error`, stayed on the snapshot), but the browser logs the 403 as a console error. Automated sessions (`navigator.webdriver`) now skip the refresh (`skipped-automation`).
- Policy: snapshot loads synchronously; refresh at most every 2 h (localStorage cache); any failure → snapshot only, logged in `__BLINDREV__.state().tle.refreshLog`.

## Measurements (headless Chromium 159, ANGLE D3D11, RTX 5070 Laptop; NOT the min-spec GPUs)

- Built app via `vite preview`, 1920×1080: route-switch blank menu→hub 0.76–1.26 s (first Three load + hub build), hub→mission 2.0–2.5 s (incl. 1.2 s tunnel minimum; Cesium ready ≈ 2.0 s), mission→hub 0.22–0.31 s. **Blank p95 > 500 ms on first loads → A1 route gate not met on cold switches**; warm switches are well under. Not measured on WebView2.
- Frame sampler on the mission globe (home view, idle): p50 6.1 ms / p95 6.2 ms (headless, vsync off — not a gate result).
- Forced context loss ×10: globe 0 unrecovered, max recovery 118 ms; hub 0 unrecovered, max 385 ms.
- Soak: harness implemented (`?soak=<min>`, 60 s snapshots, PASS/FAIL rule), **NOT MEASURED** (no 30-min run in this session).

## Fixes made in other packages

- None. All integration issues were solved inside app-shell.

## Polish pass (orchestrator review, 22:19–22:28)

- Hub: slim title top-left, actions top-right, one bottom band (y > 80 %): case line (CASE_001 · title · SIMULATED · one-sentence pitch · Open briefing), the accessible case list as a horizontal row of four chips, NISAR as one mono line + ephemeris badge. The 3D board (x 12–88 %, y 12–78 %) is unobstructed.
- Mission: tool rail docked in the top bar, one row (available tools icon + label; locked tools icon-only, reason in title + accessible name — via app CSS over the ui-hud ToolRail); step readout folded into the title block; Journal + Settings buttons in the top bar; side panels ≤ 340 px, collapsible with remembered state (`settings.panels`), collapsed by default below 1600 px wide, with a mini card (next step, Mark, 2D editor, Validate) so the loop works collapsed; timeline compacted to ≈ 200 px (1080p) by app-level CSS (no per-step sensor line, compact flags/pair bar; A/B buttons kept for every step to keep the E2E testids and a pointer target per step). AOI camera re-framed (×1.6 / ×1.9 compact, nudged south).
- Globe credit = one line (Cesium ion logo + "Data attribution" link), centred, never clipped. Full attributions: Credits (context imagery, every unique license+attribution pair from `data/assets.manifest.json` via the build-time `virtual:blindrev-credits` module, software + fonts) and Provenance (step + current context layer attribution/license/citation).
- Context: default optical = first `kind: "optical"` layer (HLS S30); "follow the date" uses a sharp (maxZoom ≥ 10) optical image of that date, else the default. Radar Vision = NISAR GCOV of the date (verified: `docs/reports/F-shots-v2/1080/12-radar-vision.png`). G already clamps context providers to each layer's own `bounds` + `tiling` — no change needed.
- Briefing fact sources show friendly labels (`friendlySource`), raw path in `title`.
- Lint: `biome lint packages/app-shell/src` → 0 errors (fixed noComponentHookFactories in Overlays, noAriaHiddenOnFocusable in Transit); warnings remain.
- Terrain badge: ion token set + ellipsoid terrain → OFFLINE badge "World Terrain failed: <GlobeStatus.message>"; no token → INFO "no ion token".
- CelesTrak: 2 h minimum now applies to every attempt (`blindrev.tle.lastAttempt.v1`), not only successes.
- No data-testid or `window.__BLINDREV__` names were renamed. New testids: `step-readout`, `mission-journal`, `mission-settings`, `toggle-left(-close)`, `toggle-right(-close)`, `next-step-mini`, `hub-band`, `asset-credits`. When the left panel is collapsed, `mark-on-globe` / `open-2d-editor` / `validate` live in the mini card (only one copy is ever rendered).

## Known gaps / rough edges

- At 1920×1080 the AOI is fully visible and centred but spans ≈ 32 % of the screen width (limited by the free height above the timeline), short of the ~45 % target. The timeline is ≈ 200 px, slightly over the ~180 px target; the A/B row was kept per step (testids + targets).
- The menu's MenuList (ui-hud) shows its focus ring on load (autoFocus) — intentional for keyboard users, slightly different from the mockup.
- Route blank p95 is over budget on cold switches (see above); warm-viewer retention was not attempted.
- Settings → quality applies on the next scene mount only (no live `setQuality`).
- The play-loop script places the ROI through the harness (`setRoi`) — 3D pointer drawing on the real globe was not exercised end-to-end by automation (works in the stub fixture via clicks; G's renderer emits `roiVertexAdded`).
- Tauri desktop run not exercised by F (S owns `src-tauri`).

STATUS: DONE
