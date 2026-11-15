# BlindRev — One-Shot Implementation Prompt (product spec)

Version 1.1 (consolidated from the Outpost Signal technical plan and the red-team review) · 2026-11-16

MUST / SHOULD / MAY are normative (RFC 2119). Kill gates activate documented fallbacks — they never end the build.
Where a decision is required but unspecified, take the documented default and log it in DECISIONS.md.
`docs/ARCHITECTURE.md` records the orchestrator's decisions and overrides this file where they differ.

## 1. Product & identity

BlindRev is a desktop investigation game built on the Outpost Signal visual identity ("Follow the changes. Find the evidence.").
The player is an investigator in the BlindRev bureau: briefing → temporal watch/scan over discrete satellite acquisitions →
draw a Region of Interest → validation against an authored reference change mask → Case Journal.
Visual/UX reference: EVE Online, Warframe, Lethal Company; orbital-view reference: NASA Eyes on the Earth (NISAR module).

Earth model. WGS84 ellipsoid (Cesium.Ellipsoid.WGS84); geodetic latitudes; ellipsoidal heights; ECEF in 64-bit doubles.
Terrain: Cesium World Terrain (quantized-mesh) + NASA GIBS WMTS contextual layers + preprocessed mission rasters, all via CesiumJS.

Tokens. Ink #0E1020, Graphite #1C2036, Pearl #F3F5F7; fringe accents Cyan #3DE0D0, Magenta #E0489B, Amber #F2B441, Indigo #6C5CE7.
Fonts (self-hosted): Outfit (display), IBM Plex Sans (body), IBM Plex Mono (data). Aesthetic: 0% glow, matte, 3-step ramps. WCAG 2.2 AA.
Windows 10/11 desktop via Tauri v2 is the acceptance target; the browser build is a dev/CI harness only.

Lifecycle. Menu → Command Board / Hub → 500 ms 2D wipe → Active Mission Globe (Land Subsidence — The Sinking City).
Full scope is retained (Three.js ISS hub, custom ENU camera, NISAR nadir track) but is strictly spike-gated.

## 2. Build order & spike gates

| Phase | Build                                                                                                                                                                                                          | Gate                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| P0    | Monorepo scaffold + tooling (§3)                                                                                                                                                                               | clean tsc --noEmit, Vitest, Biome |
| P1    | Offline evidence vertical slice: core-sim (geodesy §8, FSM §9, ROI/scoring §10), data contracts (§4), data pipeline (§5), Cesium globe with default camera controller as scaffolding, 2D ROI editor, HUD shell | Spikes B + D                      |
| P2    | Spike A in Tauri WebView2 on min-spec GPUs; then custom ENU camera, quality presets, route transition                                                                                                          | A1, A2, A3                        |
| P3    | ISS hub (Three.js + postprocessing) — only after A1                                                                                                                                                            | A1 pass                           |
| P4    | NISAR propagation + nadir ground track                                                                                                                                                                         | Spike C                           |
| P5    | A11y E2E, perf budget report, CI visual suite, packaging/signing, runbook                                                                                                                                      | Definition of Done (§16)          |

Spike gates (numeric, falsifiable):

- **A1 — context / route / memory.** CesiumJS + Three.js route switching via the 500 ms wipe; single-live-canvas lifecycle; teardown/recovery. Pass: ≥ 60 FPS @ 1080p steady; 0 unrecovered WebGL2 context losses across 10 forced WEBGL_lose_context cycles; 30-min soak with 60 s heap snapshots — peak−baseline ≤ 200 MB and no 5-consecutive-snapshot rise after a 5-min warm-up; route-switch visible blank p95 ≤ 500 ms with a mandatory progress HUD. Kill: 3D ISS hub → static 2D Outpost Signal command board.
- **A2 — camera / terrain.** Custom ENU controller under the adversarial suite: forced terrain-load gaps, steep slopes, poles (|φ| ≥ 89.5°), antimeridian, keyboard-only, wheel/pointer. Pass: zero underground camera clipping anywhere in the suite; 60 FPS maintained.
- **A3 — depth / postprocessing.** logarithmicDepthBuffer true/false against the exact stack (World Terrain + GIBS + mission overlays + Material chunks); hub selective bloom restricted to the four fringe accents. Pass: no z-fighting/depth artifacts; 60 FPS maintained with bloom.
- **B — MVP subsidence data.** Availability proven; license/attribution captured; QA valid-pixel coverage ≥ 60% over the AOI; mask registration ≤ 1 px; scoring bit-deterministic (same ROI + same steps → identical score); provenance, sensor diagnostics, explicit "No acquisition" states rendered; zero date interpolation.
- **C — orbital propagation.** Fresh TLE (|t_now − t_epoch| ≤ 24 h) matches a published reference ephemeris at matching UTC epochs in ECEF within < 1 km under the §11 error budget; STALE_EPHEMERIS fires at T_max_age; offline snapshot fallback works. Kill: swath envelopes omitted unless attitude/incidence geometry is validated.
- **D — geodesy & ROI.** Per-op tolerances of §8 met against Cesium parity and independent oracle vectors; all adversarial ROI cases pass deterministically.

