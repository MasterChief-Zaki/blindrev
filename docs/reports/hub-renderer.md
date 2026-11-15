# Hub renderer (`@blindrev/renderer-iss`): "the NISAR Hub"

Agent H · 2026-11-15. All numbers were measured on this machine with `packages/renderer-iss/sandbox/harness.mjs` and `tools/shot.mjs`.
Machine: `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU (0x00002D18) Direct3D11 vs_5_0 ps_5_0, D3D11)`, headless Chromium (Playwright 1.65), 1920×1080, DPR 1.
**Min-spec (GTX 1650 / RX 6400 / Iris Xe, Tauri WebView2): NOT MEASURED** (no such hardware or package was available to this agent).

## What it is

A symmetric orbital hall that follows the owner-supplied plate (ARCHITECTURE §10): a chamfered-hexagon viewport with heavy faceted frames, stepped pillars with vertical cyan and magenta strips, low consoles with amber LEDs, a dark glossy floor and indigo-violet dusk. Through the viewport you see **Earth** (NASA Blue Marble day map, night lights, clouds, ocean glint, a restrained cyan limb line) and **NISAR** (the NASA/JPL glTF) as the centrepiece. **Four worlds** float in a crescent below it. Each is a low-poly hex diorama in its theme's 3-step ramp:
01 The Sinking City (clay ramp, a town tilting into a subsidence bowl, aqueduct line) · 02 The Green Kingdom (forest) · 03 The Drowned World (wetland water) · 04 The Frozen Frontier (glacier ridge and bergs).
Under each world is a CRT label screen (CanvasTexture: case number, caseId, kicker, title, amber "OBJECTIVE · Find the evidence." task light, or a lock glyph with the word "Locked"). Locked worlds are dimmed toward Ink and sit on matte indigo rings.
Extra details: two caged amber lanterns, a magenta cloth banner with the cyan hex-ring mark, cable runs, and a telemetry strip over the viewport (`NISAR 36.40°N 119.60°W 747 km PROPAGATED`).

Screenshots (1920×1080, reviewed): `packages/renderer-iss/sandbox/shots/` holds `hub-medium.png`, `hub-focus.png`, `hub-low.png`, `hub-reduced-motion.png`, `hub-bloom-mask.png` and `hub-after-10-context-loss.png`.

## API (ARCHITECTURE §5, unchanged)

`createHubRenderer(opts)` throws `WebGL2UnavailableError` **synchronously** when no WebGL2 context can be created. Every later failure **rejects `ready`**: a 15 s timeout, or destroy before ready. It never hangs.
A missing NISAR model or missing Earth textures only log a warning and degrade: no spacecraft, or a plain Earth.
`missions[i]` maps to world slot i (0..3). Slots beyond the array show "NO SIGNAL".
Pointer hover emits `missionFocus(id | null)`, also for locked worlds. Clicking an unlocked world or its label emits `missionSelect(id)`. Clicking a locked one emits nothing.
`focusMission(id)` draws the same highlight (cyan frame + check badge + "SELECTED" / "Open case ›" text) and **does not** emit `missionFocus`. Pointer hover takes precedence over programmatic focus while the pointer is over a world.
`setNisar(state)` redraws the telemetry strip (at most when the value changes) and re-anchors the Earth so the sub-satellite point lies under the NISAR exhibit, with the ground track heading taken from `velEcefMps`. Between updates the Earth is extrapolated along-track at the NISAR orbital rate (~99.8 min period). Under reduced motion it is static and snaps on each update. `null` uses a fallback over the mission AOI.

## Measurements (this machine)

