# Spike B — MVP subsidence data (agent D)

Measured 2026-11-15 with `pnpm --filter @blindrev/data-forge gate-b` (numbers below are copied from that run),
plus `verify`, the vitest suite and a byte-level hash diff of two in-place forge runs. Everything is offline
except the one-time `fetch`.

**Verdict: PASS on every Spike B criterion this agent can measure.** Two items are out of scope here and marked NOT MEASURED.
The displacement product is a documented **SIMULATED** fallback (spec §5 step 3); the acquisition metadata is real.

| Gate B criterion (spec §2)             | Result           | Evidence                                                                                                                                                                 |
| -------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Availability proven                    | PASS             | GIBS: 1403/1403 Blue Marble, 148/148 HLS S30, 56/56 MODIS, 112/112 NISAR GCOV tiles, 0 failures, 0 tile-QA defects. NISAR catalogue: 7 real track-042 acquisitions used. |
| Licence / attribution captured         | PASS             | Every forge/fetch folder has an `ASSET_LICENSE.json`. `verify`: 1809/1809 public files licensed, 1779/1779 binaries tracked by Git LFS, verify PASS.                     |
| QA valid-pixel coverage ≥ 60 %         | PASS             | 75.5–78.1 % on all 7 available steps (table below)                                                                                                                       |
| Mask registration ≤ 1 px               | PASS (0 px)      | Independent PNPOLY raster vs core-sim `rasterizeRings`: 0 / 262 144 pixels differ                                                                                        |
| Scoring bit-deterministic              | PASS             | 10 ROI cases × 2 runs: identical outcomes and digests                                                                                                                    |
| Provenance + sensor diagnostics        | PASS (data side) | Each step has its real GCOV/GUNW granule ids, track/frame/direction, LOS vector, incidence and uncertainty. A low-coherence ROI returns `QA_DIAGNOSTIC LOW_COHERENCE`.   |
| Explicit "No acquisition" states       | PASS (data side) | s02 (2026-02-05) and s07 (2026-08-04) are real catalogue gaps: `isAvailable:false`, `tileUrlTemplate ""`, no masks                                                       |
| Zero date interpolation                | PASS             | 0 steps carry interpolated data; 9/9 step dates fall on track 042's real 12-day repeat grid                                                                              |
| "No acquisition" _rendered_ in the HUD | NOT MEASURED     | That is F/U's UI work; this agent only ships the data                                                                                                                    |

## Sources

| Source                                                                                                                                                          | Availability                                                                                                                      | Licence                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GIBS `BlueMarble_ShadedRelief_Bathymetry` 2004-08-01 (global z0–5, AOI ± 2° z6–8)                                                                               | 1403/1403 tiles, 11.25 MB, 0 failures                                                                                             | NASA open data (CC0 for NASA-mission data) + the GIBS acknowledgement |
| GIBS `HLS_S30_Nadir_BRDF_Adjusted_Reflectance` (Sentinel-2, 30 m), AOI ± 0.3°: 2026-10-17 at z8–11 (default optical view, listed first) and 2026-06-29 at z8–10 | 148/148 tiles, 19.69 MB. Tile QA: 0 bad tiles; 100 % window coverage and ≤ 0.2 % cloud (probe-optical, z7)                        | NASA open data; contains modified Copernicus Sentinel-2 data          |
| GIBS `MODIS_Terra_CorrectedReflectance_TrueColor` z5–9, 7 step dates                                                                                            | 56/56 tiles, 0.57 MB. Overcast on 2025-12-31 (real; labelled "(overcast)")                                                        | same                                                                  |
| GIBS `NISAR_L2_Geocoded_Polarimetric_Covariance` z6–10, 7 step dates                                                                                            | 112/112 tiles, 9.95 MB. Tile QA: 0 bad tiles inside the frame footprint; the 7 transparent tiles lie outside the swath (expected) | same                                                                  |
| NISAR catalogue, track 042 DESCENDING frame 070 (NASA CMR collection C2854335566-ASF + `../sars/EDA/data`)                                                      | 27 GUNW pairs and 30 GCOV dates (2025-11-01 → 2026-10-27). Cycles 012 and 027 are missing. 7 dates used                           | metadata only                                                         |
| Displacement / coherence values                                                                                                                                 | SIMULATED. Real GUNW needs an Earthdata login plus unwrapping/time-series preprocessing (blocker)                                 | CC0-1.0 (forge output)                                                |

**Tile QA** (`src/tile-qa.ts`, enforced by `verify`) flags four kinds of bad tile:

- a hole: under 97 % opaque inside the expected footprint, inset 0.03°;
- near-uniform (σ < 2);
- noise: neighbour-difference / σ above 0.9, where white noise is about 1.13;
- missing or undecodable.

The z11 radar tiles from GIBS failed this check:

- 9 of 36 bad on 2025-12-31 and 10 of 36 bad on 2026-10-15 (holes, a uniform band, speckle);
- G saw these on the globe as Blue Marble showing through, noise blocks and a white band.

The radar layer is therefore capped at z10, which is clean on all 7 dates (16/16 tiles each). Mosaics of z10 for s01 and s09, and of HLS z11 for 2026-10-17, were composited and checked by eye: no holes and no noise blocks.

GIBS terms are quoted verbatim in every licence record. Source: https://nasa-gibs.github.io/gibs-api-docs/#data-use-guidance-and-acknowledgements
and NASA Earthdata "Data Use and Citation Guidance".

## QA valid-pixel coverage (512 × 512 grid = whole AOI)

