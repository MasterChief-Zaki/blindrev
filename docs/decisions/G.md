# Agent G — renderer-globe decisions

## Defaults chosen

- `CesiumWidget` (not `Viewer`): no widget chrome; `baseLayer: false` (never the ion Bing default), `skyBox: false` (no stars/sun/moon, so no lens flare), `scene3DOnly`, MSAA 4, `requestRenderMode: false`, `showRenderLoopErrors: false`.
- WebGL2: `contextOptions.requestWebgl1 = false`, verified with `canvas.getContext("webgl2") !== null` after creation; otherwise `WebGL2UnavailableError` is thrown synchronously from `createGlobeRenderer`.
- `CESIUM_BASE_URL`: if the host has not set it, the default is `new URL("cesium/", document.baseURI)`. `Ion.defaultAccessToken` is only set from `opts.ionToken`, and the ion API is never called without a token.
- Matte look: HDR off, FXAA/bloom/AO stages off, no lighting, ground atmosphere off, sky atmosphere kept but darkened and nudged toward Indigo (brightness −0.42, saturation −0.15, hue +0.06), fog on. Background Ink `#0E1020`; globe base colour Graphite `#1C2036` so the silhouette reads where imagery is missing.
- Credits: own credit container, bottom-left, Ink 78 % scrim, 11 px Plex Sans; basemap/context attributions use `showOnScreen = true`; the Cesium ion logo is kept. Mission-step credits go to the lightbox.
- Layer defaults: evidence on at 0.85, QA off at 0.7, context on at 1.0 (no context layer is selected until `setContextLayer`), reference off at 0.6 and created lazily on first show (not fetched before the verdict), ground track on, AOI outline on.
- Evidence and QA rasters for every available step are preloaded at init with `alpha = 0`. Cesium loads them but skips alpha-0 layers at draw time (`GlobeSurfaceTileProvider`), so scrubbing is a pure alpha swap with no flicker. NEAREST magnification is used for data rasters (pixels stay honest).
- Draw order: base → context → evidence → QA → reference. Ground primitives sit on top: AOI amber 2 px; ROI with a 6 px Ink casing + 3 px cyan solid edge (valid) or magenta **dashed** (invalid), 20 %/14 % fill only for simple closed rings; vertices are points with depth test disabled; the selected vertex is larger with a Pearl fill and coloured ring; in draw mode the first vertex is enlarged as the close target.
- Annotations (§10 addendum): one ground polyline primitive with amber dashes (Ink gaps at 45 %), labels in Amber on an Ink 82 % scrim anchored at the ring's northernmost vertex. They persist across rebuilds.
- NISAR: nadir track = clamped ground polyline in Pearl at 70 %, split at ±180 (`splitAtAntimeridian`), rebuilt only when the track array changes (async worker geometry, swapped when ready). Marker = Amber point at orbital height, plus a Pearl nadir line and nadir dot, plus a mono "NISAR" label. No swath.
- Pointer: click = pointer up within 5 px of pointer down. The second click of a double-click (< 400 ms, < 6 px) is swallowed and `dblclick` emits close. Closing hits within 14 px of the first vertex. Hover `pointer` is throttled to 50 ms, using `globe.pick` with an ellipsoid fallback. The `camera` event is throttled to 100 ms.
- Custom camera: initial state = `mission.camera.home` (range = heightM) + `cameraConfig.home` heading/pitch. `flyTo("aoi")` = straight down (pitch −90, heading 0) at `mission.camera.aoi.heightM`, chosen for ROI drawing. Flights use the brand curve `cubic-bezier(0.2,0,0,1)`, 0.9–2.4 s with a range "hop"; they are instant under `reducedMotion`, and any input cancels them.
- Keys use `KeyboardEvent.code` (physical WASD/ZX/QE/RF) on `window`; ignored while suspended, while focus is in input/textarea/select/contenteditable/dialog, or with Ctrl/Meta/Alt; held keys are cleared on blur/visibilitychange/suspend. Wheel: 100 px = 1 notch, clamped ±4 per event. Pinch: log distance ratio → notches. Left-drag pans (grab); right/middle/shift-drag rotates and tilts.
- Quality: `tileCacheSize` and `maximumScreenSpaceError` apply immediately. `resolutionScale = renderScale` and `useBrowserRecommendedResolution = !allow4k` are deferred until the camera has been still for 300 ms (never resize during motion). No VRAM detection.
- Context loss: on `webglcontextlost` (or `forceContextLoss`), status `contextLost` → emit `contextLost` → tear down → rebuild on a new canvas after 50 ms (retries every 400 ms up to 5 s) → re-apply step, layers, ROI, annotations, track, camera, quality and log depth → emit `contextRestored` after 2 frames. `destroy()` also calls `WEBGL_lose_context.loseContext()` to free the GPU context immediately.
- Offline: `offlineOnly`, `navigator.onLine === false`, or no online basemap all mean bundled tiles. Online → bundled switch happens on ≥ 3 hard errors (401/403/429/5xx/network) in 10 s, ≥ 8 errors of any kind, or the window `offline` event. D's `regionalMaxZoom`/`regionalBounds` become a second bundled layer (z6–8 AOI).
- Terrain: ion token → `CesiumTerrainProvider.fromIonAssetId(1)`. Rejection, or 401/403/429 on tile errors, falls back to `EllipsoidTerrainProvider` with status `ELLIPSOID` and a message. No token → message "Ellipsoid terrain — no ion token".
- `ready`: terrain decision settled + `globe.tilesLoaded` after ≥ 3 frames and a tile burst; there is a 20 s safety resolve.

