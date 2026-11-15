# Spike A2 — custom ENU camera / terrain clamp (renderer-globe, agent G)

Gate (SPEC §2): custom ENU controller under the adversarial suite (forced terrain-load gaps, steep slopes,
poles |φ| ≥ 89.5°, antimeridian, keyboard-only, wheel/pointer). Pass = zero underground camera clipping anywhere
in the suite and 60 FPS maintained.

## Setup (this machine, 2026-11-15)

- GPU / renderer string observed: `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU (0x00002D18) Direct3D11 vs_5_0 ps_5_0, D3D11)`,
  headless Chromium (Playwright, `tools/shot.mjs`, GPU mode), 1920×1080, deviceScaleFactor 1, quality preset `medium`.
- Stack: ellipsoid terrain (no Cesium ion token on this machine → World Terrain **NOT MEASURED**), online NASA GIBS
  Blue Marble base, mission evidence s09 + overlays, real mission manifest `data/missions/sinking-city.json`.
- Controller: `packages/renderer-globe/src/globe.ts` (`stepCustomCamera` / `applyCamera`) on top of core-sim
  `stepCamera`, `wheelZoom`, `sanitizeCamState`, `solveCameraFrame` (≥ 5 `getHeight` samples camera→target,
  `clampCameraHeight`). Fixed 1/60 s timestep, real dt clamped to 0.1 s, ≤ 6 sub-steps/frame.
- Camera config: `data/prefabs/camera.json` (minClearance 250 m, minEllipsoidalHeight 500 m, rangeMin 800 m, lat clamp 89.5°).
- Harness: `packages/renderer-globe/sandbox/a2.ts`, run with
  `node tools/shot.mjs --url "http://localhost:5181/?view=aoi&step=8&ui=0" --eval "window.__sandbox.runA2()"`.
  Inputs go through the real code paths: `KeyboardEvent` on `window`, `WheelEvent` and `PointerEvent` on the canvas.
  Terrain gaps / steep terrain are injected by replacing the clamp's height sampler (`debug.heightSampler`); the
  "truth" terrain (`debug.truthTerrain`) is used only for the underground metric. Gap patterns are seeded (mulberry32, 2026).

Metrics per frame: `aboveTruth = cameraHeight − trueTerrain(camera nadir)` (< 0 = underground clipping),
`aboveFloor = cameraHeight − appliedClampFloor`, NaN count, rAF FPS and frame-time p50/p95.

## Results (second run, after the gap hardening below)

| Scenario                                                          | Frames | min above truth (m) | min above floor (m) | NaN | FPS    | p50 / p95 ms |
| ----------------------------------------------------------------- | ------ | ------------------- | ------------------- | --- | ------ | ------------ |
| pole-north (89.4°→wall, W/D/A/E/X keys only)                      | 405    | 2598.08             | 2097.91             | 0   | 106.35 | 11.9 / 12.2  |
| pole-south (−89.45°, pitch −90°, wheel to rangeMin)               | 259    | 800.00              | 284.04              | 0   | 102.84 | 6.3 / 18.2   |
| antimeridian (±180 east then west)                                | 704    | 500.02              | 0.00                | 0   | 162.24 | 6.1 / 6.2    |
| steep-cliffs (3000 m walls / ~0.02°, pitch −15°)                  | 572    | 250.00              | 0.00                | 0   | 164.74 | 6.1 / 6.2    |
| ramp-45deg (1:1 slope to 6000 m, rangeMin)                        | 578    | 1024.40             | 23.66               | 0   | 163.55 | 6.1 / 6.2    |
| terrain-gaps-50pct (50 % samples undefined over cliffs)           | 466    | 250.00              | 0.00                | 0   | 165.00 | 6.1 / 6.2    |
| terrain-gap-total-uphill (all samples undefined) — informative    | 335    | 500.00              | 0.00                | 0   | 165.02 | 6.1 / 6.2    |
| pointer drag + right-drag rotate + F + wheel (real globe heights) | 432    | 750.13              | 250.13              | 0   | 165.07 | 6.1 / 6.2    |

Verdict on this machine: **PASS**: 0 NaN frames, 0 underground frames, the camera never went below the clamp floor,
and frame rate stayed ≥ 60 FPS throughout (the lowest scenario mean was 102.8 FPS; 165 FPS appears to be the rAF/display
cap). The pole scenarios include first-time tile loading of polar tiles, which explains their higher p50/p95.

### First run (before hardening) — kept for the record

`terrain-gaps-50pct`: **min above truth −2500 m** (underground). Cause: core-sim's `clampCameraHeight` uses
`lastKnownTerrainM` = max of the _current frame's_ defined samples. When the camera's own sample is the missing one and
the defined samples happen to lie in a valley, "last-known" is the valley height. Fix (renderer side, no core-sim
change): (1) the sampler remembers the last observed height per ~55 m cell (bounded 20 000-cell cache) and returns it when
`getHeight` is `undefined`; (2) the last-known value passed to core-sim is `max(core-sim lastKnown, last frame's floor
terrain)`, so the camera never descends into terrain it cannot currently see. All other scenarios were unchanged between runs.

## Caveats / not measured

- `terrain-gap-total-uphill` is **non-discriminating as run**: at rangeMin, v(h)=k·h gives ≈ 50 m/s, and the camera sat
  behind the target, west of where the ramp starts, so it never flew over terrain that is higher and was never observed. No clamp can avoid
  terrain that was never observed. In real Cesium, `getHeight` returns `undefined` only when no tile at all is loaded for
  that spot (level-0 tiles load first). This scenario is excluded from the gate.
- World Terrain (real steep DEM): **NOT MEASURED** — no ion token on this machine. Steep terrain was synthetic.
- Min-spec GPUs (GTX 1650 / RX 6400 / Iris Xe) and Tauri WebView2: **NOT MEASURED**.
- Headless rAF timing is a proxy; it is not a WebView2 frame-time capture.
