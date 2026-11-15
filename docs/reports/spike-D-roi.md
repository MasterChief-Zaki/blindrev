# Spike D (ROI part) + Spike B scoring determinism — C2 report

Agent C2 · 2026-11-15 · `@blindrev/core-sim` `src/{roi,scoring,temporal,util}`
Machine: Windows 11, Node v24.14.0, Vitest 5.1.0. All values below were measured on this machine. Nothing was estimated or copied in.

## Verdict

| Gate        | Criterion                                          | Result                                                                                                                                         |
| ----------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| D (ROI)     | All adversarial ROI cases pass deterministically   | **PASS**: 18/18 cases below give the expected verdict, and 100 repeated runs are deep-equal                                                    |
| B (scoring) | Same ROI + same steps → bit-identical score        | **PASS**: 100 runs plus 18 rotated/reversed variants (64-vertex ring, 1024² grid) gave **1 distinct digest**                                   |
| B (scoring) | Zero date interpolation; explicit "No acquisition" | **PASS** (FSM): `NoAcquisition` carries the step's own `date`. No step is synthesised (`snapshot.step` is always one of the caller's objects). |

Geodesy (§8 parity/oracle) belongs to C1 and is not covered here.

## Adversarial ROI cases (`validateRoi`, cfg A_min 25 km², A_max 2,500 km²)

Source: `packages/core-sim/src/roi/roi.test.ts`. Measured with `tsx` against the same code.

| #   | Case                                                          | Expected            | Measured verdict  | Measured area (km²)                        | Rings | Pass |
| --- | ------------------------------------------------------------- | ------------------- | ----------------- | ------------------------------------------ | ----- | ---- |
| 1   | Plain 0.2° box, San Joaquin Valley (36.0–36.2 N)              | ok                  | ok                | 399.6102                                   | 1     | ✅   |
| 2   | Bow-tie                                                       | SELF_INTERSECTION   | SELF_INTERSECTION | 0                                          | 0     | ✅   |
| 3   | Figure-eight through a shared vertex                          | SELF_INTERSECTION   | SELF_INTERSECTION | 0                                          | 0     | ✅   |
| 4   | Figure-eight crossing mid-edge                                | SELF_INTERSECTION   | SELF_INTERSECTION | 0                                          | 0     | ✅   |
| 5   | Collinear overlap of non-adjacent edges                       | SELF_INTERSECTION   | SELF_INTERSECTION | 0                                          | 0     | ✅   |
| 6   | Fold-back spike (adjacent edges overlap)                      | SELF_INTERSECTION   | SELF_INTERSECTION | 0                                          | 0     | ✅   |
| 7   | Collinear interior vertices (midpoints on edges)              | ok                  | ok                | 399.6517 (Δ 1.04e-4 rel vs #1, see note a) | 1     | ✅   |
| 8   | Consecutive duplicates + closing duplicate                    | ok, identical to #1 | ok                | 399.6102 (bit-identical to #1)             | 1     | ✅   |
| 9   | Only 2 distinct vertices (`A,B,A,B`; also `180,0` ≡ `−180,0`) | TOO_FEW_VERTICES    | TOO_FEW_VERTICES  | 0                                          | 0     | ✅   |
| 10  | Zero-area sliver (all collinear; also 1e-12° deviation)       | DEGENERATE          | DEGENERATE        | 0                                          | 0     | ✅   |
| 11  | Near-zero sliver, 1e-6° high                                  | AREA_TOO_SMALL      | AREA_TOO_SMALL    | 0.0405 (note b)                            | 1     | ✅   |
| 12  | Antimeridian square 179.9 E → 179.9 W, 10.0–10.2 N            | ok, split in 2      | ok                | 486.909470043785                           | 2     | ✅   |
| 13  | Same square at lon 0                                          | ok                  | ok                | 486.909470043807                           | 1     | ✅   |
| —   | #12 vs #13 relative difference (gate: ≤ 1e-9)                 | ≤ 1e-9              | **4.53e-14**      |                                            |       | ✅   |
| 14  | Ring looping around the pole (lat 89.8, 4 quadrants)          | DEGENERATE          | DEGENERATE        | 0                                          | 0     | ✅   |
| 15  | Polygon touching the pole clamp (lat 90 and 95 → 89.9)        | ok, max lat 89.9    | ok, max lat 89.9  | 85.8816                                    | 1     | ✅   |
| 16  | Clockwise version of #1                                       | ok, same area       | ok                | 399.6102 (identical)                       | 1     | ✅   |
| 17  | Tiny 0.03° box                                                | AREA_TOO_SMALL      | AREA_TOO_SMALL    | 9.0010                                     | 1     | ✅   |
| 18  | Huge 1° box                                                   | AREA_TOO_LARGE      | AREA_TOO_LARGE    | 10,002.82                                  | 1     | ✅   |

Notes:

- **a)** The bounds-check area uses great-circle edges, as the spec requires ("spherical excess"). A great-circle arc between two points on one parallel bulges toward the pole. Adding a vertex on that edge shortens the arc and its bulge. Rasterisation and scoring use straight lon/lat edges, so the scored ROI is unchanged. This only shifts the bounds-check value, by about 1e-4 relative for a 0.2° box at 36° N and at most about 6e-4 for a maximum-size 2,500 km² ROI.
- **b)** The lon/lat area of #11 is about 0.001 km². Its great-circle base bulges about 7 m north of the 0.1 m-high apex, so the spherical-excess value is 0.04 km². The verdict is the same: it is still about 600× below A_min.