## 3. Monorepo & package boundaries

pnpm workspaces, TypeScript strict, Vite, Vitest, Biome (.editorconfig), Zod, Playwright, Git + Git LFS, Tauri v2 + Rust.

| Package        | Role                                                                                   | Hard rules                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core-sim       | Pure simulation: geodesy ops, TEME→ECEF, TemporalStep FSM, ROI/IoU validation          | Zero runtime imports of DOM/WebGL/Cesium/Three. Own Float64 Vec3 (structurally typed {x,y,z}). Cesium.Cartesian3 scratchpads exist only in renderer-globe.                                              |
| app-shell      | Route mounting, single-live-canvas lifecycle, wipe transition                          | Only one active WebGL2 renderer at a time                                                                                                                                                               |
| renderer-globe | CesiumJS mission globe, WebGL2                                                         | 0% bloom, no postprocessing; native GPU RTC pipeline (no per-frame CPU vertex recompute); no terrain shader forks; mission layers via pre-baked 3-step tiles or documented ImageryLayer/Material chunks |
| renderer-iss   | Three.js + pmndrs/postprocessing hub                                                   | HDR bloom only on the 4 fringe accents; production work gated on A1                                                                                                                                     |
| ui-hud         | React 19 + vanilla CSS                                                                 | Consumes EARTH_exe_Outpost_Tokens.css + self-hosted fonts                                                                                                                                               |
| geodesy-verify | Vitest cross-validation vs Cesium                                                      | Cesium is a devDependency here only                                                                                                                                                                     |
| data-forge     | Node scripts: snapshot fetch, mask rasterization, manifest hashing, determinism checks | Seeded / reproducible                                                                                                                                                                                   |

Mission manifests, camera presets, scene configs are declarative JSON (data/missions/_.json, data/prefabs/_.json) validated by Zod at build and load time.

## 4. Data contracts

TemporalStep v2 — see `docs/ARCHITECTURE.md` §3 (field-for-field).

Asset manifest gates (CI): data/assets.manifest.json is validated against Git LFS pointers, SHA-256 hashes, orphan detection, and mandatory license + attribution metadata. Deterministic artifacts must regenerate to identical hashes.

## 5. Mission data pipeline — real open data

Open input #1 — mission AOI. The city and bounds live only in data/missions/sinking-city.json. MUST NOT invent a city. The whole pipeline is parameterized by this record. While PENDING the mission runs on a labeled TEST_FIXTURE AOI with synthetic placeholder tiles. (Orchestrator decision: AOI injected — ARCHITECTURE §9.)

Acquisition procedure:

1. Contextual snapshot. NASA GIBS WMTS (open, build-time fetch — no client CORS dependency). Verify the current REST template against gibs.earthdata.nasa.gov; fetch a fixed-zoom tile set over the AOI via data-forge; record layer id, date, license, attribution.
2. Evidence product. Attempt open InSAR displacement sources in order: (a) NASA Space Apps preprocessed InSAR/SAR displacement datasets; (b) open ground-motion services with downloadable displacement rasters and permissive licenses. Required metadata: LOS or vertical, reference point, units, sign convention, track/frame/orbit direction, coherence/QA mask.
3. Blocker fallback. If auth or preprocessing blocks step 2, generate a seeded deterministic SIMULATED displacement field + QA mask over the AOI, labeled SIMULATED in the manifest, HUD, and briefing — never unlabeled. Log the blocker in DECISIONS.md.
4. Authored reference change mask. Authored polygon(s) rasterized to mask tiles, versioned in the manifest — the mission's answer key, not a scientific product.

Color ramps (0% glow, matte, 3-step): subsidence #8F5236→#C9784A→#E2B08A; deforestation #2F6B4C→#4F8F6A→#8DBF8A; glacier #8FB8D4→#BFE3F2→#EAF6FB; wetlands #2A7471→#3E9C9A→#8CCFC8.

