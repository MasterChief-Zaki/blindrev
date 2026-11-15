# Decisions — agent W (documentation + security matrix)

Files written: `README.md`, `DECISIONS.md`, `docs/security/threat-model-csp-cors.md`, `docs/checklists/manual-gpu.md`, `docs/checklists/manual-a11y.md`, `docs/reports/README.md`, this file. No source, config or other agents' files were edited. Nothing was committed.

## Verified by running something (2026-11-15, local times from `date`)

| Check                                                                                                                 | Result                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curl` CelesTrak GP `CATNR=65053&FORMAT=TLE` with `Origin: http://tauri.localhost` (one request, 20:06 UTC)           | 200, `Access-Control-Allow-Origin: *`, no `Cache-Control` / `ETag` / `Last-Modified`; body = the bundled TLE                                                                           |
| `curl -sI` and `curl -s -D -` (with Origin) on the GIBS Blue Marble tile `…/GoogleMapsCompatible_Level8/2/1/0.jpeg`   | 200, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=259200`, `ETag: 00c6t00bs93ru`; 256 × 256 JPEG, 12,509 bytes                                                    |
| `curl` `https://api.cesium.com/v1/assets/1/endpoint` (no token) with Origin                                           | 401 `InvalidCredentials`, `Access-Control-Allow-Origin: *`                                                                                                                             |
| `curl -X OPTIONS` preflight on `https://assets.ion.cesium.com/1/layer.json` (authorization + x-cesium-* headers)      | 204, allows `authorization`, `x-cesium-client`, `x-cesium-client-version`; `Access-Control-Allow-Origin: *`                                                                            |
| `pnpm typecheck` (22:08, 22:16)                                                                                       | exit 0 both times (7 packages)                                                                                                                                                         |
| `pnpm test` (22:08, 22:16)                                                                                            | exit 0 both times; core-sim 212 / 212, geodesy correctness 17 / 17, renderer-globe 17 / 17, ui-hud 13 / 13, data-forge 11 / 11; parity 3 / 6 fail, non-blocking by design              |
| `pnpm lint` (22:08, 22:16, 22:21)                                                                                     | exit 1 each time; 3 source errors in `app-shell` (`Overlays.tsx` ×2, `Transit.tsx` ×1); at 22:21 also errors from an un-ignored `packages/app-shell/dist-e2e/` folder (2,819 in total) |
| `pnpm --filter @blindrev/geodesy-verify verify` (22:09)                                                               | exit 0, `CORRECTNESS: PASS   PARITY: FAIL (non-blocking)`                                                                                                                              |
| `pnpm verify:assets` (22:09, 22:16)                                                                                   | 22:09 exit 1 (10 unlicensed files in H's folders); 22:16 exit 0, all 7 gates PASS                                                                                                      |
| `git check-ignore -v packages/app-shell/.env.local`                                                                   | ignored by `.gitignore:24:.env.*`                                                                                                                                                      |
| `git check-ignore -v packages/app-shell/dist-e2e/index.html`                                                          | not ignored (exit 1)                                                                                                                                                                   |
| `node --version`, `pnpm --version`, `rustc --version`, `cargo --version`                                              | v24.14.0, 10.30.2, 1.94.1, 1.94.1                                                                                                                                                      |
| Licence fields of installed runtime packages (`package.json`)                                                         | listed in README "Credits and licences"                                                                                                                                                |
| `grep` for `new Worker`, `WebAssembly`, `eval(`, `new Function` in `packages/*/src`; `extensionsUsed` in `Nisar.gltf` | none found                                                                                                                                                                             |

## Only read (not run)

- `pnpm dev`, `pnpm build`, `pnpm preview`, `pnpm e2e`, `pnpm desktop`, `pnpm desktop:build`, `pnpm desktop:bundle`, data-forge `fetch` / `forge` / `manifest` / `gate-b`, `tools/shot.mjs`, `play-loop.mjs`: documented from their script definitions and the agents' logs. Not run because other agents were using the dev ports and the Rust target directory.
- `pnpm --filter @blindrev/app-shell tauri build --debug --no-bundle` (suggested in the checklists for devtools access): standard Tauri CLI flags, not run.
- Key bindings: read from `renderer-globe/src/pure/input.ts`, `renderer-globe/src/globe.ts`, `app-shell/src/mission/controller.ts`, `app-shell/src/screens/Menu.tsx`, `ui-hud/src/timeline/TemporalTimeline.tsx`, `ui-hud/src/roi/RoiEditor2D.tsx`.
- Harness entry points: `app-shell/src/harness/harness.ts`, `HarnessDrawer.tsx`, `env.ts`.
- CesiumJS 1.147.0 (`@cesium/engine` 26.5.0) source: `Ion.js` (default server `https://api.cesium.com/`), `IonResource.js` (user token only on the endpoint call; asset token in an `Authorization` header), `TaskProcessor.js` (same-origin ES-module workers).
- Every spike report and all eight agent decision files.

## Choices made

- Status vocabulary in the threat model: VERIFIED (here) / VERIFIED (source) / VERIFY IN PACKAGED APP / GAP / NOT TESTED. Nothing that needs the packaged app is claimed.
- The GPU checklist recommends a debug Tauri build (`tauri build --debug --no-bundle`) because release builds have no devtools and the harness is console-driven; URL flags are set from the console with `location.href`.
- Results tables in both checklists are pre-filled with `NOT MEASURED` only.
- DECISIONS.md keeps each agent's bullets in condensed form with the agent tag, merges duplicates (ion fallback, log depth, CelesTrak policy, quality-on-next-mount), and adds a findings section instead of changing anyone's files.

## Findings handed to the orchestrator

See `DECISIONS.md` §5. The most important: CSP lacks `https://api.cesium.com` (World Terrain cannot load in the packaged app); A1 route-switch gate fails on cold switches and its metric definition conflicts with ARCHITECTURE §10; no A1 / budget report; `tests/e2e/` missing; lint red (3 source errors + un-ignored `dist-e2e/`); in-app credits miss the CC BY 4.0 cloud texture and the NISAR model; NISAR glTF redistribution unconfirmed.

STATUS: DONE