## Log-depth decision (A3)

- `scene.logarithmicDepthBuffer = true` (`LOG_DEPTH_DEFAULT`). On/off measured identical (no artefacts, 165 FPS cap) on the RTX 5070 laptop; see `docs/reports/spike-A3-depth-globe.md`.

## Deviations / additions

- §10 addendum implemented: `setAnnotations(items: GlobeAnnotation[])` plus the exported `GlobeAnnotation` type (the index exports the §5 API + this addition).
- A2 hardening (renderer side, core-sim untouched): a per-cell (~55 m) height cache feeds `undefined` samples, and the "last-known" value passed to `clampCameraHeight` is `max(core-sim lastKnown, last frame floor terrain)`. Without it, 50 % random gaps put the camera 2500 m underground; with it, the minimum is +250 m.
- Bundled context tiles use a transparent-tile discard policy, so fully empty tiles fall back to ancestor tiles.
- The sandbox `dev` script in `packages/renderer-globe/package.json` now points at `sandbox/vite.config.ts` (port 5181, publicDir = app-shell/public, `/cesium` static middleware, `/__data` = repo `data/`).
- `getCanvas()` throws while a context-loss rebuild is in flight (there is no canvas in that window).

## For other agents

- F: set `window.CESIUM_BASE_URL` and serve `node_modules/cesium/Build/Cesium/{Workers,Assets,ThirdParty,Widgets}` at `cesium/` (vite-plugin-static-copy). No `widgets.css` import is needed; the renderer injects its own CSS. The renderer appends a `.br-globe-root` (position:absolute; inset:0) to `container`, so the container needs a size and `position: relative|absolute`.
- D: `context/nisar-gcov/<date>/11/*` contains GIBS artefact tiles (noise band, near-empty speckle, 288-byte empties) and the manifest advertises `maxZoom: 11` for 2025-12-31 and 2026-10-15. Capping GCOV at z10 would look cleaner. s01 evidence is (correctly) near-empty because it is the baseline.

## Unfinished / not measured

- World Terrain path untested on this machine (no ion token); min-spec GPUs and WebView2 not measured.
- No automated visual-regression baseline; screenshots were reviewed by hand (`docs/reports/img-G/`).
- Annotation `kind` is not visually distinguished ("anomaly" and "note" render the same, as specified).

STATUS: DONE
