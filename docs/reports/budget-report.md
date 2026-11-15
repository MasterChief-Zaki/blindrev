# Performance & memory budget report — SPEC §12 (agent X)

Only what was measured on **this** machine, in the **packaged desktop app** (Tauri v2 release exe, WebView2
157.0.4341.46), 2026-11-15. Everything else is `NOT MEASURED` with the reason. Method and raw data:
`docs/reports/spike-A1-route-context-memory.md`, `docs/reports/telemetry/webview2-*.json`, driver `tools/webview2-drive.mjs`.

Machine: RTX 5070 Laptop GPU (`ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU (0x00002D18) Direct3D11 vs_5_0 ps_5_0,
D3D11)`), display 1280×800 CSS @ DPR 2, ~165 Hz. Viewport 1260×760 CSS @ DPR 2 (1920×1080 CSS does not fit this
display). Drawing buffers: hub 2472×1491 px, globe 1260×760 px. Frame times are vsync-capped (165 Hz), so they show
"never missed a vsync", not GPU headroom.

## Frame-time table (§12)

| Preset | tileCacheSize | maxSSE | renderScale | Target                                     | Min-spec GPU result                                 | This machine (RTX 5070 Laptop)                                                                                                                     |
| ------ | ------------- | ------ | ----------- | ------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low    | 100           | 4      | 0.75        | p95 ≤ 33 ms @ 1080p (Iris Xe)              | **NOT MEASURED** — no Iris Xe                       | NOT MEASURED (Low not run)                                                                                                                         |
| Medium | 200           | 2      | 1.0         | p95 ≤ 16.6 ms @ 1080p (GTX 1650 / RX 6400) | **NOT MEASURED** — no GTX 1650 / RX 6400            | Hub p50 6.1 / **p95 6.2 ms**, 165 FPS; Globe p50 6.1 / **p95 6.2 ms**, 165 FPS (20 s each, 3 300 frames, run 2; run 1 globe identical) — PASS here |
| High   | 400           | 1.5    | 1.0         | p95 ≤ 16.6 ms @ 4K (RTX 3050-class)        | **NOT MEASURED** — no RTX 3050-class, no 4K display | NOT MEASURED                                                                                                                                       |

Globe frames were taken at the case's home view, idle, ellipsoid terrain + GIBS imagery (no ion token → no World
Terrain). Hub frames with the hub idle. Neither includes camera motion.

## Other §12 budgets

| Budget                         | Gate                                                                                           | Measured here                                                                                                                                                                | Result                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Route-switch visible blank p95 | ≤ 500 ms, with progress HUD                                                                    | True blank (Ink only, no HUD) p95 **0 ms** over 40 switches; HUD/tunnel hold p95 1 212 ms hub→mission (1.2 s tunnel minimum), 442 ms mission→hub; totals p50 2.21 s / 1.26 s | PASS on true blank; totals reported in A1 report    |
| Context-loss recovery          | 10 × WEBGL_lose_context, 0 unrecovered, ≤ 5 s                                                  | Globe 0/10, max 132 ms; hub 0/10, max 365 ms (worst of 2 runs)                                                                                                               | PASS                                                |
| Soak                           | 30 min, 60 s heap snapshots, peak−baseline ≤ 200 MB, no 5-consecutive rise after 5-min warm-up | 8 min, 30 s snapshots: Δ 27.6 MB (harness) / 30.0 MB (CDP), max consecutive rise 3; upward drift of the post-GC floor (~28 → ~44 MB) noted                                   | **NOT MEASURED (shortened to 8 min)**               |
| GPU process memory             | Windows manual checklist                                                                       | —                                                                                                                                                                            | NOT MEASURED (manual checklist item; not automated) |
| 4K gated to High               | config rule                                                                                    | not exercised                                                                                                                                                                | NOT MEASURED                                        |

## Min-spec GPUs

GTX 1650 4 GB, RX 6400, Intel Iris Xe, RTX 3050-class: **NOT MEASURED** — none available. Run
`node tools/webview2-drive.mjs --scenario measure` on each (after `pnpm desktop:build`), then copy the numbers here.