| Item                                                                                                           | Result                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ready` (fresh page, cold GPU shader cache)                                                                    | **0.89–1.16 s** across runs (Medium). Breakdown of one run: fonts 0.12 s · 1k Earth + NISAR loaded 0.15 s · async shader compile 0.81 s · first composed frame 1.01 s                                                                |
| `ready` on re-create (warm program cache)                                                                      | **0.23–0.36 s** (5 remounts: 265, 251, 259, 281, 361 ms)                                                                                                                                                                             |
| Frame time (rAF, vsync-capped), Medium, 6 s                                                                    | p50 16.7 ms · p95 16.8 ms · **60.0 FPS**                                                                                                                                                                                             |
| Uncapped frame cost, full path, Medium                                                                         | 2.18 ms avg / 2.50 ms p95 (see spike-A3-hub-bloom.md)                                                                                                                                                                                |
| Draw calls / triangles (Medium, all passes)                                                                    | 142 / 69,698                                                                                                                                                                                                                         |
| 10 forced context-loss cycles (`forceContextLoss` → `contextLost` → `forceContextRestore` → `contextRestored`) | **10/10 recovered**, recovery 228–365 ms. Frames keep rendering after every cycle (17–18 frames in the following 250 ms). The post-cycle screenshot shows the full scene (Earth 4k, NISAR env map, shadows, bloom). 0 console errors |
| destroy → re-create ×5                                                                                         | old contexts `isContextLost() === true` 5/5 · 1 canvas in the DOM · JS heap 31.9 MB before → 28.4 MB after (precise memory info, after `gc()`)                                                                                       |
| final `destroy()`                                                                                              | context lost: true · canvases in DOM: 0                                                                                                                                                                                              |
| Reduced motion (`?rm=1`, pointer moved across the screen, 1.2 s apart)                                         | 0 differing pixels (static camera, no parallax/sway/bob/scan sweep, instant focus gain)                                                                                                                                              |
| Pointer                                                                                                        | hover active → `focus:sinking-city`, click → `select:sinking-city`, hover locked → `focus:green-kingdom`, click locked → nothing, leave → `focus:null`                                                                               |

Fixes that produced these numbers, worth knowing if anything changes:

1. `PCFSoftShadowMap` is remapped to `PCFShadowMap` at render time in three r187. That invalidates every program compiled up-front and caused a ~2.5 s synchronous recompile. The renderer now uses `PCFShadowMap` explicitly.
2. `compileAsync` must run with the composer's input buffer bound. Program variants depend on the output target (sRGB screen vs linear half-float), and compiling for the screen meant compiling everything twice. Cold `ready` went from 3–6 s to about 1 s.
3. `restoreContext()` is ignored while `webglcontextlost` is still being dispatched, for example when called from a promise continuation of a `contextLost` listener. `forceContextRestore()` therefore defers to the next task.
4. On restore, only GPU-generated content is rebuilt (composer, PMREM environment, shadow map). Resources from the dead context are never `dispose()`d on the new one, which avoids the "object does not belong to this context" warnings.

## Engineering notes

- Quality preset: `pixelRatio = min(devicePixelRatio, 2) × renderScale`, capped at 2560×1440 pixels (3840×2160 if `allow4k`). This is set at mount and on container resize only, never on pointer interaction. Low means MSAA 0, no shadows, 96-segment Earth, 5 bloom levels.
- Static geometry is merged per material (`Batch`). Shadows come from one directional light with `shadowMap.autoUpdate = false`, rendered once and again after a restore.
- Assets: 1k Earth first (68 kB + 150 kB), then the 4k Earth (1.05 MB + 2.76 MB) swaps in progressively via `ImageBitmapLoader` + `initTexture`. NISAR glTF is about 2.1 MB. Fonts wait up to 700 ms, and labels are redrawn on `document.fonts` `loadingdone`.
- `destroy()` stops the loop, removes all listeners and the ResizeObserver, disposes every geometry, material, texture (including shader-uniform textures), shadow map, PMREM target and composer, closes ImageBitmaps, calls `renderer.dispose()` + `forceContextLoss()`, and removes the canvas. It is idempotent.

## HUD-safe areas (for the app agent F)

At 16:9: **bottom 20 % (y > 80 %)** is floor only, dark and calm. **Left 0–12 % and right 88–100 %** are the pillars: dark, with only thin vertical strips at about x 1–2 %, 6–7 %, 93 % and 98–99 %. **Top 0–12 %** is the dark ceiling frame.
The worlds and labels occupy roughly x 12–88 %, y 38–75 %. The active world (01) and its label sit at about x 12–29 %, y 41–70 %, so a centre-left mission card at those coordinates would cover it.
Suggestions: put the mission card bottom-left (y > 72 %) or on the left pillar band with a scrim, and keep buttons in the bottom band.
Narrower aspects keep the horizontal field of view (the vertical FOV widens), so the hall adds floor and ceiling rather than cropping the worlds.

## Unfinished / not done

- Min-spec GPU and Tauri WebView2 runs: NOT MEASURED.
- 30-min soak with heap snapshots: NOT MEASURED. Only the 5× remount heap check above was done.
- No real-time sun ephemeris: the sun direction is art-directed so the Earth always shows a lit limb.
- The NISAR reflector is the source model's semi-transparent mesh. Its rendering order against the halo is approximate.
