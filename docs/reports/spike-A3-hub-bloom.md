# Spike A3 (hub half): selective bloom limited to the four fringe accents

Agent H · 2026-11-15 · package `@blindrev/renderer-iss`

## Gate (SPEC §2 A3, hub part)

"Hub selective bloom restricted to the four fringe accents. Pass: … 60 FPS maintained with bloom."

## Verdict

**PASS on this machine.** Evidence below. Min-spec GPUs (GTX 1650 / RX 6400 / Iris Xe): **NOT MEASURED**, because no such hardware was available to this agent. The manual GPU checklist has to cover them.

## Pipeline

- `WebGLRenderer` on an explicit `canvas.getContext("webgl2", { powerPreference: "high-performance", antialias: false })` context. `renderer.toneMapping = NoToneMapping`; tone mapping happens in post.
- pmndrs `postprocessing` 6.39.6 `EffectComposer({ frameBufferType: HalfFloatType, multisampling: 4 })` (0 on Low). Chain: `RenderPass` → one `EffectPass(SelectiveBloomEffect, VignetteEffect, ToneMappingEffect(NEUTRAL))`.
- `SelectiveBloomEffect`: `mipmapBlur`, threshold 0.22, smoothing 0.35, intensity 1.35, radius 0.62, `ignoreBackground = true`. Its `Selection` uses render layer 11 (`BLOOM_LAYER`). Only meshes explicitly added to the selection are rendered into the bloom input. Everything else is depth-masked out by the effect.
- Bloom selection, the complete list returned by the debug API (`__debug.info().bloomSelection`):
  `accent-strip-cyan ×2, accent-strip-magenta ×2` (pillar light strips) · `accent-amber-indicator ×4` (console LEDs) · `accent-lamp-glass ×2` (caged lanterns) · `accent-world-ring` (active world's hex ring, cyan) · `accent-task-light-0` (amber objective light) · `accent-selection-frame`, `accent-check`, `accent-check-ring` (cyan selection cue) · **plus the focused, unlocked label screen only while it is focused** (`label-0`).
  Earth, atmosphere, stars, sky, hull, pillars, consoles, floor, worlds, banner and the NISAR model are never added.
- Indigo is represented by the locked worlds' rings, which are matte (`MeshStandardMaterial`) and deliberately **not** in the bloom set: brand rule "emit only for active/selected states".
- Reduced motion: focus gain changes are instant. There are no bloom-intensity transitions.

## Mask proof

Debug view `?view=bloomMask` sets `camera.layers` to the selection layer and renders on black without post. It shows exactly what can feed the bloom:
`packages/renderer-iss/sandbox/shots/hub-bloom-mask.png` contains only the strips, lantern glass, amber LEDs, the active ring and task light, the selection frame and check, and the focused label. There is no Earth, hull, console, world or NISAR pixel. (This view skips depth occlusion by non-selected meshes. The real bloom pass does occlude.)

## Measurements (this machine)

- GPU / renderer string: `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU (0x00002D18) Direct3D11 vs_5_0 ps_5_0, D3D11)`, headless Chromium (Playwright 1.65), 1920×1080, DPR 1.
- rAF frame-time sample, medium preset (MSAA 4, shadows on, bloom on), 360 frames over 6 s: **p50 16.7 ms, p95 16.8 ms, 60.0 FPS**. This is vsync-capped, so it shows no dropped frames, not how much headroom is left.
- Uncapped per-frame cost: 120 back-to-back frames, each followed by a 1-pixel `readPixels` to force a GPU round trip (`gl.finish()` does not block in Chrome, so it was rejected as a sync method). Includes CPU time:

| Preset | Pixel ratio · MSAA · shadows           | Full shipping path (post + bloom) avg / p95 | Scene only, no post avg / p95 |
| ------ | -------------------------------------- | ------------------------------------------- | ----------------------------- |
| Low    | 0.75 · 0 · off                         | 1.51 / 1.70 ms                              | 0.93 / 1.20 ms                |
| Medium | 1.0 · 4 · on                           | 2.18 / 2.50 ms                              | 1.12 / 1.50 ms                |
| High   | 1.0 · 4 · on (same as Medium at DPR 1) | 2.40 / 2.80 ms                              | 1.19 / 1.50 ms                |

The HDR + selective bloom + tone-mapping chain costs about 1.05 ms per frame at 1080p Medium on this GPU.

- Scene budget at Medium: **142 draw calls** (all passes of one frame, `renderer.info` with manual reset), **69,698 triangles**, 26 programs, 39 textures.

## Not measured

- Min-spec GPUs and Tauri WebView2: NOT MEASURED (no hardware/package available to agent H).
- Bloom cost in isolation from MSAA/tone mapping: NOT MEASURED. Only the whole post chain against no post was compared.