## 6. Rendering, routes & quality presets

- WebGL2 pinned across all renderers for deterministic acceleration inside WebView2.
- Single live canvas. One active WebGL2 renderer per route; never composite CesiumJS and Three.js. Transition = 500 ms 2D HUD wipe/fade to Ink #0E1020, cubic-bezier(0.2, 0, 0, 1); immediate cut under prefers-reduced-motion. The outgoing renderer is paused and its GPU resources disposed while occluded. The incoming renderer mounts behind the wipe; if scene-ready (terrain ready + first imagery) is not reached within 500 ms, hold the wipe with a progress HUD (3 s cap → loading screen). A1 measures route-switch p95 and visible blank; if blank p95 > 500 ms, the documented fallback is warm-viewer retention (a single retained Cesium viewer across hub routes).
- Depth. scene.logarithmicDepthBuffer on/off is decided by A3 against the exact tile stack; record the final value in DECISIONS.md.
- Quality presets (static, user-selectable; never resized during camera motion; no VRAM auto-detection ever): Low {tileCacheSize 100, maximumScreenSpaceError 4, renderScale 0.75}; Medium {200, 2, 1.0}; High {400, 1.5, 1.0} with 4K gated to High. Quadtree subdivision uses Cesium's QuadtreePrimitive SSE defaults.

## 7. Custom camera controller (behind A2)

ScreenSpaceCameraController inputs fully disabled. Deterministic geodetic/ENU replacement:

- WASD surface-tangent pan along the local East-North plane, v(h) = clamp(k·h, v_min, v_max); latitude clamp |φ| ≤ 89.5°; wrap ±180° antimeridian crossings.
- Z/X and wheel/pinch zoom — logarithmic range r' = r · e^(±Δz) between r_min and the orbital ceiling.
- Terrain collision clamp — per frame, evaluate ≥ 5 samples along the camera-to-target segment via scene.globe.getHeight(cartographic); treat undefined (unloaded tile) as last-known terrain + clearance; clamp ellipsoidal altitude to max(terrainHeight + minClearanceMeters, minEllipsoidalHeight).
- Focus arbitration — suspend movement keys whenever HUD inputs or modal dialogs hold keyboard focus.
- Camera constants live in data/prefabs/camera.json (Zod-validated). The default Cesium controller remains the documented rollback if A2 fails.

## 8. Geodesy verification (Spike D)

Cesium is the parity oracle only; correctness is established by independent analytic reference vectors + round-trip closure.

| Operation           | Parity vs Cesium                    | Correctness oracle                        |
| ------------------- | ----------------------------------- | ----------------------------------------- |
| Geodetic → ECEF     | ≤ 1e-6 m per component              | analytic WGS84 cases; round-trip ≤ 1e-6 m |
| ECEF → geodetic     | height ≤ 1e-6 m; lat/lon ≤ 1e-9 rad | round-trip closure ≤ 1e-6 m               |
| ENU basis at (φ, λ) | components ≤ 1e-9                   | orthonormality ≤ 1e-12; east × north = up |
| Altitude scaling    | ≤ 1e-6 m                            | direct                                    |

geodesy-verify runs both vector sets in CI; core-sim keeps zero Cesium imports. Correctness and parity failures are reported separately — a parity-only failure must not block a provably correct implementation.

## 9. Temporal Watch FSM (core-sim)

States: IDLE, PLAYING, PAUSED_UNAVAILABLE, SCRUBBING. Unit-tested transitions: auto-advance skips isAvailable: false steps while emitting a NoAcquisition event (explicit "No acquisition" telemetry; never date interpolation); scrubbing onto an unavailable step → PAUSED_UNAVAILABLE; prefers-reduced-motion disables auto-play sweeps at the UI layer; all transitions are journaled. Vitest uses fixed clocks.

## 10. ROI & validation (core-sim)

