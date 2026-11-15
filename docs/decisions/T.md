# Decisions — agent T (end-to-end + accessibility test suite)

## What exists

- `tests/e2e/playwright.config.ts` — Chromium, 1920×1080, DPR 1, `retries: 0`, 2 workers, JSON + list reporters (`test-results/e2e/results.json`).
  - `gating` project: everything except `@streaming`.
  - `streaming` project (`@streaming` only, real renderers, network allowed): **only defined when `BLINDREV_STREAMING=1`** (the CI streaming job already sets it). So a plain `pnpm e2e` runs the gating project alone and exits non-zero on failure; CI's `pnpm e2e --grep-invert @streaming` and `pnpm e2e --grep @streaming` keep working unchanged. No root `package.json` change needed.
  - `webServer`: `vite preview --outDir dist-e2e --port 4174 --strictPort` (filter `@blindrev/app-shell`). When `CI` is set or `E2E_BUILD=1`, it first runs `vite build --outDir dist-e2e`. Locally it reuses an existing server/build.
- `tests/e2e/fixtures.ts` — auto fixture `guard` on every test: aborts any request that does not go to the local origin (records it and fails the test), fails the test on any console `error` / `pageerror` (allowlist is empty), and records every text written into an `[aria-live]` host (`window.__liveLog`) from page start. `appUrl()` always adds `?stub=1&offline=1&now=2026-11-15T18:00:00Z` (5.6 h after the bundled TLE epoch). `NOW_STALE = 2026-11-19T18:00:00Z` (> 72 h).
- Specs: `keyboard-roi` (1), `mission-loop` (2), `live-regions` (3), `reduced-motion` (4), `honesty-labels` (5), `sr-transcript` (6), `targets-focus` (7), `contrast-zoom` (8, 9), `visual` (10), `streaming` (@streaming). Helpers: `a11y-audit.ts`, `screens.ts`.
- Audit data for the report: `test-results/a11y-e2e/*.json` (outside the Playwright outputDir so it survives the next run) (every element measured, offenders, tab stops, contrast rows, zoom results).

## Defaults chosen

- Fixed clock = the app's `?now=` override (not `page.clock`): `page.clock` would also freeze the timers that drive the wipe, tunnel and play loop.
- Fixed cameras = the stub renderers (`?stub=1`) — deterministic Canvas2D, no WebGL in the gating suite.
- Keyboard spec reads harness state (read-only) to check exact nudge deltas; every action is a key press — no `click`, `mouse`, `tap`, `hover` or harness action in that file.
- Focus ring rule: `outline-style != none`, `outline-width = 2px`, `outline-color = rgb(61, 224, 208)`, `outline-offset != 0` and `:focus-visible`. The map focus target (`map-focus`) uses an inset `-8px` offset; accepted as visible (the element is full-viewport, so a positive offset would be off-screen) and recorded as a deviation from the +5 px token.
- `null` focus after a Tab (focus left the document for browser chrome after the last control) is not counted as a stop.
- Target-size rule: ≥ 44×44 CSS px for every visible, enabled, non-inert `button, a[href], input, select, [role=button], [role=tab], [role=slider], [tabindex="0"]`. Exceptions granted: inline links in text only. Roving-tabindex items (`role=tab` with `tabindex=-1`) are excluded from the Tab-reachability check (they are reached with arrows) but not from the size check.
- Contrast: background resolved up the DOM by compositing semi-transparent layers; text with no opaque layer under it counts as "over imagery" and is judged against the scrim stack composited over **white** (worst case); text on an opaque panel is judged against that panel. Inactive (`aria-disabled` / disabled / locked) controls are exempt (WCAG 1.4.3) and listed separately.
- 200 % text: `document.documentElement.style.fontSize = "200%"`; checks that body text actually scales, that buttons/badges/tabs and `overflow: hidden|clip` text containers have `scrollWidth ≤ clientWidth + 1`, and that the screen's primary action can be scrolled into view and is not covered (`elementFromPoint`).
- Visual: `toHaveScreenshot` (`maxDiffPixelRatio 0.02`, animations disabled, caret hidden, fonts awaited, a style tag that kills transitions). Baselines in `tests/e2e/__screenshots__/` were captured **during F's in-progress layout pass** — refresh with `pnpm e2e --update-snapshots` once the layout settles.

## Root-file changes (orchestrator-authorised)

- `.gitignore`: added `dist-e2e/` (Playwright's `test-results/` and `playwright-report/` were already ignored).
- `biome.json`: added `"!**/dist-e2e"` to `files.includes`, next to `!**/dist`. `pnpm lint` no longer reports anything from `dist-e2e` or `test-results` (the remaining 3 errors are pre-existing app-shell ones, owned by F).

## Recommendations (not applied — not my files)

- CI `e2e` job: it builds `dist` and then my config builds `dist-e2e` again under `CI`. Either drop the "Build web app" step, or point the preview at `dist` in CI (e.g. `E2E_OUTDIR=dist`) — one build saves ~1 min.

## Results (see docs/reports/a11y-e2e.md)

- Gating: 32 tests; 3 consecutive runs = 31 passed / 1 failed (real defect: mission HUD targets < 44×44), ~47 s each; 0 flaky, 0 blocked requests, 0 console errors. Visual baselines stable across the 3 runs. Streaming: 1/1 passed.
- Defects handed to the orchestrator: timeline A/B pair buttons 36×32; mission panel hide toggles 32/43 px tall; focus-ring offsets 2–3 px instead of 5 px on several controls; hub clock ignores the `?now=` fixed clock (`Hub.tsx` uses `new Date()` instead of `nowDate()`).

STATUS: DONE
