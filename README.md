# BlindRev

BlindRev is a desktop investigation game about ground deformation seen by radar. You play an investigator who watches a series of NISAR satellite passes over the San Joaquin Valley, California, picks two dates, outlines the ground that keeps sinking, and has that outline scored against an authored answer mask. It was built for the NASA Space Apps SAR challenge; the displacement values in the case are **simulated** (see [Data provenance](#data-provenance-and-honesty-labels)), while the place, the pass dates, the context imagery and the satellite orbit are real.

## Fastest way to run it

Double-click **`START_BLINDREV.cmd`** in the repository root. It is a plain `cmd.exe` script (no PowerShell). It does this, in order:

1. If `packages\app-shell\src-tauri\target\release\blindrev.exe` exists, it starts the desktop app and exits.
2. Otherwise it runs the browser version:
   - checks for Node.js (stops with a message if missing; Node 22 or newer is required);
   - finds pnpm, falling back to `corepack pnpm`, then `npx --yes pnpm@10.30.2`;
   - runs `pnpm install` once, if `node_modules\.modules.yaml` is missing;
   - starts the dev server on `http://localhost:5173` and opens your browser about 6 seconds later.
3. Keep the console window open while you play. Close it (or press Ctrl+C) to stop. On any error it prints the reason and waits for a key.

If port 5173 is already in use, the dev server refuses to start (`--strictPort`); close the other program first.

## Prerequisites

Versions actually used to build this repository (`package.json`, `pnpm-lock.yaml`, `Cargo.lock`, `docs/decisions/S.md`, and `node --version` / `pnpm --version` / `rustc --version` on the build machine):

| Tool                            | Required                                                | Used here                 |
| ------------------------------- | ------------------------------------------------------- | ------------------------- |
| Windows                         | 10 or 11 (acceptance target)                            | Windows 11                |
| Node.js                         | ≥ 22 (`engines.node`)                                   | 24.14.0 (CI uses Node 24) |
| pnpm                            | 10.30.2 (`packageManager`)                              | 10.30.2                   |
| Rust toolchain                  | only for the desktop app; crate `rust-version` 1.77.2   | rustc / cargo 1.94.1      |
| Microsoft Edge WebView2 Runtime | desktop app only; the installer downloads it if missing | Evergreen                 |
| Git LFS                         | to clone the binary assets                              | `git lfs install --local` |

Main libraries (locked): TypeScript 7.0.2, Vite 8.3.8, Vitest 5.1.0, Biome 2.6.8, CesiumJS 1.147.0, three.js 0.187.0, postprocessing 6.39.6, React 19.3.1, zustand 5.1.0, Zod 4.6.7, satellite.js 7.2.0, Playwright 1.65.1, Tauri CLI / API 2.12.4, Rust `tauri` 2.12.5.

Install dependencies once from the repository root:

```
pnpm install
```

## Commands

All commands run from the repository root. Each one below is defined in the root `package.json` or a package `package.json`; the ones marked "run" were executed while writing this file (2026-11-15), the others were read, not run.

### Develop

| Command                                      | What it does                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                   | Vite dev server for the game on `http://localhost:5173` (strict port). Cesium's `Workers/Assets/ThirdParty/Widgets` are served at `/cesium/`. |
| `pnpm preview`                               | Serves the last production build on `http://localhost:4173`.                                                                                  |
| `pnpm --filter @blindrev/renderer-globe dev` | Globe sandbox on port 5181 (agent G's test bench; the A2 suite lives in `packages/renderer-globe/sandbox/a2.ts`).                             |
| `pnpm --filter @blindrev/ui-hud dev`         | UI component gallery on port 5183.                                                                                                            |

Useful URL flags for the game (`packages/app-shell/src/env.ts`):

| Flag                               | Effect                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `?route=hub` / `?route=mission`    | Jump straight to a route. Add `&briefing=1` with `route=mission` to open the briefing. |
| `?hub=2d`                          | Static 2D command board instead of the 3D hub (A1 fallback).                           |
| `?stub=1`                          | Deterministic Canvas2D stand-ins for both 3D renderers (visual-CI fixture).            |
| `?offline=1`                       | Never touch the network: bundled imagery, ellipsoid terrain, bundled TLE.              |
| `?motion=reduced` / `?motion=full` | Override reduced motion for this session.                                              |
| `?now=<ISO time>`                  | Fixed clock (also disables the TLE refresh).                                           |
| `?harness=1`                       | Diagnostics drawer for the performance harness.                                        |
| `?soak=<minutes>`                  | Start the heap soak and frame sampler at load.                                         |

The harness itself is always installed as `window.__BLINDREV__` (state snapshot, actions, frame / soak / context-loss samplers, `exportTelemetry()`). See `docs/checklists/manual-gpu.md`.

### Build

| Command                      | What it does                                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                 | `pnpm -r --workspace-concurrency=1 build`. Every package typechecks; `app-shell` then runs `vite build` into `packages/app-shell/dist/`. (read, not run)                                                                                            |
| `pnpm typecheck`             | `tsc --noEmit` in all 7 packages. **Run at 22:08 and 22:16: exit 0.**                                                                                                                                                                               |
| `pnpm lint`                  | `biome lint .` (errors fail; warnings do not). **Run at 22:08, 22:16 and 22:21: exit 1.** The same 3 source errors each time; at 22:21 also 2,816 errors from an un-ignored `dist-e2e/` build folder — see [Known limitations](#known-limitations). |
| `pnpm format` / `pnpm check` | Biome format (writes) / format + lint check. (read, not run)                                                                                                                                                                                        |

### Test

| Command                                                                                    | What it does                                                                                                                                                               | Result when run                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                | Vitest in every package.                                                                                                                                                   | **Run at 22:08 and 22:16: exit 0** both times. core-sim 212 / 212, geodesy-verify correctness 17 / 17, renderer-globe 17 / 17, ui-hud 13 / 13, data-forge 11 / 11; renderer-iss and app-shell have no unit tests yet. The geodesy parity project reports 3 of 6 failing and prints `PARITY FAIL - non-blocking`; this is expected and explained in `docs/reports/spike-D-geodesy.md`. |
| `pnpm --filter @blindrev/geodesy-verify verify`                                            | Geodesy correctness + parity table vs CesiumJS (Spike D).                                                                                                                  | **Run: exit 0**, `CORRECTNESS: PASS   PARITY: FAIL (non-blocking)`.                                                                                                                                                                                                                                                                                                                   |
| `pnpm verify:assets`                                                                       | Data-forge CI gate: Zod validation of `data/**/*.json`, mission URL and mask hashes, context-tile QA, asset manifest, licences, Git LFS coverage, byte-identical re-forge. | **Run twice.** 22:09: exit 1, 10 files in `models/nisar/` and `textures/hub/` had no licence record. 22:16, after agent H added them: **exit 0, `verify: PASS`**, all 7 gates `[PASS]`.                                                                                                                                                                                               |
| `pnpm e2e`                                                                                 | Playwright: `playwright test --config tests/e2e/playwright.config.ts`.                                                                                                     | Not run. **`tests/e2e/` does not exist yet** (phase 2), so this command currently fails.                                                                                                                                                                                                                                                                                              |
| `node packages/app-shell/scripts/play-loop.mjs --base http://localhost:5173/ --out shots/` | Plays the whole loop in headless Chromium against a running dev server and saves a screenshot per stage.                                                                   | Not run by the author of this file.                                                                                                                                                                                                                                                                                                                                                   |
| `node tools/shot.mjs --url <url> --out <png>`                                              | Headless Chromium (GPU via ANGLE, SwiftShader fallback) screenshot tool.                                                                                                   | Not run by the author of this file.                                                                                                                                                                                                                                                                                                                                                   |

### Data pipeline (`@blindrev/data-forge`)

| Command                                       | Network | What it does                                                                                                                                                                   |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @blindrev/data-forge fetch`    | yes     | Fetches NASA GIBS tiles (basemap + context) into `packages/app-shell/public/`.                                                                                                 |
| `pnpm forge`                                  | no      | Deterministic: simulated evidence rasters, QA masks, the authored reference mask, `data/missions/sinking-city.json`, `data/prefabs/basemap.json`, and the PENDING-AOI fixture. |
| `pnpm --filter @blindrev/data-forge manifest` | no      | Rebuilds `data/assets.manifest.json` (path, size, SHA-256, licence of every public asset).                                                                                     |
| `pnpm verify:assets`                          | no      | The CI gate above.                                                                                                                                                             |
| `pnpm --filter @blindrev/data-forge gate-b`   | no      | Measures Spike B and writes `packages/data-forge/gate-b.json`.                                                                                                                 |

Details: `packages/data-forge/README.md`.

### Desktop app (Tauri v2)

| Command               | Output                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm desktop`        | `tauri dev`: starts the Vite dev server and opens the app window against it.                                                                                                    |
| `pnpm desktop:build`  | `tauri build --no-bundle` → **`packages\app-shell\src-tauri\target\release\blindrev.exe`**. This is the file `START_BLINDREV.cmd` looks for.                                    |
| `pnpm desktop:bundle` | `tauri build` → NSIS installer in `packages\app-shell\src-tauri\target\release\bundle\nsis\` (`BlindRev_0.1.0_x64-setup.exe`, per-user install, downloads WebView2 if missing). |

None of these were run while writing this file (other agents were using the Rust target directory). Agent S built the shell with `cargo build --release` on 2026-11-15, launched it and confirmed the "BlindRev" window (against a placeholder page, since deleted). CI's `windows-smoke` job builds the exe with `pnpm desktop:build`, launches it for 10 s, then builds the installer (`docs/decisions/S.md`, `.github/workflows/ci.yml`). `desktop:build` skips `tsc` on purpose; typecheck separately.

Opt-in diagnostics log: set `BLINDREV_DIAGNOSTICS=1` or start `blindrev.exe --diagnostics`. The log goes to `%LOCALAPPDATA%\bureau.blindrev.app\logs\blindrev.log` (5 MB, one previous file kept).

### Package and sign

Read `docs/reports/packaging.md`. In short:

- Builds are **unsigned**. Authenticode signing needs a code-signing certificate held in an HSM or cloud signing service; the repo has none. Windows SmartScreen will show "Windows protected your PC" — choose **More info → Run anyway**.
- The **auto-updater is not enabled**. `tauri-plugin-updater` refuses to run without a public key, and its private key must be kept secret; neither exists here.
- `packaging.md` gives the exact steps for both (Azure Trusted Signing or signtool; updater key pair, `tauri.conf.json` changes, CI secrets).

### Optional: Cesium ion token (World Terrain)

By default the app ships **without** a Cesium ion token and renders terrain on the WGS84 ellipsoid; the HUD shows "Ellipsoid terrain — no ion token". To try Cesium World Terrain:

1. Create a token in your Cesium ion account with scope `assets:read` only, limited to asset 1 (Cesium World Terrain).
2. Put it in `packages/app-shell/.env.local`:

   ```
   VITE_CESIUM_ION_TOKEN=<your token>
   ```

3. Restart `pnpm dev`, or rebuild the desktop app.

Never commit the token: `.env.*` is in `.gitignore`. Anything in a `VITE_` variable is compiled into the shipped JavaScript, so treat the token as public. **Known gap:** the desktop app's CSP does not yet allow `https://api.cesium.com`, which CesiumJS calls first, so in the packaged app World Terrain falls back to the ellipsoid even with a valid token. The browser dev build is not affected. Details and the fix: `docs/security/threat-model-csp-cors.md`.

## How to play

**Main menu** — Up / Down (or W / S) to move, Enter to select, Esc to back out. _New Expedition_ starts; _Continue_ is dimmed until you have a save.

**Command board (hub)** — the NISAR hub with four cases around it. Only _01 The Sinking City_ (CASE_001) is playable; 02–04 are locked. Press **Open briefing** (Tab and Enter work). The trip into the case is a short "data tunnel" animation; any key skips it.

**The mission loop**

1. **Briefing.** A case file: place, dates, sources, and what is real versus simulated. Press **Start investigation**; the camera moves to the area of interest and, unless reduced motion is on, the passes start playing.
2. **Watch (Time Lens).** Play, pause, step or scrub through 9 passes from 31 Dec 2025 to 15 Oct 2026. Two passes (2026-02-05 and 2026-08-04) are real gaps in the record and show **No acquisition**; nothing is filled in. Look for ground that keeps sinking pass after pass; single-pass blobs and smooth ramps are decoys (weather in the radar signal).
3. **Pick two dates.** Mark a baseline **A** and a comparison **B**, at least 24 days apart, both with data.
4. **Mark your region.** Either click corners on the globe (click the first corner or press Enter to close), or open the **2D editor**, or use the keyboard (below). The region must be 25–2,500 km² and must not cross itself.
5. **Validate.** The region is rasterised onto the case grid and compared with the authored answer mask: IoU, precision and recall, a tier (PASS ≥ 0.50, PARTIAL 0.35–0.49, FAIL < 0.35) and advice. If too little of your region has good radar coherence (QA coverage < 60 % or < 500 valid pixels) you get a diagnostic instead of a score. The result is a mission score against an authored reference mask, not a scientific measurement.
6. **Case Journal.** Save the verdict (stored in the app's local storage) and return to the command board.

**Investigator tools** (left rail): **Time Lens** (timeline) and **Radar Vision** (switch the context imagery between optical — the 30 m HLS image of 17 Oct 2026 by default — and the real NISAR L-band radar backscatter of the current date) from the start; **Anomaly Detector** unlocks after you have viewed every available pass and flags suspicious areas on the current date, decoys included; **Evidence Connector** (the journal) unlocks with the first verdict; **Frequency Switch** and **Terrain Scanner** are shown locked for later cases.

**Controls** (read from `packages/renderer-globe/src/pure/input.ts`, `src/globe.ts`, `packages/app-shell/src/mission/controller.ts`, `packages/ui-hud/src/timeline/TemporalTimeline.tsx`, `packages/ui-hud/src/roi/RoiEditor2D.tsx`):

| Where                   | Input                                                        | Action                                                 |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| Globe camera            | W / S, A / D                                                 | Pan forward / back, left / right (relative to heading) |
|                         | Z / X, mouse wheel, pinch                                    | Zoom in / out                                          |
|                         | Q / E                                                        | Rotate heading                                         |
|                         | R / F                                                        | Tilt toward the horizon / back to straight down        |
|                         | Left-drag                                                    | Pan                                                    |
|                         | Right-drag, middle-drag or Shift-drag                        | Rotate and tilt                                        |
| Globe, marking a region | Click                                                        | Add a corner                                           |
|                         | Click the first corner, double-click, or Enter (≥ 3 corners) | Close the region                                       |
|                         | Backspace                                                    | Remove the last corner                                 |
|                         | Esc                                                          | Stop marking                                           |
| Globe, map focused      | `[` / `]`                                                    | Select previous / next corner                          |
|                         | Arrow keys (Shift ×10)                                       | Nudge the selected corner 0.001° (0.01°)               |
| Timeline                | Left / Right (or Down / Up)                                  | Step back / forward                                    |
|                         | Home / End                                                   | First / last pass                                      |
|                         | Space                                                        | Play / pause                                           |
|                         | A / B                                                        | Mark the current pass as baseline / comparison         |
| 2D editor               | Arrows (Shift = faster)                                      | Move the cursor                                        |
|                         | Enter or Space                                               | Add a point at the cursor                              |
|                         | C                                                            | Close the shape                                        |
|                         | `[` / `]`, then arrows (Shift ×10)                           | Select a point, nudge it 0.001° (0.01°)                |
|                         | Delete / Backspace                                           | Remove the selected point                              |
|                         | Esc                                                          | Deselect                                               |
|                         | Ctrl+Z                                                       | Undo                                                   |
| Data tunnel             | Any key                                                      | Skip                                                   |
| Dialogs                 | Esc                                                          | Close                                                  |

Camera keys pause while a text field, slider or dialog has keyboard focus. Settings (from the main menu or the command board) has Quality (Low / Medium / High), Reduced motion (System / On / Off), Sound, and a switch back to Cesium's default mouse camera.

## Repository layout

```
blindrev/
  START_BLINDREV.cmd        double-click launcher
  package.json              root scripts (pnpm workspaces)
  data/
    missions/sinking-city.json           the case: AOI, steps, masks, briefing, attributions
    missions/_fixture-pending.example.json  TEST_FIXTURE mission for the PENDING-AOI path
    prefabs/{camera,quality,constants,basemap}.json   tunable constants (Zod-validated)
    tle/nisar-65053.snapshot.json        bundled NISAR orbit elements
    assets.manifest.json                 generated: every public asset with SHA-256 and licence
  packages/
    core-sim/         pure simulation: contracts + Zod schemas, geodesy, camera maths, orbit (SGP4 → ECEF),
                      temporal-watch state machine, ROI validation, scoring. No DOM, WebGL, Cesium or three.js.
    geodesy-verify/   Spike D: correctness oracles and CesiumJS parity
    data-forge/       build-time data pipeline (GIBS fetch, simulated evidence, masks, manifest, verify)
    renderer-globe/   CesiumJS mission globe (custom ENU camera, layers, ROI drawing, ground track)
    renderer-iss/     three.js + postprocessing NISAR hub
    ui-hud/           React 19 design system (Outpost Signal tokens, components, timeline, 2D ROI editor, sound)
    app-shell/        the Vite app: routes, single-live-canvas scene manager, mission controller, harness
      public/         runtime assets (mission data, offline tiles, models, textures, art, audio)
      src-tauri/      Tauri v2 desktop shell (Rust)
  docs/
    ARCHITECTURE.md   interface contract and orchestrator decisions
    SPEC.md           product spec
    decisions/        one log per build agent
    reports/          spike and budget reports (index: docs/reports/README.md)
    security/threat-model-csp-cors.md
    checklists/manual-gpu.md, manual-a11y.md
  tools/              shot.mjs (headless screenshots), make-icon.mjs
  .github/workflows/ci.yml
DECISIONS.md          consolidated decision log
```

## Data provenance and honesty labels

| Item                                                                                                                                                  | Real or simulated                                                                                                               | Source                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Area of interest                                                                                                                                      | Real place: California Aqueduct corridor, Huron – Kettleman City, San Joaquin Valley, bounds `[-120.40, 35.88, -119.78, 36.40]` | Challenge resource pack: NISAR StoryMaps "Land Subsidence" and the UAVSAR postcards (`aoi.source` in the manifest)             |
| Pass dates, track 042, frame 070, descending                                                                                                          | **Real** acquisition metadata                                                                                                   | NISAR catalogue, NASA CMR collection C2854335566-ASF (ASF DAAC), queried 2026-11-15                                            |
| The two "No acquisition" passes (2026-02-05, 2026-08-04)                                                                                              | **Real** gaps in that catalogue                                                                                                 | same                                                                                                                           |
| Context imagery: HLS S30 30 m optical (2026-06-29, 2026-10-17), MODIS Terra true colour, NISAR L2 GCOV radar backscatter (z6–10), Blue Marble basemap | **Real** imagery, fetched at build time and bundled                                                                             | NASA GIBS                                                                                                                      |
| Ground displacement values and coherence (QA) masks                                                                                                   | **SIMULATED** — seeded and deterministic                                                                                        | BlindRev data-forge. Real NISAR interferograms (GUNW) need an Earthdata login and heavy processing.                            |
| Reference change mask                                                                                                                                 | **Authored answer key**, not a scientific product                                                                               | Polygons drawn by data-forge (`src/reference.ts`), rasterised with the same rule the scorer uses                               |
| NISAR position and ground track                                                                                                                       | Propagated from a real two-line element set (SGP4), not live telemetry. Nadir track only, no swath.                             | CelesTrak GP, NORAD 65053; bundled snapshot epoch 2026-11-15T12:25:21Z, refreshed from CelesTrak at most every 2 h when online |
| Case facts in the briefing                                                                                                                            | Quoted from the resource pack, each with its source line                                                                        | `briefing.facts[].source` in the manifest                                                                                      |

The game always shows these labels where they apply, as an icon plus a word (never colour alone):

| Label             | Shown when                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `SIMULATED`       | Always on this case (`labels: ["SIMULATED"]` in the manifest); also in the briefing and the legend unit |
| `OFFLINE`         | Imagery switched to the bundled tiles (no network, or online tiles failing)                             |
| `STALE_EPHEMERIS` | The orbit elements are more than 72 h from now                                                          |
| `TEST_FIXTURE`    | A stand-in renderer or the PENDING-AOI fixture mission is in use                                        |
| `PLACEHOLDER`     | Placeholder tiles (PENDING-AOI fixture only)                                                            |

## Credits and licences

Data and imagery (attribution strings as shipped in `data/missions/sinking-city.json` and the `ASSET_LICENSE.json` files):

- Context imagery: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)."
- Blue Marble Shaded Relief and Bathymetry: NASA Earth Observatory (MODIS), via NASA GIBS.
- MODIS Terra Corrected Reflectance (True Color): NASA LANCE / EOSDIS, via NASA GIBS.
- Harmonized Landsat and Sentinel-2 (HLS) S30 Nadir BRDF-Adjusted Reflectance: NASA LP DAAC; contains modified Copernicus Sentinel-2 data (ESA); via NASA GIBS. (Listed per context layer; not yet in the manifest's top-level `attributions` list.)
- NISAR L2 GCOV backscatter: NASA/JPL-Caltech & ISRO, ASF DAAC, via NASA GIBS.
- NISAR acquisition metadata: NASA CMR / ASF DAAC (collection C2854335566-ASF).
- NASA imagery licence: NASA open data, full and open sharing; data from NASA-led missions are CC0 unless marked otherwise (NASA Earthdata "Data Use and Citation Guidance").
- NISAR orbit: CelesTrak GP data (NORAD 65053), propagated with satellite.js.
- Case background: NISAR StoryMaps "Land Subsidence" (Peacock, An, Pinto & Lou 2024, doi:10.5281/zenodo.10818833); Miller et al. 2020; Jones et al. 2020.
- Simulated evidence, QA masks, reference mask, fixture tiles: generated by BlindRev data-forge, CC0-1.0.
- Main-menu background plate and the audio clips: supplied by the project owner for BlindRev (`public/art/`, `public/audio/`).

3D model and textures (agent H's folders, from their `ASSET_LICENSE.json`):

- **NISAR spacecraft model** (`packages/app-shell/public/models/nisar/`): "NISAR spacecraft model: NASA/JPL-Caltech (NASA Eyes on the Earth)", copied unmodified from the resource pack. The resource pack's source note (`../sars/assets/nisar_model/SOURCE.txt`) says: "this is an asset of the Eyes app, not an item in NASA 3D Resources. Check NASA media usage terms before redistributing it in a public repository." **Redistribution has not been cleared.** Check NASA's media usage terms before publishing the repository or the installer.
- **Hub Earth textures** (`packages/app-shell/public/textures/hub/`): day map — NASA Visible Earth / NASA Goddard Space Flight Center (Blue Marble, 2002), public domain; night lights — NASA Earth Observatory (Suomi NPP VIIRS, 2012), public domain; clouds — **Solar System Scope (https://www.solarsystemscope.com/textures/), CC BY 4.0**. Day and night maps were fetched via Wikimedia Commons because eoimages.gsfc.nasa.gov was unreachable from the build machine.

Software (licence field of the installed package): CesiumJS 1.147.0 Apache-2.0 (the Cesium ion logo and credits stay on screen when ion is used); three.js 0.187.0 MIT; postprocessing 6.39.6 Zlib; React / React DOM 19.3.1 MIT; satellite.js 7.2.0 MIT; zustand 5.1.0 MIT; Zod 4.6.7 MIT; Tauri API 2.12.4 Apache-2.0 OR MIT; fonts Outfit, IBM Plex Sans, IBM Plex Mono (via @fontsource 5.3.0) OFL-1.1.

BlindRev is a fictional bureau. It uses no NASA insignia; NASA data is credited above and in the app.

## Known limitations

State on 2026-11-15, from commands run for this file and from the agents' own reports:

- **Lint fails.** `pnpm lint` exits 1. In source there are 3 errors, all in the app shell: `noComponentHookFactories` twice in `packages/app-shell/src/screens/Overlays.tsx` (lines 274–275 at 22:21), `noAriaHiddenOnFocusable` in `packages/app-shell/src/screens/Transit.tsx` (line 194). At 22:21 a build output folder `packages/app-shell/dist-e2e/` had also appeared; `biome.json` ignores `**/dist` but not `dist-e2e`, so Biome reported 2,819 errors in total. Add `!**/dist-e2e` to `biome.json` (or `.gitignore` it and build elsewhere). CI's `checks` job gates on lint, so CI is red until these are fixed.
- **In-app credits are incomplete.** The Credits screen (`CreditsModal` in `Overlays.tsx`) lists the mission attributions, context imagery, orbit and software, but not the NISAR model (NASA/JPL-Caltech), the hub Earth textures, or the **CC BY 4.0** cloud texture from Solar System Scope, whose licence requires attribution.
- **Route-switch blank time is over budget on cold switches** (A1): menu → hub 0.76–1.26 s, hub → mission 2.0–2.5 s (including the 1.2 s minimum data tunnel), against a p95 target of 500 ms. Measured by agent F in headless Chromium; see `DECISIONS.md`.
- **No end-to-end tests yet.** `tests/e2e/` does not exist, so `pnpm e2e` and CI's `e2e` / `streaming` jobs fail. The keyboard-only ROI, reduced-motion and live-region E2E checks required by the spec are therefore not automated yet.
- **World Terrain cannot load in the packaged app** (CSP lacks `https://api.cesium.com`). The app degrades to ellipsoid terrain, labelled. With no token, which is the default, nothing changes.
- **Displacement is simulated.** Real NISAR GUNW products need Earthdata authentication and time-series preprocessing.
- **Orbit gate C not verified.** No independent reference ephemeris for NISAR was found; the only one (JPL Horizons −165053) is itself TLE-derived. Only the nadir track is drawn (`docs/reports/spike-C-orbit.md`).
- **Performance on min-spec GPUs and in WebView2 is not measured.** The A2 / A3 numbers were taken in headless Chromium on an RTX 5070 laptop. Use `docs/checklists/manual-gpu.md`.
- **Unsigned, no auto-updater** (see [Package and sign](#package-and-sign)).
- **The NISAR model's redistribution rights are unconfirmed** (see [Credits](#credits-and-licences)).
- **No top-level licence file** for BlindRev's own code; the Rust crate declares `MIT` in `Cargo.toml`.
- **Text zoom in the desktop app:** Tauri's zoom hotkeys are not enabled in `tauri.conf.json`, so Ctrl + Plus is not expected to work there. Not tested; see `docs/checklists/manual-a11y.md` §1.
- Settings cannot be opened from the mission screen (only from the main menu and the command board), and a Quality change applies the next time a renderer is created, that is after a route switch.

## Further reading

- `DECISIONS.md` — every default, deviation, blocker fallback and spike outcome.
- `docs/reports/README.md` — index of spike and budget reports with their gate status.
- `docs/security/threat-model-csp-cors.md` — CSP, CORS and token handling, with measured headers.
- `docs/checklists/manual-gpu.md`, `docs/checklists/manual-a11y.md` — manual acceptance checklists.
- `docs/ARCHITECTURE.md`, `docs/SPEC.md` — contract and product spec.