### Area oracle (`sphericalAreaKm2`, authalic R = 6,371,007.2 m)

| Ring                              | sphericalAreaKm2 | Independent oracle                                                     | Relative difference                                                                 |
| --------------------------------- | ---------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1°×1° cell, 0–1° N at the equator | 12,364.025699    | Analytic parallel-bounded cell R²·Δλ·(sin 1° − sin 0°) = 12,363.711935 | 2.54e-5 (expected great-circle bulge ≈ Δλ²·sinφ·cos²φ/12 ≈ 2.5e-5; test bound 5e-5) |
| same                              | 12,364.025699    | Girard's theorem (Σ interior angles − 2π, vector maths)                | 8.3e-13 (test bound 1e-9)                                                           |
| 1°×1° centred on the equator      | 12,364.496573    | Girard                                                                 | 1.7e-12                                                                             |
| 1°×1° at 36–37° N                 | 9,939.017610     | Girard                                                                 | 2.2e-11                                                                             |
| 1°×1° at 59–60° S                 | 6,275.101590     | Girard                                                                 | 9.6e-11                                                                             |
| Pole-clamped cell (#15)           | 85.881594        | Girard                                                                 | 4.3e-10 (test bound 1e-6)                                                           |

## Rasterisation (`rasterizeRings`, pixel-centre containment, even-odd, row 0 = north)

| Check                                                                    | Result                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Box aligned to pixel edges (0.3° on a 0.01° grid)                        | exactly 900 px, identical to an index-built 30×30 mask                                                                                                              |
| Ring whose edges pass exactly through pixel centres (cols 2–5, rows 2–5) | exactly 9 px (cols 2–4 × rows 3–5: left/bottom edges in, right/top edges out). Identical for the original, reversed, and two rotated vertex orders                  |
| `rasterizeRings` vs `pointInRings` at every pixel centre                 | identical over 25 seeded random polygons (mulberry32 seed 20261115, half the vertices on exact pixel centres, some self-intersecting, some with a hole), 64×48 grid |
| Antimeridian split rings on a grid spanning 179.8–180.2                  | exactly the expected 20×20 block                                                                                                                                    |
| 1024² grid, 64-vertex polygon (452,831 px inside)                        | median **1.14 ms**, p95 1.80 ms, max 2.03 ms (30 runs)                                                                                                              |
| `scoreRoi` end-to-end on 1024² (rasterise + count + 3 SHA-256 digests)   | median **17.4 ms**, p95 40.0 ms (20 runs)                                                                                                                           |
| `validateRoi`, 200-vertex ring                                           | median 0.21 ms, p95 1.10 ms (50 runs)                                                                                                                               |

## Determinism evidence (scoring)

- Arithmetic: ROI membership, validity and tp/fp/fn are integer counts in a single pass. Each ratio is one IEEE division of two integers. Crossings use only `+ − × ÷` and comparisons, with endpoints in a canonical order, so the result does not depend on winding or starting vertex. Pixel centres are computed with the exact `GridSpec` contract expression. No transcendental functions are used anywhere on the scoring path.
- Measured on a 1024² grid with a 64-vertex ROI: 100 repeated runs, plus every 7th rotation of the vertex list both forward and reversed (18 variants), gave **1 distinct digest**: `1baad5a6efb29bf0d9748b50b6ab68f864e6cf34e01428e3b2b65bd1bf96045d` (IoU 0.20382085716234682, tp 92,627 · fp 360,204 · fn 1,622).
- Unit tests (`scoring.test.ts`) assert deep-equal outcome objects, digest included, for:
  - 100 identical runs;
  - every rotation and its reversal of a heptagon;
  - 100 runs on lattice-snapped `validateRoi` rings;
  - swapped ring order, swapped QA-grid order, and swapped A/B steps.

  The digest changes when the ROI, the config or the steps change.
- The digest is SHA-256 (pure TS, checked against the FIPS 180-4 vectors including 1,000,000 × "a"). It covers the version tag, grid spec, bit-packed ROI raster, reference and validity masks, the sorted step pair, every `ScoringConfig` field, and the result.

## Temporal Watch FSM (spec §9)

`temporal/watch.test.ts`: 48 tests, fixed clocks. They cover every state × event cell of the transition table in `temporal/watch.ts`, plus:

- clamping;
- an all-unavailable mission, where one TICK ends playback and 1,000 further TICKs are no-ops;
- a single-step mission;
- the journal: every dispatch is journaled with from/to/index/atMs, entries are frozen copies, and old entries are capped;
- subscriber semantics;
- a determinism replay.

## Not covered here

- Mask registration ≤ 1 px (`maskRegistrationMaxPx`) is a data-pipeline gate (D). `scoreRoi` requires bit-identical grids and rejects anything else with `GRID_MISMATCH`.
- QA coverage ≥ 60 % over the real AOI depends on D's generated QA mask: NOT MEASURED here (no mission data existed when this was run).
- Cross-engine bit-identity (WebView2 vs Node) was not executed. It is argued from IEEE-754 basic operations only, plus integer counts. NOT MEASURED in WebView2.
