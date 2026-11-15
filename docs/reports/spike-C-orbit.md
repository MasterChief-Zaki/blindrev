# Spike C — NISAR orbital propagation (C1)

**Gate C: NOT VERIFIED.** No independent published reference ephemeris for NISAR (NORAD 65053) was reachable in the
time box. The only reference found — JPL Horizons spacecraft −165053 — states that its trajectory is
_"Concatenated historical TLEs from Space-Track with SGP4 extrapolation 30 days into the future"_, i.e. it is
TLE-derived and cannot validate the < 1 km gate. **Standing kill applies: nadir ground track only, no swath envelopes.**
The Horizons comparison below is reported as an implementation/frame cross-check only.

Pipeline under test (`@blindrev/core-sim` orbit): satellite.js 7.2.0 SGP4 → TEME (km) → metres → `gmstRad` (IAU-82)
→ `temeToEcef` (R3(θ) only; velocity − ω⊕ × r) → `ecefToGeodetic` (core-sim). Bundled TLE (ARCHITECTURE §3, CelesTrak
2026-11-15): epoch 26319.51760558 = **2026-11-15T12:25:21.122Z**.

## 1. Error budget (GMST-only TEME → ECEF)

Order of work, stated plainly: the budget terms below were derived analytically before any Horizons query was run;
this document itself was written up afterwards in the same session. Constants: n = 14.42503785 rev/day →
a = 7 128 375 m, v = 7 477.8 m/s, P = 99.826 min; ω⊕ = 7.292115146706979e-5 rad/s.

| Term                                                    | Bound used                                         | Position effect at NISAR                                                                                       | Notes                                                                                                                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UT1 − UTC ignored (GMST from UTC)                       | \|DUT1\| ≤ 0.9 s (IERS rule)                       | ω⊕·0.9 s = 6.563e-5 rad → **≤ 467.8 m** at the equator (r cos φ), 334 m RMS over a 98.4° orbit, 0 at the poles | Spec example "≈ 470 m" confirmed. Removable: `gmstRad(date, ut1MinusUtcS)` / `propagateTle(..., { ut1MinusUtcS })` take IERS Bulletin A DUT1. Unit test: 0.9 s → 465 m shift at the epoch equator crossing. |
| Polar motion ignored                                    | x_p, y_p ≲ 0.3–0.5″                                | **10.4–17.3 m**                                                                                                | Spec example "≤ ~1 m" is **too small** at satellite radius: 0.5″ = 2.42e-6 rad × 7.128e6 m = 17.3 m. Still negligible against the gate.                                                                     |
| Equation-of-equinoxes kinematic terms (TEME convention) | 0.00264″                                           | 0.09 m                                                                                                         | negligible                                                                                                                                                                                                  |
| TLE epoch quantisation (8 decimals of a day)            | 0.864 ms                                           | 6.5 m along-track                                                                                              | absorbed in the SGP4 fit error                                                                                                                                                                              |
| satellite.js Date → JD in one double                    | ~40 µs                                             | ~0.3 m                                                                                                         | measured indirectly (finite-difference velocity noise); negligible                                                                                                                                          |
| GMST numerical precision                                | < 1e-12 rad (integer-ms reduction)                 | < 1e-5 m                                                                                                       | own `gmstRad` vs satellite.js `gstime`: ≤ 1.1e-9 rad (theirs carries JD rounding)                                                                                                                           |
| SGP4 model + TLE fit error, fresh epoch                 | literature ~0.5–1 km at epoch, growing ~1–3 km/day | **0.5–1.0 km** (dominant)                                                                                      | not measurable here without an independent ephemeris                                                                                                                                                        |

Totals: worst-case linear 0.99 km (SGP4 0.5 km) … 1.49 km (SGP4 1.0 km); RSS 0.69 … 1.10 km.
**Conclusion: < 1 km is not guaranteed with GMST-only.** Removing the UT1 term (Bulletin A DUT1, already supported by
the API) leaves budget ≈ SGP4 error + ≤ 20 m, so the gate then reduces to "is this TLE's SGP4 error < ~0.98 km at
matching epochs" — which only an independent ephemeris (e.g. NASA/JPL precision orbit products, or Space-Track
multi-epoch state vectors — credentials are forbidden in the client) can show.

## 2. Reference-ephemeris search (time-boxed)

- JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`), `COMMAND='NISAR'` → spacecraft **−165053**, "NISAR
  (Concatenated TLEs)", coverage 2025-Jul-30 → latest+30 d. **TLE-derived → not independent.**
- No other public, credential-free NISAR state-vector source was found within the time box (Space-Track needs
  credentials; NISAR precise-orbit products need Earthdata auth and cover past epochs, not the 2026-11-15 TLE window).

## 3. Cross-check vs Horizons (NOT a gate measurement)

Queries (UTC, all within 24 h of the TLE epoch, i.e. the "fresh window"):

- Vectors, geometric (`EPHEM_TYPE=VECTORS, CENTER='500@399', VEC_CORR='NONE'`), 2026-11-15 12:05 → 14:05 every 10 min.
  Frame-invariant comparison (|r|, |v_inertial|, radial rate), so no ICRF↔TEME reduction is needed.
- Observer table (`COMMAND='399', CENTER='500@-165053', QUANTITIES='14,20'`): ObsSub-LON/LAT on ITRF93 with EOP
  (eop.261113 — includes UT1 and polar motion), 12:05 → 14:05 every 10 min and 12:25 → +24 h every 4 h.

**Frame-invariant (geometric) results, 13 epochs:**

| Quantity (ours − Horizons) | max \|Δ\|                                            |
| -------------------------- | ---------------------------------------------------- |
| geocentric distance \|r\|  | **24.3 m** (once-per-orbit pattern, +24.3 … −19.3 m) |
| inertial speed \|v\|       | 0.024 m/s                                            |
| radial rate r̂·v            | 0.023 m/s                                            |

So SGP4 output agrees closely with Horizons' (essentially the same or a neighbouring element set).

**Earth-fixed horizontal position (sub-point), 20 epochs:** Horizons' ObsSub point turned out to be the planetodetic
coordinates of the _intercept of the spacecraft→Earth-centre line_ with the ellipsoid (a first comparison treating it
as the geodetic nadir showed a twice-per-orbit ±2.9 km latitude pattern consistent with the geodetic-vs-geocentric
intercept difference ≈ 0.020°·sin2φ, and switching definitions removed it; Horizons' apparent range also carries ±0.71 km of light-time (|v⊕|·τ, τ = 23.8 ms),
which the geometric |r| check above removes). Comparing directions instead (angle between our r̂ and Horizons'
intercept direction × |r|):

| Variant                                                                | max horizontal \|Δ\| | range over 20 epochs |
| ---------------------------------------------------------------------- | -------------------- | -------------------- |
| no light-time adjustment                                               | **0.96 km**          | 14 m … 962 m         |
| first-order light-time/aberration adjustment (ours evaluated at t − τ) | 1.14 km              | 72 m … 1141 m        |

The residual is a once-per-orbit along-track pattern (≈ ±0.45–0.68 km) with cross-track ≤ 0.11 km. Its amplitude matches
the apparent-direction terms (|v⊕|·τ = 0.71 km, v_rel·τ = 0.18 km) that I could not model exactly from Horizons'
"apparent" observer quantities within the time box, plus the ignored DUT1 (the node-to-node cross-track asymmetry
suggests |DUT1| of order 0.1 s — not measured). Not attributed further.

**Reading:** the implementation is consistent with an independent SGP4 + Earth-orientation chain (JPL) to ≈ 24 m
radially and ≲ 1 km horizontally, the latter limited by observation-model ambiguity, not by an identified defect. This is
**not** evidence for the < 1 km gate, because both sides propagate TLEs.

## 4. Implementation cross-checks that were run (real numbers, `pnpm --filter @blindrev/core-sim test`)

| Check                                                                                                          | Result                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temeToEcef` vs satellite.js `eciToEcf` (independent implementation, same GMST), 5 epochs (−5 h … +23.9 h)     | ≤ 1e-6 m per component (test bound; identical rotation)                                                                                                                |
| `temeVelocityToEcef` vs satellite.js `eciToEcfVelocity`, 5 epochs                                              | ≤ 1e-3 m/s (test bound; ω differs by 1.5e-13 rad/s)                                                                                                                    |
| Own `ecefToGeodetic` vs satellite.js `eciToGeodetic`, 5 epochs                                                 | lat ≤ 1e-9 rad, height ≤ 1 mm (test bounds)                                                                                                                            |
| `gmstRad` vs satellite.js `gstime`, 7 epochs 2025–2030                                                         | < 1e-8 rad (max observed 1.1e-9 rad)                                                                                                                                   |
| GMST at J2000.0 / Vallado Ex. 3-5 (1992-08-20 12:14 UT1)                                                       | 280.460618375° / 152.578788° (5 decimals)                                                                                                                              |
| ECEF velocity vs 5-point finite difference of ECEF positions (proves ω × r is included; omitting it ≈ 500 m/s) | < 0.1 m/s at 5 epochs                                                                                                                                                  |
| Geodetic height over 3 orbits (1 s steps)                                                                      | measured 752.2–779.4 km (753 km at the epoch equator crossing; higher over the poles because b < a; nominal "747 km" is w.r.t. a mean radius); test asserts 750–785 km |
| max \|latitude\|                                                                                               | measured 81.638° (180° − 98.4058° = 81.594° geocentric; geodetic slightly higher); test asserts 81.4–81.9°                                                             |
| Inclination from inertial angular momentum                                                                     | measured 98.4005° (TLE mean 98.4058°); test asserts 98.4 ± 0.05°                                                                                                       |
| Nodal period (ascending-node crossings)                                                                        | measured 99.884 min (two consecutive revs); mean-motion period 99.826 min; test asserts 99.5–100.1 min                                                                 |
| Staleness boundary                                                                                             | age = 72 h exactly → FRESH; 72 h + 1 ms → STALE_EPHEMERIS; −73 h (future epoch) → STALE_EPHEMERIS                                                                      |
| `tleEpoch`                                                                                                     | 2026-11-15T12:25:21.122Z = snapshot `epochIso`, = satellite.js `jdsatepoch` within 2 ms                                                                                |

## 5. Decision

- Gate C: **NOT VERIFIED** (no independent reference). **Kill path active: nadir track only, no swath envelopes**
  (`nadirGroundTrack`; `splitTrackAtAntimeridian` for polylines). HUD must label the track as propagated from a TLE,
  with `STALE_EPHEMERIS` when |now − epoch| > 72 h.
- To re-run the gate later: obtain a NASA/JPL precise orbit (or Space-Track state vectors) for epochs within 24 h of a
  fresh TLE, convert to ECEF with full EOP, compare with `propagateTle(tle, t, { ut1MinusUtcS: DUT1 })`.