- Input paths: 3D globe pointer drawing; keyboard vertex-nudge (arrow = 0.001°, ×10 with Shift); 2D ROI editor fallback (the deterministic primary path for automated tests; editor coordinates map directly to lat/lon).
- Geometry guards: reject self-intersection (even-odd crossing test); normalize/split ±180° crossings; clamp |φ| ≤ 89.9°; enforce A_min ≤ A_ROI ≤ A_max (spherical-excess area on authalic radius 6,371,007.2 m, documented as an approximation used only for bounds checking).
- Scoring: rasterize the polygon onto the evidence-mask grid by pixel-center containment (even-odd); reproject any EPSG:3857 source to EPSG:4326 before scoring — never mix CRS at pixel level. Compute IoU, precision, recall vs the authored mask. Emit scores only when QA valid-pixel coverage ≥ 60% and ≥ 500 valid pixels, otherwise emit the QA diagnostic. Enforce date-pair Δt ≥ Δt_min.
- Diagnostics: InSAR coherence/decorrelation messages on QA failures ("Low interferometric coherence in selected zone; inspect high-coherence mask"); optical cloud-cover messages only for masked optical layers.
- Labeling: the UI MUST present results as mission scoring against an authored reference mask, not scientific measurement. Same ROI + same steps → bit-identical score (Spike B gate).

## 11. NISAR propagation (Spike C)

- Pipeline. satellite.js (SGP4/SDP4) propagates NORAD 65053 TLEs → TEME/ECI → explicit GMST rotation to ECEF (temeToEcef) → position/velocity/nadir ground track. Propagated state, not live telemetry.
- Error budget (MUST be written before the gate is run). GMST-only TEME→ECEF ignores UT1−UTC and polar motion; example terms to recompute and verify: UT1−UTC ≤ 0.9 s → ≈ 470 m position error at LEO radius; polar motion ≤ ~1 m; SGP4 fresh-epoch model error ~0.5–1 km. If the budget shows < 1 km unachievable with GMST-only, add UT1 correction (IERS Bulletin A) or re-derive the gate with documented justification. The < 1 km comparison uses a published reference ephemeris (NASA/JPL or Space-Track multi-epoch states at matching UTC epochs in ECEF, convention documented).
- TLE policy. Bundled offline snapshot loads synchronously; refresh asynchronously from CelesTrak (GP API, CATNR 65053) only after the §13 matrix verifies CORS and rate limits — otherwise snapshot-only. Zero Space-Track credentials in the client. |t_now − t_epoch| > T_max_age → STALE_EPHEMERIS amber Alert badge with epoch age.
- Standing kill: nadir track only; swath envelopes omitted unless spacecraft attitude and radar incidence geometry are verified.

## 12. Performance & memory budgets

Min-spec (targets, benchmarked via the manual GPU checklist on Windows 10/11 + current WebView2): discrete min = GTX 1650 4 GB / RX 6400 class → 60 FPS @ 1080p Medium; integrated min = Iris Xe → 30 FPS floor @ 1080p Low; 4K gated to High on RTX 3050-class.

| Preset | tileCacheSize | maxSSE | renderScale | Frame-time target                   |
| ------ | ------------- | ------ | ----------- | ----------------------------------- |
| Low    | 100           | 4      | 0.75        | p95 ≤ 33 ms @ 1080p (Iris Xe)       |
| Medium | 200           | 2      | 1.0         | p95 ≤ 16.6 ms @ 1080p (GTX 1650)    |
| High   | 400           | 1.5    | 1.0         | p95 ≤ 16.6 ms @ 4K (RTX 3050-class) |

Measurement. Frame p50/p95 via a rAF sampling harness writing telemetry JSON. Soak: 30 min steady state, JS heap snapshots every 60 s — pass = peak−baseline ≤ 200 MB and no 5-consecutive-snapshot rise after a 5-min warm-up. Route-switch visible blank p95 ≤ 500 ms. Context-loss recovery: 10 × WEBGL_lose_context, 0 unrecovered, recovery ≤ 5 s. GPU process memory is recorded via the Windows manual checklist (CI cannot verify GPU budgets; the checklist is the record). Pre-allocated Float64Array/Vec3 scratchpads in core-sim; Cartesian3 scratchpads in renderer-globe.

## 13. Platform, security & offline

- Tauri v2 (Rust): bundled WebView2 Evergreen bootstrapper; Authenticode signing (expect initial SmartScreen reputation warm-up); public-key-signed auto-updater; opt-in crash/diagnostic log rotation. The desktop package is the acceptance target; browser mode is dev-only.
- CSP baseline (extend via the matrix; never ship untested): `default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob: https://assets.ion.cesium.com https://gibs.earthdata.nasa.gov; connect-src 'self' https://ion.cesium.com https://assets.ion.cesium.com https://gibs.earthdata.nasa.gov https://celestrak.org; style-src 'self' 'unsafe-inline'`.
- Threat-model / CSP-CORS matrix (deliverable). Rows: public ion token extraction → scoped assets:read World-Terrain token, rotation procedure, quota monitoring; WebView2 origin vs ion referer rules; CelesTrak CORS/rate limits (fallback: snapshot-only refresh cut); Cesium web workers actually functional under `worker-src 'self' blob:`; token rotation × native HTTP cache fragmentation; stale-data labeling.
- Cesium ion. Scope-restricted public read-only token from config/env; mandatory Cesium ion and sensor attributions in the HUD; graceful degradation on 401/403/429 or network loss to EllipsoidTerrainProvider + bundled low-zoom offline tiles + an OFFLINE HUD badge.
- Staleness labeling is mandatory everywhere: STALE_EPHEMERIS, OFFLINE, SIMULATED, PLACEHOLDER — never present stale or simulated data as current.
- HTTP caching: native WebView2 disk cache with Cache-Control headers; no custom Rust tile proxy unless telemetry proves insufficiency.