| Step | Date       | Available             | Valid px | Coverage | ≥ 60 % |
| ---- | ---------- | --------------------- | -------- | -------- | ------ |
| s01  | 2025-12-31 | yes                   | 203217   | 77.5 %   | PASS   |
| s02  | 2026-02-05 | no — "No acquisition" | —        | —        | n/a    |
| s03  | 2026-03-13 | yes                   | 201442   | 76.8 %   | PASS   |
| s04  | 2026-04-18 | yes                   | 203784   | 77.7 %   | PASS   |
| s05  | 2026-05-24 | yes                   | 197872   | 75.5 %   | PASS   |
| s06  | 2026-06-29 | yes                   | 199918   | 76.3 %   | PASS   |
| s07  | 2026-08-04 | no — "No acquisition" | —        | —        | n/a    |
| s08  | 2026-09-09 | yes                   | 203356   | 77.6 %   | PASS   |
| s09  | 2026-10-15 | yes                   | 204851   | 78.1 %   | PASS   |

Invalid pixels come from three sources:

- The SE corner of the AOI lies outside frame 042_D_070. This uses the real CMR footprint, so it is real swath geometry.
- A persistent low-coherence zone in the west (simulated).
- Per-pass cropland decorrelation in ~0.5-mile field cells (simulated).

## Mask registration

- Reference mask `reference-v1`: 13 626 px. The polygons have 16 + 12 vertices. Spherical area is 167.4 km² (core-sim `sphericalAreaKm2`), inside the ROI bounds of 25–2 500 km².
- The independent PNPOLY rasteriser (data-forge) and core-sim `rasterizeRings` differ on **0 pixels**, so registration error is **0 px**. A vitest case asserts this too.
- Evidence (1024²) and mask/QA (512²) use identical bounds and sample one analytic field. Each 512 pixel is exactly 2 × 2 display pixels, so registration is 0 px by construction.
- All masks share one GridSpec (512 × 512, AOI bounds). Every `MaskAsset.sha256` is the SHA-256 of the shipped `.bin`. core-sim `decodeMask` accepted all of them; it throws on a mismatch.

## Determinism

- `gate-b`: two forge runs into temp dirs produced 49/49 byte-identical artefacts, and 49/49 match the repo files.
- Two in-place `forge` runs: sha256 of all 306 files under `data/missions`, `data/prefabs/basemap.json` and `public/mission-data` came out identical.
- `verify` re-forge gate: 49/49 reproduced byte-identically.
- Built-in deflate PNG encoder (no zlib on the write path), no `Math.random`, no clock.

## Scoring (core-sim `scoreRoi`, date pair A→B, each case run twice)

| ROI                                                      | Pair    | Outcome                                             | Digest stable       |
| -------------------------------------------------------- | ------- | --------------------------------------------------- | ------------------- |
| reference polygons themselves (both rings)               | s01→s09 | SCORE PASS IoU 1.000 P 1.000 R 1.000 cov 73.0 %     | yes (68684a71ffeb…) |
| main bowl polygon only (132 km²)                         | s01→s09 | SCORE PASS IoU 0.799 P 1.000 R 0.799 cov 74.1 %     | yes (ffb9fab1119a…) |
| main bowl scaled ×1.3 (sloppy, generous) (223 km²)       | s01→s09 | SCORE PARTIAL IoU 0.498 P 0.569 R 0.799 cov 77.0 %  | yes (fd0976ffc78b…) |
| main bowl scaled ×0.7 (too tight) (65 km²)               | s01→s09 | SCORE PARTIAL IoU 0.376 P 1.000 R 0.376 cov 71.1 %  | yes (29d21466951a…) |
| main bowl shifted 0.05° east (~4.5 km) (132 km²)         | s01→s09 | SCORE PARTIAL IoU 0.386 P 0.620 R 0.505 cov 75.6 %  | yes (111f27930f38…) |
| box around everything coloured on s09 (559 km²)          | s01→s09 | SCORE FAIL IoU 0.284 P 0.284 R 1.000 cov 77.0 %     | yes (29c43aaaf565…) |
| decoy: s08 single-date blob near Kettleman City (77 km²) | s01→s08 | SCORE FAIL IoU 0.000 P 0.000 R 0.000 cov 89.6 %     | yes (dae58565a9ba…) |
| persistent low-coherence zone (west) (49 km²)            | s01→s09 | QA_DIAGNOSTIC LOW_COHERENCE (cov 0.0 %, 0 valid px) | yes                 |
| same step twice (Δt = 0)                                 | s09→s09 | REJECTED DT_TOO_SHORT                               | yes                 |
| pair with a no-acquisition step                          | s01→s07 | REJECTED STEP_UNAVAILABLE                           | yes                 |

All three tiers, the QA diagnostic and both rejections can be reached with the shipped data.

Steps sit 36 days apart, so any two distinct available steps satisfy Δt ≥ 24 d. In play, `DT_TOO_SHORT` only fires when the same date is picked twice.

## No acquisition / interpolation

- s02 (2026-02-05, cycle 012) and s07 (2026-08-04, cycle 027) have **no** GCOV and no GUNW granule for track 042 frame 070, checked in both CMR and the local catalogue CSVs. GIBS also has no NISAR GCOV for 2026-07-28 → 2026-08-09.
- These steps have `isAvailable:false`, `tileUrlTemplate ""`, and null masks, displacement and acquisition. Their citation states the reason.
- 0 steps carry interpolated data. Available steps carry the real GCOV start/stop times.

## Not measured

- **"No acquisition" rendered in the HUD and live region:** UI work (F/U), not data. NOT MEASURED here.
- **Real-data displacement accuracy:** not applicable, because the values are SIMULATED. Real NISAR GUNW ingestion is blocked by Earthdata auth and preprocessing.
