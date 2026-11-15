# Spike A3 — logarithmic depth on the mission globe (renderer-globe, agent G)

Gate (SPEC §2, globe half): `scene.logarithmicDepthBuffer` true vs false against the exact stack; pass = no
z-fighting / depth artefacts and 60 FPS. (Hub bloom is agent H's half.)

## Setup (this machine, 2026-11-15)

- GPU / renderer string: `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU (0x00002D18) Direct3D11 vs_5_0 ps_5_0, D3D11)`,
  headless Chromium via `tools/shot.mjs` (GPU mode), 1920×1080, DPR 1, preset `medium`, MSAA 4, no post-processing.
- Stack in every shot: ellipsoid terrain (no ion token → **World Terrain NOT MEASURED**) + online GIBS Blue Marble base +
  bundled GIBS MODIS context layer (2026-10-15) + SIMULATED evidence raster s09 + hatched QA mask + reference-polygon ROI
  (ground primitives: fill, casing, edges, clamped points) + two amber dashed annotations + AOI outline + NISAR
  nadir ground track (ground polyline) + satellite marker at orbital height (~755 km) + nadir line + label.
  NISAR time = closest pass over the AOI within 48 h of 2026-11-15T12:00Z (`t=aoipass`).
- Toggle: sandbox `?logdepth=0|1` (internal `setLogDepth`, reflected in `GlobeStatus.logDepth`).

## Results

| View                                                                 | logDepth | FPS (3 s rAF) | p50 / p95 ms | Depth artefacts seen |
| -------------------------------------------------------------------- | -------- | ------------- | ------------ | -------------------- |
| wide: 1500 km range, pitch −28°, AOI + track + nadir line to orbit   | true     | 165.2         | 6.1 / 6.2    | none                 |
| wide                                                                 | false    | 165.1         | 6.1 / 6.2    | none                 |
| close: 2.5 km range, pitch −12°, grazing ROI/annotation ground lines | true     | 165.2         | 6.1 / 6.2    | none                 |
| close                                                                | false    | 165.2         | 6.1 / 6.2    | none                 |

Screenshots: `docs/reports/img-G/a3-wide-ld1.png`, `a3-wide-ld0.png`, `a3-close-ld1.png`, `a3-close-ld0.png`.
The pairs look identical. In both modes, ground polylines alias slightly at grazing angles; that is line rasterisation,
not depth fighting.

## Decision

**`logarithmicDepthBuffer = true`** (Cesium's default), exposed as `GlobeStatus.logDepth` and set from
`LOG_DEPTH_DEFAULT` in `src/globe.ts`. Rationale: there is no measurable cost and no visible difference on this stack. Log depth
keeps the orbital-height marker and the near-surface ground primitives in a single frustum, where the alternative is
Cesium's multi-frustum fallback. It is also the configuration Cesium tests ground primitives with. If min-spec GPUs show
artefacts or cost, flip `LOG_DEPTH_DEFAULT`.

## Not measured

- World Terrain (quantized-mesh) under the stack: no ion token here.
- Min-spec GPUs and Tauri WebView2: NOT MEASURED. The 165 FPS ceiling looks like the rAF/display cap, not GPU headroom.
