# Decisions — agent S (scaffold / platform)

## Toolchain & versions (resolved 2026-11-15, `npm view` latest)

- pnpm 10.30.2 (pinned via `packageManager`), node 24.14.0, rustc/cargo 1.94.
- typescript **7.0.2** (native port; `tsc` binary works), vite 8.3.8, vitest 5.1.0, @biomejs/biome 2.6.8, zod 4.6.7,
  tsx 4.23.15, @types/node 26.6.6, cesium 1.147.0, vite-plugin-static-copy 4.1.1, three 0.187.0 / @types/three 0.187.0,
  postprocessing 6.39.6, react / react-dom 19.3.1, @types/react(-dom) 19.3.0, @vitejs/plugin-react 6.3.0, zustand 5.1.0,
  satellite.js 7.2.0, pngjs 7.0.0 / @types/pngjs 6.0.5, @fontsource/{outfit,ibm-plex-sans,ibm-plex-mono} 5.3.0,
  @playwright/test + playwright 1.65.1 (Chromium 159 installed), @tauri-apps/cli + api 2.12.4.
- Rust: tauri 2.12.5, tauri-build 2.7.4, tauri-plugin-log 2.10.2, wry 0.57.2, tao 0.37.2 (crates.io "latest" is
  tauri 3.0.0-alpha — deliberately pinned to major 2).
- All deps use caret ranges of the resolved version; workspace deps use `workspace:*`.

## Workspace conventions

- `tsconfig.base.json`: strict, ES2022, module ESNext, moduleResolution Bundler, `moduleDetection: force`, jsx react-jsx,
  skipLibCheck, resolveJsonModule, isolatedModules, noEmit, noImplicitReturns/Override, noFallthroughCasesInSwitch.
  **`noUncheckedIndexedAccess` is off** (pragmatic for 8 parallel agents).
- TS 6+/7 default `types: []` → every package tsconfig lists its ambient types explicitly:
  core-sim / data-forge `lib ES2022, types [node]` (no DOM lib in core-sim — enforces the zero-DOM rule; node types only so
  tests can read fixtures); geodesy-verify `ES2022+DOM, [node]` (Cesium typings need DOM);
  renderer-globe / renderer-iss / ui-hud / app-shell `ES2022+DOM+DOM.Iterable, [vite/client, node]`
  (vite/client also declares `*.css` / asset imports, needed because TS 6+ checks side-effect imports).
- tsconfig `include`: `src test tests sandbox *.ts *.mts`; app-shell excludes `src-tauri`.
- Package scripts: `typecheck` = `tsc --noEmit -p .`; `build` = typecheck (app-shell: `tsc --noEmit -p . && vite build`);
  `test` = `vitest run --passWithNoTests` (vitest exits 1 on "no test files" otherwise).
  Sandbox dev ports baked into scripts: globe `5181`, hub `5182`, ui gallery `5183`, app-shell `5173`, preview `4173`
  (all `--strictPort`).
- data-forge placeholder scripts `forge: tsx src/cli.ts`, `verify: tsx src/verify.ts` — **D owns the package and may rename**;
  root `forge` / `verify:assets` call them by script name.
- app-shell devDepends on `@blindrev/data-forge` (workspace) so F can import forge types if needed.
- ui-hud: `exports["./styles.css"] = ./src/styles/index.css`, `sideEffects: ["**/*.css"]`.
- `pnpm-workspace.yaml` `onlyBuiltDependencies: [esbuild]` (pnpm 10 blocks other postinstalls; none needed).
- No `.npmrc` (pnpm defaults suffice; an `.npmrc` with pnpm keys made `npx` print warnings).
- Root scripts: `dev build preview typecheck test lint format check forge verify:assets desktop desktop:build desktop:bundle e2e shot`.
  `e2e` = `playwright test --config tests/e2e/playwright.config.ts` (phase-2 owns that config).

## Contracts (`packages/core-sim/src/contracts/`)

- `types.ts` is the §3 block **byte-for-byte** (plus a header comment) and is excluded from the Biome formatter so it stays so.
- `schemas.ts`: one `<TypeName>Schema` per type (+ `QualityPresetsSchema`, `DataLabelSchema`, `DATA_LABELS`,
  `MaskGridSchema`), `parseMissionManifest / parseTemporalStep / parseCameraConfig / parseQualityPresets / parseGameConstants /
  parseTleSnapshot` (+ `parseMaskAsset`, `parseContextLayer`, generic `parseContract`). All throw `ContractValidationError`
  (`message` = `Invalid <Type> (<source>): N issue(s)` + one `path: message` line per issue; `.issues` structured).
- Compile-time drift checks (`__ContractDriftChecks`): `z.infer<Schema>` and the interface must be mutually assignable;
  verified that a missing/extra field fails `tsc`.
