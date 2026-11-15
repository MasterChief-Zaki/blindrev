# Decisions — agent H (renderer-iss, the NISAR Hub)

## Asset sources + licenses

- NISAR spacecraft glTF (`app-shell/public/models/nisar/`): NASA/JPL-Caltech, NASA Eyes on the Earth asset (https://eyes.nasa.gov/assets/static/models/sc_nisar/Nisar.gltf). Byte-identical copy of `../sars/assets/nisar_model/`. The SOURCE.txt caveat (Eyes asset, not NASA 3D Resources; check NASA media usage terms before public redistribution) is carried into `ASSET_LICENSE.json`.
- Earth day map: NASA Visible Earth "Blue Marble: Land Surface, Shallow Water, and Shaded Topography" (NASA GSFC, 2002), public domain, fetched via Wikimedia Commons `File:Whole_world_-_land_and_oceans_12000.jpg`. eoimages.gsfc.nasa.gov was unreachable from this machine.
- Night lights: NASA Earth Observatory "The earth at night" (Suomi NPP VIIRS, 2012), public domain, via Wikimedia Commons.
- Clouds: Solar System Scope `8k_earth_clouds.jpg`, **CC BY 4.0**. This is the only non-public-domain texture, and the attribution is in `textures/hub/ASSET_LICENSE.json`.
- Derived files: 4k + 1k day maps, and 4k + 1k "aux" textures that pack R = night, G = clouds, B = water mask (derived from the day map). Made with Pillow, from scratch-dir downloads.
- Fonts in the sandbox only: `@fontsource/*` aliased from `packages/ui-hud/node_modules` in `sandbox/vite.config.ts`, read-only. No dependency was added.

## Design choices

- ARCHITECTURE §10 addendum adopted mid-build. The hall is a 3D version of the owner's plate: chamfered-hex viewport, stepped pillars with cyan + magenta strips, low consoles with amber LEDs, glossy dark floor, indigo-violet dusk sky shader, and the Earth limb as the cyan horizon line. NISAR is the centrepiece, with four hex world dioramas in a crescent below it. My earlier command-board CRT screens became the world labels.
- Bloom selection holds only fringe accents in active states: pillar strips, lantern glass, console LEDs, the active world's ring, the amber task light, the selection frame + check, and the focused unlocked label (only while focused). Locked rings are matte indigo.
- Earth orientation is driven by `setNisar`: the sub-satellite point sits under the exhibit, the heading comes from `velEcefMps`, and between updates the Earth is extrapolated along-track at the NISAR orbital rate. The sun direction is **art-directed**, not ephemeris.
- The telemetry strip labels the value `PROPAGATED` (never "live"). `null` shows "No ephemeris loaded / STANDBY". The sandbox uses a fixed SAMPLE state, labelled as such in code.
- Tone mapping: postprocessing `ToneMappingMode.NEUTRAL`, chosen to keep the locked token hues close. Vignette 0.55.
- Shadows: one directional light, `PCFShadowMap`, rendered once (`autoUpdate = false`). Low preset has no shadows and no MSAA.
- `focusMission()` does not emit `missionFocus` (avoids loops with the DOM HUD). Pointer hover overrides it while the pointer is over a world. Hovering a locked world emits focus; clicking it emits nothing.

## Deviations

- `HubRendererOptions.nisar` / `setNisar` are typed as a local structural `HubOrbitState` (timeIso, lonDeg, latDeg, heightM, optional velEcefMps/ecefM), not the core-sim `OrbitState`. core-sim's orbit module was empty when I started. Any `OrbitState` is assignable to it, so callers are unaffected.
- `createHubRenderer` throws `WebGL2UnavailableError` synchronously (§5 contract). All later failures reject `ready` (15 s timeout, destroy-before-ready). Asset failures degrade with a warning instead of rejecting.
- `forceContextRestore()` defers `restoreContext()` by one task. Chrome ignores it during the `webglcontextlost` dispatch.
- The sandbox `dev` script is now `vite --config sandbox/vite.config.ts` (port 5182, strictPort, publicDir = app-shell/public).
- An internal `__debug` handle (bloom-mask view, frame times/count, synchronous benchmark, label screen positions, info) is on the returned object but not in the public types.

## Unfinished

- Min-spec GPU / Tauri WebView2 measurements: NOT MEASURED. 30-min soak: NOT MEASURED.
- No unit tests (`vitest --passWithNoTests`). Verification is the Playwright harness `sandbox/harness.mjs` plus screenshots in `sandbox/shots/`.
- NISAR reflector transparency sorting against the atmosphere halo is approximate.

STATUS: DONE
