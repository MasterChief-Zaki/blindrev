# Spike D — geodesy verification (C1)

Scope: `@blindrev/core-sim` geodesy (`geodeticToEcef`, `ecefToGeodetic`, `enuBasis`, `scaleToAltitude`) against the
spec §8 per-operation tolerances. The ROI half of Spike D is C2's (`spike-D-roi.md`).

- Run: `pnpm --filter @blindrev/geodesy-verify verify` (table below, 2026-11-15, Node, Windows 11, CesiumJS 1.147.0).
  Machine-readable results: `docs/reports/spike-D-geodesy.results.json` (`verify -- --json <file>`).
- Vitest: `pnpm --filter @blindrev/geodesy-verify test:correctness` (gating) and `test:parity` (separate project, Cesium only there).
- Sample: deterministic seeded sets of 20 000 points per metric — uniform λ, area-uniform φ with exact poles, ±89.5°,
  φ = 90° − 1e-10 rad and the equator injected; heights mixing terrain (−430 … 8 849 m), ±9 km, −100 km, LEO, GEO
  and lunar distance (3.84e8 m; parity capped at GEO because Cesium's surface projection is undefined near the centre).
  ECEF closure additionally samples cubes of half-width 50 km (around the Earth's centre, inside the evolute),
  7 000 km, 43 000 km and 4e8 m, with forced z = 0 and x = y = 0 cases.

## Verdict

| Set                                             | Result                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Correctness** (independent oracles + closure) | **PASS** — every §8 tolerance met with ≥ 6× margin (worst: 2.2e-7 m vs 1e-6 m).                                                                                                                                                                                                                   |
| **Parity vs CesiumJS**                          | **FAIL (non-blocking)** — 3 of 6 gating parity metrics exceed 1e-6 m. Diagnostics show that in every failing case it is **Cesium**, not core-sim, that differs from the independent oracle (see attribution). Per spec §8 a parity-only failure does not block a provably correct implementation. |

## Correctness vector set (independent of Cesium)

Oracles share only the defining constants (a = 6378137 m, 1/f = 298.257223563) with core-sim, not its formulas:
forward = reduced-latitude form `S = (a cosβ cosλ, a cosβ sinλ, b sinβ) + h·n`; inverse = Eberly's robust
point-to-ellipse bisection (meridian plane); normal = normalised gradient of the implicit ellipsoid. Plus the published
EPSG Guidance Note 7-2 (IOGP 373-07-2) WGS 84 geographic↔geocentric example (φ 53°48'33.820"N, λ 2°07'46.380"E,
h 73.0 m ↔ X 3771793.968, Y 140253.342, Z 5124304.349 m — published to 1 mm / 0.001″).

| Operation (§8)   | Metric                                                                                                                           | n      | Tolerance                     | Measured max  | Result |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------- | ------------- | ------ |
| Geodetic → ECEF  | per-component vs exact analytic vectors (equator/prime meridian, 90°E/W, 180°, poles, φ = 30/45/60° closed forms, GEO over pole) | 11     | 1e-6 m                        | 2.583e-9 m    | PASS   |
| Geodetic → ECEF  | per-component vs reduced-latitude oracle                                                                                         | 20 000 | 1e-6 m                        | 1.192e-7 m    | PASS   |
| Geodetic → ECEF  | vs published EPSG GN7-2 vector                                                                                                   | 1      | 5e-4 m (publication rounding) | 3.582e-4 m    | PASS   |
| Geodetic → ECEF  | round-trip closure ‖P − f(f⁻¹(P))‖                                                                                               | 20 000 | 1e-6 m                        | 1.605e-7 m    | PASS   |
| ECEF → geodetic  | height vs Eberly bisection oracle                                                                                                | 20 000 | 1e-6 m                        | 1.192e-7 m    | PASS   |
| ECEF → geodetic  | lat/lon vs Eberly bisection oracle                                                                                               | 39 599 | 1e-9 rad                      | 3.331e-16 rad | PASS   |
| ECEF → geodetic  | height vs exact analytic vectors (incl. centre → φ = 90°, h = −b)                                                                | 5      | 1e-6 m                        | 3.840e-10 m   | PASS   |
| ECEF → geodetic  | lat/lon vs exact analytic vectors                                                                                                | 5      | 1e-9 rad                      | 0 rad         | PASS   |
| ECEF → geodetic  | lat/lon vs published EPSG GN7-2                                                                                                  | 1      | 2.4e-9 rad (0.0005″)          | 7.823e-11 rad | PASS   |
| ECEF → geodetic  | closure incl. near-centre & deep space                                                                                           | 20 000 | 1e-6 m                        | 2.230e-7 m    | PASS   |
| ENU basis        | orthonormality max \|eᵢ·eⱼ − δᵢⱼ\|                                                                                               | 20 000 | 1e-12                         | 4.441e-16     | PASS   |
| ENU basis        | east × north − up                                                                                                                | 20 000 | 1e-12                         | 2.220e-16     | PASS   |
| ENU basis        | up vs implicit-surface gradient normal                                                                                           | 20 000 | 1e-12                         | 3.331e-16     | PASS   |
| Altitude scaling | vs oracle point at the new height                                                                                                | 20 000 | 1e-6 m                        | 1.490e-8 m    | PASS   |
| Altitude scaling | oracle height of result − requested                                                                                              | 20 000 | 1e-6 m                        | 1.490e-8 m    | PASS   |

The 1e-7 m-level maxima occur at lunar-distance heights (ulp(3.84e8 m) ≈ 6e-8 m), i.e. at double-precision round-off.

## Parity vector set (vs CesiumJS 1.147.0)

| Operation (§8)           | Cesium API                                                        | n      | Tolerance          | Measured max   | Result   |
| ------------------------ | ----------------------------------------------------------------- | ------ | ------------------ | -------------- | -------- |
| Geodetic → ECEF          | `Cartesian3.fromRadians`                                          | 20 000 | 1e-6 m / component | 1.490e-8 m     | PASS     |
| ECEF → geodetic, height  | `Cartographic.fromCartesian`                                      | 20 000 | 1e-6 m             | **3.130e-6 m** | **FAIL** |
| ECEF → geodetic, lat/lon | `Cartographic.fromCartesian`                                      | 39 599 | 1e-9 rad           | 1.000e-10 rad  | PASS     |
| ENU basis                | `Transforms.eastNorthUpToFixedFrame` (columns 0–2)                | 20 000 | 1e-9               | 4.441e-16      | PASS     |
| Altitude scaling         | `Ellipsoid.scaleToGeodeticSurface` + h₁·`geodeticSurfaceNormal`   | 20 000 | 1e-6 m             | **2.919e-6 m** | **FAIL** |
| Altitude scaling         | `Cartographic.fromCartesian` → `Cartesian3.fromRadians(λ, φ, h₁)` | 20 000 | 1e-6 m             | **4.046e-3 m** | **FAIL** |

### Attribution (diagnostics on the same points, vs the independent oracle)

| Diagnostic                                           | Measured max | Reading                                                   |
| ---------------------------------------------------- | ------------ | --------------------------------------------------------- |
| Cesium `Cartographic.fromCartesian` height vs oracle | 3.130e-6 m   | = the parity gap exactly → Cesium is the side that is off |
| core-sim `ecefToGeodetic` height vs oracle           | 2.235e-8 m   | core-sim within tolerance                                 |
| Cesium normal-path scaling vs oracle                 | 2.919e-6 m   | = the P-SCALE-NORMAL gap                                  |
| Cesium Cartographic-path scaling vs oracle           | 4.046e-3 m   | = the P-SCALE-CARTO gap                                   |
| core-sim `scaleToAltitude` vs oracle                 | 1.490e-8 m   | core-sim within tolerance                                 |

Causes (from the Cesium source behaviour, consistent with where the maxima occur):

1. `Ellipsoid.scaleToGeodeticSurface` stops its Newton iteration when the dimensionless constraint residual is below
   `EPSILON12`; at Earth scale that leaves up to ~3e-6 m of height/position error (worst near-surface points, e.g.
   λ 61.144°, φ 0.324°, h −4363 m). Both `Cartographic.fromCartesian` and the normal-path scaling inherit it.
2. `Cartographic.fromCartesian` derives latitude with `asin(n_z)`, which loses ~1e-10 rad within ~1e-10 rad of a pole
   (it returns exactly ±π/2 there — the source of the 1.000e-10 rad lat/lon parity maximum). Re-applying that
   latitude at GEO height (×4.2e7 m lever arm) gives the 4.0 mm P-SCALE-CARTO maximum (φ = 89.999999994°, h₁ = 3.5e7 m).

Neither is reproducible as an error in core-sim: its closure, oracle and analytic metrics are all ≤ 2.3e-7 m.
Parity is therefore reported as **FAIL (non-blocking, Cesium-side precision)**; renderer-globe should keep using
core-sim for geodesy that needs sub-µm consistency and treat Cesium conversions as ~1e-5 m-accurate.

## Implementation notes

- `ecefToGeodetic`: Vermeille (2004) closed form with Karney/GeographicLib's evolute & cancellation handling (valid at the
  poles, on the equatorial plane and inside the evolute around the centre; centre → φ = +90°, h = −b), followed by up to
  3 guarded Newton polish steps on the forward model (each accepted only if the residual decreases).
- No Cesium import anywhere in `core-sim`; Cesium appears only in `packages/geodesy-verify/src/parity.ts` (devDependency).
- Correctness and parity are separate Vitest projects (`correctness`, `parity`) and separate source modules; the package
  `test` script runs correctness (gating) and then parity, printing `PARITY FAIL - non-blocking …` instead of failing.
  `verify` exits 1 only on a correctness failure (`--strict-parity` makes parity failures exit 2).