## 14. CI & quality pipeline

- Pre-commit: fast staged-only Biome formatting/linting against .editorconfig.
- GitHub Actions CI: tsc --noEmit (all packages); Vitest unit + geodesy cross-validation; cargo clippy; asset manifest gates (§4); Playwright visual suite on offline deterministic fixtures (fixed camera states, static imagery, perceptual diff ≤ 2% differing pixels at 1080p) — streaming World Terrain / GIBS tests run separately and are non-gating; keyboard-only ROI editing E2E, reduced-motion E2E, and live-region assertions are gating; Windows WebView2 smoke harness + manual GPU/a11y checklist (200% text zoom, reduced-motion, contrast) documented in-repo.
- Flakiness controls: no network in gating tests; seeded data generation; fixed clocks; fixed cameras.

## 15. Accessibility acceptance criteria (WCAG 2.2 AA)

- Screen-reader mission summary: a full DOM transcript of briefing, temporal steps, ROI coordinates, diagnostics, and verdict.
- Live-region announcements for "No acquisition" and FSM state changes.
- Keyboard-only ROI editing (verified E2E); single-pointer alternative to drag drawing.
- All interactive controls — including the 24 px chamfered return-to-hub button — enforce ≥ 44×44 px pointer/focus targets; 2 px Cyan #3DE0D0 focus ring with 5 px offset.
- Contrast ≥ 4.5:1 over dynamic imagery via scrims; HUD text over streamed tiles always scrimmed.
- prefers-reduced-motion: disables Temporal Watch auto-play sweeps, smooth camera flights, portal wipes, and bloom transitions; route transition becomes an immediate cut.

## 16. Definition of Done

- pnpm -r build + tsc --noEmit clean; Vitest / Biome / CI green.
- Spike B, C, D and A1–A3 reports with measured numbers vs the §2 gates (pass or documented kill/fallback).
- Mission playable end-to-end in the Tauri package on Windows: briefing → temporal watch (including an explicit "No acquisition" state) → ROI (3D pointer + 2D editor paths) → validated score + diagnostics → Case Journal.
- Budget report from the §12 harness: frame p50/p95, soak results, route-switch blank p95, context-loss recovery.
- Asset manifest, licenses, attributions valid; SIMULATED / PLACEHOLDER / STALE / OFFLINE labeling correct wherever fallbacks are active.
- README runbook (dev, build, sign, test, package) + DECISIONS.md logging every default chosen, deviation, and the open AOI input.
- A11y criteria (§15) with E2E evidence and the manual checklist completed.

## Appendix A — Authored constants (tunable, live in JSON + Zod-validated)

| Constant                      | Initial value                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Δt_min (date-pair separation) | 24 days                                                                                           |
| IoU verdict tiers             | PASS ≥ 0.50 · PARTIAL 0.35–0.49 · FAIL < 0.35 (precision/recall ≥ 0.60 advisory, always reported) |
| ROI area bounds               | A_min 25 km² · A_max 2,500 km²                                                                    |
| QA gates                      | coverage ≥ 60% · ≥ 500 valid pixels · mask registration ≤ 1 px                                    |
| Camera                        | k = 0.1 s⁻¹ · v_min 25 m/s · v_max 100 km/s · minClearance 250 m · minEllipsoidalHeight 500 m     |
| TLE staleness                 | T_max_age 72 h · fresh window for the < 1 km gate: 24 h                                           |
| Wipe                          | 500 ms · cubic-bezier(0.2, 0, 0, 1) · progress cap 3 s                                            |
| Soak                          | 30 min · snapshot 60 s · peak−baseline ≤ 200 MB                                                   |
| Visual CI threshold           | ≤ 2% differing pixels, fixed cameras, 1080p                                                       |