- Validation rules beyond plain types (all derived from the contract text): bounds ranges + south<north (west>east allowed
  for antimeridian); ISO-8601 date strings (`YYYY-MM-DD…` + `Date.parse`); asset URLs relative (no leading `/`, no `\`);
  available step ⇒ non-empty `tileUrlTemplate`, unavailable ⇒ `""`; acquisitionStart ≤ End; SINGLE_TILE ⇒ zoom 0/0;
  minZoom ≤ maxZoom; sha256 = 64 lowercase hex; legend ramp = `#RRGGBB`; manifest: unique chronological steps, every
  `qaMaskId` and `referenceMaskId` present in `masks`, `masks` keys = `maskId`, context-layer `stepId` exists,
  INJECTED AOI ⇒ bounds; scoring iouPartial ≤ iouPass, areaMin < areaMax; quality presets = exactly low/medium/high;
  camera vMin ≤ vMax, rangeMin < rangeMax, home range within limits; TLE lines 69 chars + mod-10 checksum + NORAD id match.
- Test: `src/contracts/contracts.test.ts` (15 tests: all prefab JSON files + good/bad samples).

## Prefab data

- `constants.json` = SPEC Appendix A: dtMinDays 24; iouPass 0.50 / iouPartial 0.35; advisory P/R 0.60; ROI 25–2500 km²;
  QA coverage 0.60, 500 valid px, registration 1 px; TLE maxAge 72 h / fresh 24 h / NORAD 65053; wipe 500 ms
  `cubic-bezier(0.2, 0, 0, 1)` cap 3000 ms; soak 30 min / 60 s / 200 MB; visual CI 0.02; roiNudgeDeg 0.001, coarse ×10.
- `quality.json`: low {100, 4, 0.75}, medium {200, 2, 1.0}, high {400, 1.5, 1.0, allow4k true}; allow4k false elsewhere.
- `camera.json`: k 0.1, vMin 25, vMax 100000, minClearance 250, minEllipsoidalHeight 500, range 800 … 2.5e7, latClamp 89.5,
  **zoomRatePerS 1.5** (r·e^(±1.5·dt)), **wheelZoomStep 0.2** (≈18 % per notch), terrainSamples 5,
  neutral home {lon 0, lat 15, range 2.0e7, heading 0, pitch -90}. C1 may retune the two zoom rates.
- `nisar-65053.snapshot.json`: epoch field 26319.51760558 → `epochIso 2026-11-15T12:25:21.122Z` (ms-truncated; exact is
  .122112). `fetchedAt "2026-11-15"` (date only — the fetch time of day is not known; not invented).
  source `https://celestrak.org/NORAD/elements/gp.php?CATNR=65053&FORMAT=TLE`. Both line checksums verified (3, 4).

## Tooling

- `tools/shot.mjs`: Playwright `channel: "chromium"` (full Chromium, new headless) with
  `--use-angle=d3d11 --use-gl=angle --ignore-gpu-blocklist --enable-gpu`; probes WebGL2 on launch and falls back to
  `--use-angle=swiftshader --enable-unsafe-swiftshader` (`--gpu auto|gpu|swiftshader`). **Measured on this box: real GPU —
  `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU … Direct3D11)`**, ~2.7 s per shot; SwiftShader mode also verified.
  Prints console errors/warnings, page errors, failed requests, HTTP ≥400, eval result, and a JSON summary line.
- `tools/make-icon.mjs`: draws the 1024² icon (pngjs, 4×4 supersampled SDF).
- Biome 2.6: `linter.rules.preset = "recommended"` (2.6 deprecates `recommended: true`); formatter 2 spaces / LF / width 120 /
  double quotes. `pnpm lint` = `biome lint .` (formatting never fails lint). Demoted to **warn**: noNonNullAssertion,
  noParameterAssign, noExplicitAny, noArrayIndexKey, noAssignInExpressions, noUnusedVariables/Imports,
  useExhaustiveDependencies, noNoninteractiveTabindex, useSemanticElements, noStaticElementInteractions,
  useKeyWithClickEvents, noSvgWithoutTitle, useIterableCallbackReturn; off: useTemplate, noUselessElse, noForEach,
  noStaticOnlyClass, useLiteralKeys, organizeImports. Ignored: node_modules, dist, target, public, coverage, test reports,
  src-tauri/gen + icons, data/assets.manifest.json, data/generated, `*.generated.*`, pnpm-lock.yaml.
- Git: `git init -b main`, `git lfs install --local`, `core.hooksPath=.githooks`, **`core.autocrlf=false`** (local; the global
  setting converted LF→CRLF). `.gitattributes`: `* text=auto eol=lf`, `*.cmd/*.bat/*.ps1 eol=crlf`, LFS for
  png jpg jpeg webp bin gltf glb woff2 mp3 ogg ktx2 hdr under `packages/app-shell/public/**` (LFS rules placed after the
  generic `binary` rules so diff/merge=lfs win). Nothing committed.
- Pre-commit: `biome check --staged --no-errors-on-unmatched --files-ignore-unknown=true` (format + lint on staged files;
  report-only, tells you to run `pnpm format`); skips if biome is not installed.
- CI (`.github/workflows/ci.yml`): `checks` (biome lint, `pnpm -r typecheck`, `pnpm -r test`, data-forge `verify`),
  `clippy` (ubuntu + webkit deps, `cargo fmt --check`, `cargo clippy --all-targets --locked -D warnings`), `e2e` gating
  (`pnpm e2e --grep-invert @streaming`, `BLINDREV_OFFLINE=1`, no token), `streaming` (`--grep @streaming`,
  `continue-on-error`), `windows-smoke` (windows-latest: `desktop:build`, launch exe 10 s + tasklist, `desktop:bundle`,
  upload exe + NSIS). Phase 2 must tag streaming tests `@streaming`. `Cargo.lock` must be committed (`--locked`).
- `START_BLINDREV.cmd`: pure cmd; release exe → start + exit; else node check → pnpm / `corepack pnpm` /
  `npx --yes pnpm@10.30.2` → `pnpm install` if `node_modules\.modules.yaml` missing → background `ping -n 7` delay then
  `start "" http://localhost:5173` → `call pnpm dev`; `pause` on every error path. Uses `ping` instead of `timeout`
  (timeout fails when stdin is redirected). Dry-run verified with dev/browser steps stubbed.

## Tauri v2 shell (`packages/app-shell/src-tauri`)

- Crate/binary `blindrev`, lib `blindrev_lib` (`crate-type = ["rlib"]` — desktop only, avoids extra cdylib/staticlib link).
  Release profile: defaults + `strip = "debuginfo"` (no LTO, keeps builds fast).
- `beforeDevCommand: pnpm run dev`, `beforeBuildCommand: pnpm exec vite build` (cwd = packages/app-shell). The desktop
  build intentionally skips `tsc` so an unrelated type error cannot block packaging; CI typechecks separately.
- Window: label `main`, 1600×900, min 1280×720, centered, backgroundColor Ink `#0E1020` (no white flash).
- CSP = SPEC §13 baseline + **`ipc: http://ipc.localhost` in connect-src** (Tauri IPC) +
  **`dangerousDisableAssetCspModification: ["style-src"]`** (otherwise Tauri's injected nonces void `'unsafe-inline'`).
  Not added (documented candidates): `'wasm-unsafe-eval'` (Draco/KTX2 decoders), `data:` in connect-src.
- Bundle: NSIS only, `installMode currentUser`, `webviewInstallMode downloadBootstrapper (silent)`.
- `tauri-plugin-log` registered **only** when `BLINDREV_DIAGNOSTICS=1` or `--diagnostics`: LogDir `blindrev.log` + webview
  console target, Info level, 5 MB, `RotationStrategy::KeepOne`, panic hook logs. Capability includes `log:default`;
  frontend calls to the log plugin will reject when diagnostics are off — guard them. Custom command
  `diagnostics_status() -> bool`.
- No updater plugin, no signing (no secrets). Exact enable procedure: `docs/reports/packaging.md`.
- Icon: Cyan `#3DE0D0` softened hex ring, gap at upper-right, centre observation dot, Ink rounded square, matte.
  `icons/android` and `icons/ios` deleted (desktop only).
- `packages/app-shell/dist/index.html` placeholder created (was absent) so `generate_context!` compiles; any real
  `vite build` overwrites it.

## Verification (run 2026-11-15 on this machine)

- `pnpm install`: exit 0 in 55.9 s; `node_modules/.modules.yaml` present; all 7 packages linked.
- `pnpm --filter @blindrev/core-sim typecheck`: exit 0. Contracts vitest: 15/15 pass. `pnpm lint`: exit 0 (warnings only).
- `pnpm -r typecheck` (other agents' in-progress code): core-sim, geodesy-verify, data-forge, renderer-iss, ui-hud pass;
  renderer-globe and app-shell failed at the time on not-yet-written core-sim/ui-hud exports (not scaffold issues).
- `cargo build --release`: 2 m 38 s, 428 crates; `blindrev.exe` launched, window title "BlindRev" confirmed via
  `tasklist /V`, killed with `taskkill`. `BLINDREV_DIAGNOSTICS=1` wrote
  `%LOCALAPPDATA%\bureau.blindrev.app\logs\blindrev.log`. `cargo clippy --all-targets --locked -- -D warnings`: clean (36 s).
  `cargo fmt --check`: clean.
- The warm-build exe embedded the **placeholder** `dist/` → it was **deleted** after the smoke test so
  `START_BLINDREV.cmd` does not launch a placeholder app. `target/` stays warm: the next `pnpm desktop:build`
  only re-runs `vite build` + recompiles the `blindrev` crate.

## Unfinished / for others

- NSIS bundle (`pnpm desktop:bundle`) not run locally (bundler may shell out to PowerShell, which hangs here); CI runs it.
- Signing + updater: not enabled (no secrets) — procedure in `docs/reports/packaging.md`.
- `tests/e2e/playwright.config.ts` does not exist yet (phase 2); root `e2e` script points at it.
- data-forge `verify` script name is assumed by CI — D must keep a `verify` script.

STATUS: DONE
