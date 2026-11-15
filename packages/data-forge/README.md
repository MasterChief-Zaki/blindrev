# @blindrev/data-forge

Build-time data pipeline for BlindRev (Node + `tsx`). Owns `data/missions/sinking-city.json`,
`data/prefabs/basemap.json`, `data/assets.manifest.json`, `packages/app-shell/public/mission-data/**`
and `packages/app-shell/public/offline-tiles/**`.

| Script (`pnpm --filter @blindrev/data-forge <script>`) | Network | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch`                                                | yes     | Fetches NASA GIBS tiles (≤ 6 parallel, 3 retries, resumable, prunes tiles no longer in the job list) into `public/offline-tiles/bluemarble/` and `public/mission-data/sinking-city/context/`, writes their `ASSET_LICENSE.json` and `fetch-report.json` (counts, bytes, failures). `--only basemap\|context`, `--dry-run`.                                                                                                                                                                      |
| `forge`                                                | no      | Deterministic: SIMULATED evidence rasters + QA masks + `.f32` probe grids, the authored reference mask, `data/missions/sinking-city.json`, `data/prefabs/basemap.json`, and the PENDING-path fixture (`data/missions/_fixture-pending.example.json` + `public/mission-data/_fixture-pending/`). `--pending` builds only the fixture; `--out DIR` writes into DIR (mirrors the repo layout). If `sinking-city.json` says `aoi.decision: "PENDING"`, the mission itself becomes the TEST_FIXTURE. |
| `manifest`                                             | no      | Rebuilds `data/assets.manifest.json`: every file under `public/` except `cesium/` and dotfiles, with path, bytes, sha256, license/attribution/source from the nearest `ASSET_LICENSE.json` (same folder or an ancestor), and `deterministic` (the licence record says `"deterministic": true`). Re-run it after adding any asset.                                                                                                                                                               |
| `verify`                                               | no      | CI gate, exit 1 on any error: Zod validation of every `data/**/*.json`; mission URL references + mask size/sha256; manifest sha256 + orphans both ways + unreferenced mission-data + LFS pointer files; mandatory licence + attribution; Git LFS coverage (`git check-attr filter` on every binary asset); re-forge into a temp dir → identical sha256. `--skip-reforge` for a quick loop.                                                                                                      |
| `gate-b`                                               | no      | Measures Spike B (sources, QA coverage per step, mask registration vs core-sim `rasterizeRings`, two-run determinism, `scoreRoi` tiers + digest stability, no-acquisition steps) and prints a markdown table; writes `gate-b.json`.                                                                                                                                                                                                                                                             |
| `all`                                                  | no      | `forge` → `manifest` → `verify`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Typical loop: `fetch` once (needs network), then `forge`, `manifest`, `verify`.

## Outputs (runtime URLs are relative to the app base)

- `mission-data/sinking-city/evidence/<stepId>.png` — 1024 × 1024 EPSG:4326 over the AOI bounds, indexed PNG
  (0 transparent, 1 LOW `#8F5236`, 2 MID `#C9784A`, 3 HIGH `#E2B08A`, flat and opaque). Transparent below 12 mm and where QA is invalid.
- `mission-data/sinking-city/evidence/<stepId>.f32` — 512 × 512 Float32 little-endian, mm LOS, NaN = invalid, row 0 = north.
  Not a field of `TemporalStep`; listed with grid metadata in `mission-data/sinking-city/evidence/index.json` (for the cursor probe).
- `mission-data/sinking-city/qa/<stepId>.bin|.png` — 512 × 512 Uint8 (1 = valid) + hatched display PNG on the same grid.
- `mission-data/sinking-city/reference/mask-v1.bin|.png` — the authored answer key (512 × 512).
- `mission-data/sinking-city/context/<layer>/<date>/{z}/{y}/{x}.<ext>` — real GIBS tiles (EPSG:3857): HLS S30 30 m true colour (default optical view, AOI ± 0.3°), MODIS Terra, NISAR GCOV radar (z6–10, QA-clean).
- `offline-tiles/bluemarble/{z}/{y}/{x}.jpeg` — global z0–5 + regional z6–8 (AOI ± 2°).

All masks share one GridSpec (512 × 512, the AOI bounds), as `scoreRoi` requires. `MaskAsset.sha256` is the SHA-256 of the shipped `.bin`.

## Determinism

No `Math.random`, no clock, no zlib on the write path: PNGs come from a built-in deflate encoder
(`src/png.ts`, LZ77 + fixed Huffman), because Node's bundled zlib may pick CPU-specific code paths
and produce different bytes for the same pixels. Noise is a position-hashed value noise (seeds in `src/config.ts`),
and per-step parameters come from core-sim's `mulberry32`. Every field is a pure function of
(lon, lat, step), so the 512² and 1024² rasters are registered exactly.

## Honesty labels

Displacement and coherence values are **SIMULATED** (real NISAR GUNW products need an Earthdata login and
heavy preprocessing). Only the acquisition dates, times, track 042, frame 070 and the DESCENDING direction are real
(NASA CMR / ASF NISAR catalogue). The reference mask is authored and is not a scientific product. Context imagery is real NASA GIBS imagery.

Context tile QA: `src/tile-qa.ts` flags holes, near-uniform tiles and noise inside the expected footprint. `verify` enforces it up to every layer's advertised maxZoom. `tsx src/tile-qa.ts mosaic <dateDir> <z> <out.png>` composites a window for an eyeball check.
Optical date finder: `tsx src/probe-optical.ts <GIBS layer> <from> <to>` (coverage and cloud fraction per day; network).

Dev aids: `tsx src/preview.ts <stepId> <out.png> [--reference]` (composite preview), `tsx src/author-polygons.ts`
(how the frozen answer-key vertices in `src/reference.ts` were proposed).
