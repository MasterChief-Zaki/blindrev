# BlindRev — Architecture & Interface Contract

Normative for every build agent. Product spec: `docs/SPEC.md` (the one-shot implementation prompt).
If this file and the spec disagree, this file wins (it records the orchestrator's decisions).

- Repo root: `C:\Users\Mrworldwide\Downloads\Projects\NASA\blindrev` (bash: `/c/Users/Mrworldwide/Downloads/Projects/NASA/blindrev`)
- Read-only resource pack: `../sars` (NASA Space Apps SAR challenge pack). Earlier Unity draft with content research: `../draft-v1/docs/DRAFT_REPORT.md`.
- Brand guide: `C:\Users\Mrworldwide\Downloads\BlindRev.pdf` (summarised in §8).

## 0. Ground rules (all agents)

1. **Bash tool only. Never use PowerShell** — it hangs for minutes on this machine (Defender AMSI fault).
2. **Stay inside the paths you own** (§1). Never edit another agent's files; if you need a change there, work around it and report it.
3. **Only the scaffold agent runs `pnpm install`.** All dependencies in §2 are preinstalled. If you truly need another one: wait until `node_modules/.modules.yaml` exists, then `pnpm --filter <your-pkg> add <dep>` (retry once on a lock error) and report it.
4. Other agents are building concurrently. If something you import is not there yet, keep going against this contract and re-check later. Do not write your own copy of another package's code.
5. Dev-server ports: app-shell `5173`, globe sandbox `5181`, hub sandbox `5182`, ui gallery `5183`, preview/e2e `4173`. Always stop servers you started.
6. Visual checks: `node tools/shot.mjs --url <url> --out <png> [--wait ms] [--width 1920 --height 1080]` (headless Chromium with GPU/WebGL2), then Read the PNG. Do not use the shared Playwright/Chrome MCP browsers.
7. Honesty rules: never fabricate a measurement. Unmeasured = `NOT MEASURED` + reason. Simulated/placeholder/stale/offline data is always labelled (`SIMULATED`, `PLACEHOLDER`, `TEST_FIXTURE`, `STALE_EPHEMERIS`, `OFFLINE`).
8. Log every default you chose or deviation in `docs/decisions/<your-agent-id>.md` (short bullets). Spike/measurement reports go in `docs/reports/`.
9. TypeScript strict, no `any` unless unavoidable, no `// @ts-ignore`. Your package must pass `pnpm --filter <pkg> typecheck` and its tests before you report.
10. Do not commit to git. Do not create files outside the repo (except temp files in your scratch dir).
11. Time-box: report within ~35 minutes. A verified working core beats an unverified complete one. List what is unfinished.

## 1. Layout & ownership

```
blindrev/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  biome.json  .editorconfig     [S]
  START_BLINDREV.cmd  .gitattributes  .gitignore  .github/  .githooks/  tools/          [S]
  docs/ARCHITECTURE.md  docs/SPEC.md                                                    [orchestrator]
  docs/decisions/<agent>.md   docs/reports/*.md                                         [each agent, own files]
  data/
    prefabs/camera.json  quality.json  constants.json                                   [S]
    prefabs/basemap.json                                                                [D]
    tle/nisar-65053.snapshot.json                                                       [S]
    missions/sinking-city.json                                                          [D]
    assets.manifest.json                                                                [D, generated]
  packages/
    core-sim/src/contracts/**                                                           [S]
    core-sim/src/{geodesy,camera,orbit}/**                                              [C1]
    core-sim/src/{temporal,roi,scoring,util}/**                                         [C2]
    core-sim/src/index.ts  (re-exports the 7 sub-dirs; S writes it, nobody edits)       [S]
    geodesy-verify/**                                                                   [C1]
    data-forge/**                                                                       [D]
    renderer-globe/**                                                                   [G]
    renderer-iss/**                                                                     [H]
    ui-hud/**                                                                           [U]
    app-shell/**   (Vite app; `public/` is the runtime asset root)                      [F]
    app-shell/public/mission-data/**  app-shell/public/offline-tiles/**                 [D]
    app-shell/public/models/**  app-shell/public/textures/hub/**                        [H]
    app-shell/src-tauri/**                                                              [S]
  tests/e2e/**                                                                          [phase 2]
```

Agent ids: S scaffold/platform · C1 geodesy+orbit · C2 game logic · D data · G globe · H hub · U design system · F frontend.

Every folder of binary assets under `app-shell/public/` must contain an `ASSET_LICENSE.json`:
`{ "license": "...", "attribution": "...", "source": "url or path", "notes": "..." }` (the manifest builder reads it; missing = CI failure).

## 2. Package conventions

- Names: `@blindrev/core-sim`, `@blindrev/geodesy-verify`, `@blindrev/data-forge`, `@blindrev/renderer-globe`, `@blindrev/renderer-iss`, `@blindrev/ui-hud`, `@blindrev/app-shell`.
- Packages are consumed **as TypeScript source**: `"main"`/`"types"`/`"exports"` → `./src/index.ts`. No per-package emit. `moduleResolution: "Bundler"`, extension-less relative imports, `target ES2022`, `jsx: react-jsx`, `skipLibCheck`.
- Scripts in every package: `typecheck` (`tsc --noEmit -p .`), `build` (= typecheck, except app-shell = `tsc --noEmit && vite build`), `test` (`vitest run`, or `echo` if none).
- Root scripts: `dev` (app-shell vite, port 5173), `build`, `typecheck`, `test`, `lint` (biome), `forge` (data pipeline), `desktop` (`tauri dev`), `desktop:build` (`tauri build`), `e2e`.
- Preinstalled deps (latest stable): `typescript vite vitest @biomejs/biome zod tsx @types/node` · `cesium vite-plugin-static-copy` · `three @types/three postprocessing` · `react react-dom @types/react @types/react-dom @vitejs/plugin-react zustand` · `satellite.js` · `pngjs @types/pngjs` · `@fontsource/outfit @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono` · `@playwright/test playwright` · `@tauri-apps/cli @tauri-apps/api`.
- Dependency rules: `core-sim` → `zod`, `satellite.js` only (zero DOM/WebGL/Cesium/Three). `renderer-globe` → `cesium`, `core-sim`. `renderer-iss` → `three`, `postprocessing`, `core-sim` (types only). `ui-hud` → `react`, `core-sim` (types + pure fns), fonts. `app-shell` → everything. `geodesy-verify` → `core-sim` + `cesium` (devDependency). `data-forge` → `core-sim`, `pngjs`, `zod` (run with `tsx`).
- Runtime asset URLs in JSON are **relative to the app base URL, no leading slash** (e.g. `mission-data/sinking-city/evidence/s03.png`). Resolve with `new URL(rel, document.baseURI)`. Vite `base: "./"`.

## 3. Shared contracts — `packages/core-sim/src/contracts/` (S writes exactly this, plus matching Zod schemas)

```ts
export type Bounds = [west: number, south: number, east: number, north: number]; // degrees
export interface LonLat {
  lon: number;
  lat: number;
} // degrees
export interface Vec3 {
  x: number;
  y: number;
  z: number;
} // metres, Float64

export type DataLabel = "SIMULATED" | "PLACEHOLDER" | "TEST_FIXTURE" | "STALE_EPHEMERIS" | "OFFLINE";

export interface TemporalStep {
  // spec §4, v2 — field-for-field
  schemaVersion: 2;
  stepId: string;
  date: string;
  acquisitionStart: string;
  acquisitionEnd: string; // ISO-8601 UTC
  isAvailable: boolean;
  platform: string;
  instrument: string;
  processingVersion: string;
  sourceId: string;
  layerId: string;
  tileUrlTemplate: string; // display raster for this step ("" when !isAvailable)
  crs: "EPSG:4326" | "EPSG:3857";
  bounds: Bounds;
  resolutionMeters: number;
  noDataValue: number | null;
  displacement: {
    quantity: "los" | "vertical";
    unit: "mm" | "cm" | "m";
    signConvention: string;
    referenceStepId: string | null;
    referencePoint: { lon: number; lat: number; heightM: number } | null;
    incidenceAngleDeg: number | null;
    lineOfSight: { east: number; north: number; up: number } | null;
  } | null;
  acquisition: { track: number | null; frame: number | null; orbitDirection: "ASCENDING" | "DESCENDING" } | null;
  tiling: { tileMatrixSet: string; minZoom: number; maxZoom: number };
  qaMaskId: string | null;
  qaMaskUrlTemplate: string | null;
  evidenceMaskId: string | null;
  evidenceMaskUrlTemplate: string | null;
  uncertainty: number | null;
  uncertaintyType: "rmse_mm" | "std_dev" | "categorical_confidence" | "none";
  license: string;
  attribution: string;
  citation: string;
}

/** EPSG:4326 regular grid. Row 0 = north edge. Pixel (col,row) centre =
 *  lon = west + (col+0.5)*(east-west)/width ; lat = north - (row+0.5)*(north-south)/height */
export interface GridSpec {
  width: number;
  height: number;
  bounds: Bounds;
  crs: "EPSG:4326";
}

export interface MaskAsset extends GridSpec {
  maskId: string;
  version: string;
  binUrl: string; // raw Uint8, row-major, width*height bytes; 1 = inside/valid, 0 = outside/invalid
  pngUrl: string; // display PNG, same grid
  sha256: string; // of the .bin
}
export interface MaskGrid extends GridSpec {
  data: Uint8Array;
} // decoded MaskAsset

export interface ContextLayer {
  layerId: string;
  title: string;
  kind: "optical" | "radar" | "basemap";
  date: string | null;
  stepId: string | null; // stepId when tied to one TemporalStep
  crs: "EPSG:3857";
  bounds: Bounds;
  tileUrlTemplate: string; // bundled, relative; {z}/{y}/{x}
  onlineUrlTemplate: string | null; // GIBS REST template, or null
  tiling: { tileMatrixSet: string; minZoom: number; maxZoom: number };
  license: string;
  attribution: string;
  citation: string;
}

export interface ScoringConfig {
  dtMinDays: number;
  iouPass: number;
  iouPartial: number;
  advisoryPrecisionRecall: number;
  roiAreaMinKm2: number;
  roiAreaMaxKm2: number;
  qaMinCoverage: number;
  qaMinValidPixels: number;
  maskRegistrationMaxPx: number;
}

export interface MissionManifest {
  schemaVersion: 1;
  missionId: string;
  caseId: string;
  title: string;
  kicker: string;
  theme: "subsidence" | "deforestation" | "glacier" | "wetlands";
  aoi: {
    decision: "PENDING" | "INJECTED";
    bounds: Bounds | null;
    name: string | null;
    source: string | null;
    injectedBy: string | null;
    injectedAt: string | null;
  };
  effectiveBounds: Bounds; // bounds actually used (fixture bounds while PENDING)
  labels: DataLabel[]; // labels that MUST be shown in HUD + briefing for this mission
  briefing: {
    question: string;
    summary: string;
    body: string[];
    location: string;
    dates: string;
    source: string;
    facts: { text: string; source: string }[];
  };
  steps: TemporalStep[]; // chronological, includes isAvailable:false steps
  masks: Record<string, MaskAsset>; // QA masks (per step) + the reference mask, keyed by maskId
  referenceMaskId: string;
  referencePolygons: LonLat[][]; // authored answer-key polygons the reference mask was rasterised from
  contextLayers: ContextLayer[];
  legend: {
    ramp: [string, string, string];
    labels: [string, string, string];
    unit: string;
    thresholds: [number, number];
  };
  camera: { home: { lon: number; lat: number; heightM: number }; aoi: { lon: number; lat: number; heightM: number } };
  attributions: string[];
}

export interface QualityPreset {
  id: "low" | "medium" | "high";
  tileCacheSize: number;
  maximumScreenSpaceError: number;
  renderScale: number;
  allow4k: boolean;
}
export interface CameraConfig {
  k: number;
  vMinMps: number;
  vMaxMps: number;
  minClearanceM: number;
  minEllipsoidalHeightM: number;
  rangeMinM: number;
  rangeMaxM: number;
  latClampDeg: number;
  zoomRatePerS: number;
  wheelZoomStep: number;
  terrainSamples: number;
  home: { lonDeg: number; latDeg: number; rangeM: number; headingDeg: number; pitchDeg: number };
}
export interface GameConstants {
  scoring: ScoringConfig;
  tle: { maxAgeHours: number; freshWindowHours: number; noradId: number };
  wipe: { durationMs: number; easing: string; progressCapMs: number };
  soak: { durationMin: number; snapshotS: number; maxHeapDeltaMb: number };
  visualCi: { maxDiffRatio: number };
  roiNudgeDeg: number;
  roiNudgeCoarseFactor: number;
}
export interface TleSnapshot {
  schemaVersion: 1;
  noradId: number;
  name: string;
  line1: string;
  line2: string;
  epochIso: string;
  fetchedAt: string;
  source: string;
}
```

Zod schemas are exported as `<TypeName>Schema` (e.g. `MissionManifestSchema`, `TemporalStepSchema`) plus `parseMissionManifest(json)`.
Single-tile rasters use `tiling: { tileMatrixSet: "SINGLE_TILE", minZoom: 0, maxZoom: 0 }` and a `tileUrlTemplate` with no placeholders; the image covers exactly `bounds`.

Bundled NISAR TLE snapshot (fetched 2026-11-15 from CelesTrak GP, CATNR 65053):

```
NISAR
1 65053U 25163A   26319.51760558  .00000230  00000+0  82551-4 0  9993
2 65053  98.4058 145.0022 0001280  90.7252 269.4085 14.42503785 68204
```

## 4. `@blindrev/core-sim` public API (names are normative; add more freely)

```ts
// geodesy [C1] — radians in, metres out; WGS84 a=6378137, f=1/298.257223563
geodeticToEcef(lonRad: number, latRad: number, heightM: number, out?: Vec3): Vec3
ecefToGeodetic(p: Vec3): { lonRad: number; latRad: number; heightM: number }
enuBasis(lonRad: number, latRad: number): { east: Vec3; north: Vec3; up: Vec3 }
scaleToAltitude(p: Vec3, heightM: number, out?: Vec3): Vec3        // same lon/lat, new ellipsoidal height
degToRad, radToDeg, wrapLonDeg(lon): number /* (-180,180] */, clampLatDeg(lat, limit): number

// camera math [C1] — pure, deterministic; renderer-globe applies the result to Cesium
interface OrbitCamState { lonDeg: number; latDeg: number; rangeM: number; headingDeg: number; pitchDeg: number }
interface CamInput { east: number; north: number; zoom: number; rotate: number; tilt: number }   // each in [-1,1]; zoom>0 = in
stepCamera(s: OrbitCamState, input: CamInput, dtS: number, cfg: CameraConfig): OrbitCamState    // v(h)=clamp(k*h,vMin,vMax), lat clamp, ±180 wrap, r'=r*e^(±dz)
wheelZoom(s: OrbitCamState, notches: number, cfg: CameraConfig): OrbitCamState
clampCameraHeight(desiredHeightM: number, terrainSamplesM: ReadonlyArray<number | undefined>, lastKnownTerrainM: number, cfg: CameraConfig): { heightM: number; lastKnownTerrainM: number }

// orbit [C1] — satellite.js SGP4 → TEME → explicit GMST rotation → ECEF. Propagated state, not telemetry.
interface Tle { name: string; line1: string; line2: string }
interface OrbitState { timeIso: string; ecefM: Vec3; velEcefMps: Vec3; lonDeg: number; latDeg: number; heightM: number }
propagateTle(tle: Tle, date: Date): OrbitState | null
nadirGroundTrack(tle: Tle, start: Date, durationS: number, stepS: number): OrbitState[]
tleEpoch(tle: Tle): Date
ephemerisStatus(tle: Tle, now: Date, maxAgeHours: number): { ageHours: number; stale: boolean; label: "FRESH" | "STALE_EPHEMERIS" }
temeToEcef(teme: Vec3, gmstRad: number, out?: Vec3): Vec3 ; gmstRad(date: Date): number

// temporal watch FSM [C2] — pure; the UI owns the timer and dispatches TICK
type WatchState = "IDLE" | "PLAYING" | "PAUSED_UNAVAILABLE" | "SCRUBBING"
type WatchEvent = {type:"PLAY"} | {type:"PAUSE"} | {type:"TICK"} | {type:"STEP_FORWARD"} | {type:"STEP_BACK"}
  | {type:"SCRUB_START"} | {type:"SCRUB_TO"; index:number} | {type:"SCRUB_END"} | {type:"RESET"}
type WatchEmission = {type:"StateChanged"; from:WatchState; to:WatchState; atMs:number}
  | {type:"StepChanged"; index:number; stepId:string; atMs:number}
  | {type:"NoAcquisition"; index:number; stepId:string; date:string; atMs:number}
  | {type:"EndReached"; atMs:number}
interface WatchSnapshot { state: WatchState; index: number; step: TemporalStep }
interface TemporalWatch {
  getSnapshot(): WatchSnapshot
  dispatch(e: WatchEvent): WatchEmission[]
  subscribe(fn: (s: WatchSnapshot, emissions: WatchEmission[]) => void): () => void
  getJournal(): ReadonlyArray<{ atMs:number; event:WatchEvent; from:WatchState; to:WatchState; index:number }>
}
createTemporalWatch(steps: TemporalStep[], opts?: { now?: () => number; initialIndex?: number }): TemporalWatch
// PLAYING + TICK: advance to the next available step, emitting NoAcquisition for each skipped unavailable step; never interpolate dates.
// SCRUB_TO / STEP_* onto an unavailable step → state PAUSED_UNAVAILABLE + NoAcquisition.

// ROI [C2]
type RoiErrorCode = "TOO_FEW_VERTICES" | "SELF_INTERSECTION" | "AREA_TOO_SMALL" | "AREA_TOO_LARGE" | "DEGENERATE"
interface RoiValidation { ok: boolean; errors: { code: RoiErrorCode; message: string }[]; areaKm2: number; rings: LonLat[][] }
validateRoi(vertices: LonLat[], cfg: Pick<ScoringConfig,"roiAreaMinKm2"|"roiAreaMaxKm2">): RoiValidation   // rings: normalised, split at ±180, |lat|≤89.9
nudgeVertex(vertices: LonLat[], index: number, dir: "N"|"S"|"E"|"W", coarse: boolean, stepDeg?: number): LonLat[]
sphericalAreaKm2(ring: LonLat[]): number          // spherical excess on authalic R = 6371007.2 m (bounds-check approximation)
pointInRings(lon: number, lat: number, rings: LonLat[][]): boolean   // even-odd

// scoring [C2] — bit-deterministic
interface ScoreInput { rings: LonLat[][]; reference: MaskGrid; qa: MaskGrid[]; stepA: TemporalStep; stepB: TemporalStep; config: ScoringConfig }
type ScoreOutcome =
  | { kind:"SCORE"; iou:number; precision:number; recall:number; tier:"PASS"|"PARTIAL"|"FAIL"; advisory:string[];
      roiPixels:number; validPixels:number; coverage:number; tp:number; fp:number; fn:number; digest:string }
  | { kind:"QA_DIAGNOSTIC"; code:"LOW_COHERENCE"|"TOO_FEW_VALID_PIXELS"|"CLOUD_COVER"; message:string; coverage:number; validPixels:number; roiPixels:number }
  | { kind:"REJECTED"; code:"DT_TOO_SHORT"|"STEP_UNAVAILABLE"|"ROI_INVALID"|"CRS_MISMATCH"|"GRID_MISMATCH"; message:string }
scoreRoi(input: ScoreInput): ScoreOutcome
rasterizeRings(rings: LonLat[][], grid: GridSpec): Uint8Array        // pixel-centre containment, even-odd
decodeMask(asset: MaskAsset, bytes: ArrayBuffer): MaskGrid
// util [C2]: mulberry32(seed), fnv1a/sha-like `digestHex(bytes|string)`, daysBetween(isoA, isoB)
```

## 5. Renderer APIs (imperative, framework-free; one live WebGL2 canvas at a time)

```ts
// @blindrev/renderer-globe [G]
type GlobeLayer = "evidence" | "qa" | "context" | "referenceMask" | "groundTrack" | "aoiOutline"
interface GlobeStatus { terrain: "WORLD_TERRAIN" | "ELLIPSOID"; imagery: "ONLINE" | "OFFLINE_BUNDLED"; offline: boolean;
  contextLost: boolean; sceneReady: boolean; logDepth: boolean; webgl2: boolean; message: string | null }
interface GlobeEvents {
  status: GlobeStatus; roiVertexAdded: LonLat; roiCloseRequested: void;
  camera: { lonDeg: number; latDeg: number; heightM: number }; pointer: { lon: number; lat: number } | null;
  contextLost: void; contextRestored: void; progress: { loaded: number; pending: number }
}
interface GlobeRendererOptions {
  container: HTMLElement; mission: MissionManifest; quality: QualityPreset; cameraConfig: CameraConfig;
  basemap: unknown /* data/prefabs/basemap.json */; ionToken: string | null; reducedMotion: boolean;
  useCustomCamera: boolean;      // false = Cesium default controller (documented rollback)
  offlineOnly?: boolean;         // true = never touch the network (tests, OFFLINE mode)
}
interface GlobeRenderer {
  readonly ready: Promise<void>;                  // scene-ready: terrain provider ready + first imagery drawn
  setStep(step: TemporalStep | null): void;       // swap the evidence raster (and its QA mask); unavailable step → hide evidence
  setContextLayer(layerId: string | null): void;
  setLayerVisible(layer: GlobeLayer, visible: boolean): void;
  setLayerOpacity(layer: GlobeLayer, opacity: number): void;
  setRoi(vertices: LonLat[], state: { closed: boolean; valid: boolean; selectedIndex: number | null }): void;
  setRoiDrawMode(enabled: boolean): void;         // pointer click → "roiVertexAdded"; click on first vertex / dblclick → "roiCloseRequested"
  setGroundTrack(track: OrbitState[] | null, current: OrbitState | null): void;   // nadir track only, no swath
  flyTo(target: "home" | "aoi"): void;            // instant under reducedMotion
  setInputSuspended(suspended: boolean): void;    // focus arbitration: HUD inputs/modals hold the keyboard
  setQuality(q: QualityPreset): void;
  getStatus(): GlobeStatus; getCanvas(): HTMLCanvasElement;
  on<K extends keyof GlobeEvents>(ev: K, fn: (p: GlobeEvents[K]) => void): () => void;
  pause(): void; resume(): void;
  forceContextLoss(): void; forceContextRestore(): void;   // WEBGL_lose_context, for the A1 harness
  destroy(): void;                                // releases every GPU resource and removes the canvas
}
createGlobeRenderer(opts: GlobeRendererOptions): GlobeRenderer

// @blindrev/renderer-iss [H]
interface HubMission { id: string; caseId: string; title: string; kicker: string; theme: string; locked: boolean }
interface HubEvents { missionFocus: string | null; missionSelect: string; contextLost: void; contextRestored: void }
interface HubRendererOptions { container: HTMLElement; missions: HubMission[]; quality: QualityPreset; reducedMotion: boolean;
  nisar: OrbitState | null }
interface HubRenderer {
  readonly ready: Promise<void>;
  focusMission(id: string | null): void;          // DOM HUD drives focus too (keyboard parity)
  setNisar(state: OrbitState | null): void;
  on<K extends keyof HubEvents>(ev: K, fn: (p: HubEvents[K]) => void): () => void;
  getCanvas(): HTMLCanvasElement; pause(): void; resume(): void;
  forceContextLoss(): void; forceContextRestore(): void;
  destroy(): void;
}
createHubRenderer(opts: HubRendererOptions): HubRenderer
```

Both renderers: WebGL2 only (throw a typed `WebGL2UnavailableError` otherwise), recover from context loss by rebuilding, `destroy()` leaves zero live GL contexts, honour `reducedMotion`. Globe: 0% bloom, no post-processing, matte. Hub: HDR selective bloom **only** on the four fringe accents.

## 6. `@blindrev/ui-hud` exports (U) — presentational, props-only, no Cesium/Three

`import "@blindrev/ui-hud/styles.css"` (tokens + fonts + base). Components (React 19, vanilla CSS, class prefix `br-`):

```ts
Button { variant?: "primary"|"secondary"|"ghost"|"danger"; size?: "md"|"lg"; icon?: IconName; locked?: boolean; disabled?: boolean; ...button props }
Panel { title?: string; kicker?: string; chamfer?: boolean; tone?: "graphite"|"ink"|"scrim"; actions?: ReactNode; as?: "section"|"aside"|"div"; children }
Badge { kind: DataLabel | "INFO" | "OK" | "ALERT"; detail?: string }            // icon + word, never colour alone
Modal { open: boolean; title: string; onClose(): void; children; footer?: ReactNode; size?: "md"|"lg" }   // focus-trapped, ESC closes
Icon { name: IconName; size?: 16|24|32|48; title?: string }   // IconName: map terrain scanner resources team journal research comms timeLens evidence alert locked hexagon circle waves infinity play pause stepBack stepForward close check back settings layers target
Logo { size?: number; withWordmark?: boolean }                // softened hexagonal instrument ring + "BlindRev"
Slider { label: string; value: number; min: number; max: number; step?: number; onChange(v: number): void; unit?: string }
Toggle { label: string; checked: boolean; onChange(v: boolean): void }
Tabs { tabs: {id:string; label:string}[]; value: string; onChange(id: string): void }
Legend { ramp: [string,string,string]; labels: [string,string,string]; unit: string; title: string }
Stat { label: string; value: string; unit?: string; mono?: boolean }
ProgressBar { value: number /*0..1*/; label: string }
LiveRegion + announce(message: string, politeness?: "polite"|"assertive")        // single app-wide aria-live host
WipeOverlay { phase: "idle"|"covering"|"covered"|"revealing"; progress: number|null; label: string; reducedMotion: boolean; durationMs: number }
ReturnButton { onClick(): void; label: string }               // 24 px chamfered glyph, ≥44×44 target
TemporalTimeline { steps: TemporalStep[]; index: number; state: WatchState; pair: { a: string|null; b: string|null };
  onScrubStart(): void; onScrubTo(i: number): void; onScrubEnd(): void; onPlay(): void; onPause(): void; onStep(dir: -1|1): void;
  onPairChange(pair: { a: string|null; b: string|null }): void; reducedMotion: boolean; dtMinDays: number }
RoiEditor2D { bounds: Bounds; vertices: LonLat[]; closed: boolean; selectedIndex: number|null; validation: RoiValidation|null;
  backdropUrl: string|null; overlayUrls?: { url: string; opacity: number }[]; nudgeDeg: number; coarseFactor: number;
  onChange(vertices: LonLat[], closed: boolean): void; onSelect(index: number|null): void }
```

Editor coordinates map linearly to lon/lat over `bounds` (deterministic path for automated tests). Stable test ids: `data-testid="roi-editor"`, `"roi-vertex-<i>"`, `"timeline"`, `"timeline-step-<i>"`, `"wipe"`.

## 7. App flow (F) — routes `menu → hub → mission`, overlays `briefing | journal | settings | results | roi-editor`

- Single live canvas: mounting a route's renderer happens **behind** the wipe; the outgoing renderer is `destroy()`ed while occluded. Wipe 500 ms `cubic-bezier(0.2,0,0,1)` to Ink; hold with progress HUD until `renderer.ready` (cap 3 s → loading screen); immediate cut under reduced motion.
- Mission loop: Briefing → Temporal Watch (play / scrub / step; explicit "No acquisition" states; live-region announcements) → pick a date pair (Δt ≥ 24 d) → mark ROI (3D pointer on the globe, or 2D editor, or keyboard nudge) → Validate → verdict (IoU / precision / recall, tier, diagnostics) → save to Case Journal (localStorage) → return to hub.
- Results are always worded as _mission scoring against an authored reference mask — not a scientific measurement_.
- Hub fallback (A1 kill): static 2D Outpost Signal command board when the 3D hub fails or `?hub=2d`.
- `?stub=1` swaps both renderers for deterministic stub implementations of the §5 interfaces (offline fixture for visual CI).
- Env: `VITE_CESIUM_ION_TOKEN` (optional). Without it: ellipsoid terrain + `OFFLINE`-style terrain badge "Ellipsoid terrain — no ion token".
- `window.__BLINDREV__` debug/harness handle (state snapshot, actions, renderer handles, perf sampler) — used by e2e and the §12 budget harness.

## 8. Visual identity — "Outpost Signal" (from the brand PDF)

- Tokens: Ink `#0E1020` (hub background, 60 %), Graphite `#1C2036` (panels/cards, 20 %), Pearl `#F3F5F7` (text on dark, 10 %); fringe accents (10 %): Cyan `#3DE0D0` instrument — scan/select/focus, primary buttons; Amber `#F2B441` task light — objectives/labels; Magenta `#E0489B` fabric accent + danger; Indigo `#6C5CE7` depth/secondary.
- Avoid: Pearl-on-Indigo text (4.45:1) and Magenta-on-Graphite text (4.25:1). Never rely on colour alone: icon + word.
- Fonts (self-hosted via @fontsource): Outfit 600/800 display + headings; IBM Plex Sans 400/600 body; IBM Plex Mono 400 telemetry (`CASE_001 / READY`, `17:42:08 / 2026-11-15`). Short sentence-case titles. Voice: short, plain, warm ("Look closer."), never cold/corporate ("Initiate observation protocol.").
- Shape: 4 px base / 8 px rhythm; spacing 4 8 12 16 24 32 48 64 96; radii 8 12 16 24; **24 px chamfered corners** on mission/scanner/research panels only; HUD edge inset 48 px; elevation = Ink → Graphite → Active layer (no drop-shadow glow).
- Glow rule: HUD and globe are **0 % glow, matte**. Only the four fringe accents may emit light, and only in the 3D hub (bloom) for active/selected states.
- Terrain/data ramps (matte, 3-step): subsidence `#8F5236 → #C9784A → #E2B08A`; forest `#2F6B4C → #4F8F6A → #8DBF8A`; glacier `#8FB8D4 → #BFE3F2 → #EAF6FB`; wetland `#2A7471 → #3E9C9A → #8CCFC8`.
- Motion: 120 ms touch · 200 ms control · 320 ms panel · 500 ms scene wipe; ease `cubic-bezier(0.2, 0, 0, 1)`; reduced motion removes travel, sweep, parallax.
- Components: primary = cyan fill with ink text; secondary = outline; ghost = text; danger = magenta + destructive verb. States: default/hover/pressed/focus/disabled/locked. Focus ring: 2 px Cyan, 5 px offset. Targets ≥ 44×44 px.
- Art direction (hub): faceted low-poly forms, readable silhouettes, teal fog, warm amber practical lamps against cyan screens, magenta only in cloth/signage (banner with the hex ring), chunky field-built consoles. Logo: softened hexagonal instrument ring around a clear observation point, with a gap ("the open signal"). Fictional bureau — no NASA insignia; NASA data is credited in attributions.
- Golden rules: lead with the investigation; label sources, dates and uncertainty; keep locked HEX values exact; reduce motion, preserve meaning.

## 10. Addendum — user-supplied mockups and concept (added mid-build; overrides earlier sections where they differ)

Reference images — Read them: `C:\Users\Mrworldwide\Downloads\mainmenu.jpeg` (main menu mockup), `C:\Users\Mrworldwide\Downloads\loadingscreen-expidition.jpeg` (loading screen mockup), `C:\Users\Mrworldwide\Downloads\image-005.jpeg` (the clean 1600×900 background plate used by both — ship it as `packages/app-shell/public/art/outpost-plate.jpg`, license: supplied by the project owner).

- **Wordmark:** "BlindRev" in a heavy geometric sans (Outfit 800), Pearl, with a small cyan parallelogram notch at the foot of the R. In the menu/loading screens the wordmark stands alone (no ring beside it). The hexagon is the loading glyph: a thin outlined hexagon with one cyan segment that travels round it.
- **Main menu:** full-bleed background plate; wordmark centred in the upper third; centred vertical text menu — **New Expedition** (selected item = cyan, heavier), Continue (dimmed when there is no save), Settings, Credits, Quit; footer hint `ENTER SELECT  /  ESC BACK` in small tracked caps. Up/Down or W/S move, Enter selects, pointer hover selects, Esc backs out of sub-panels.
- **Loading / transit screen:** same plate + wordmark, hexagon spinner, "Preparing your expedition", a thin cyan progress bar with the percentage in mono beneath it, tagline "Look closer. Every change tells a story." This is the wipe's hold state / progress HUD.
- **The journey:** travelling from the hub to a case is a short "data tunnel" (the project owner's wormhole idea — _entering the data itself_): Canvas2D only (no WebGL: single-live-canvas rule), radar-wave rings, streaks in the four fringe accents, drifting fragments of the mission imagery, 1.2–2 s, skippable with any key, replaced by the static loading screen under reduced motion. It counts as the progress HUD, not as blank time.
- **Worlds / cases:** 01 _The Sinking City_ (ground deformation — playable, CASE_001) · 02 _The Green Kingdom_ (forests and vegetation) · 03 _The Drowned World_ (wetlands and water) · 04 _The Frozen Frontier_ (ice and glaciers). 02–04 are locked.
- **Hub concept — "the NISAR Hub":** the NISAR satellite is the centrepiece (the headquarters and source of intelligence) with the four worlds arranged around it; selecting a world selects its case. Architecture echoes the background plate: chamfered hexagonal viewport frame, heavy pillars with vertical cyan + magenta light strips, consoles with small amber indicator lights, dark reflective floor, indigo-violet dusk.
- **Investigator tools** (named in the mission HUD and unlocked progressively — tools are not all available from the beginning): **Time Lens** (the temporal timeline; from the start) · **Radar Vision** (toggle optical context imagery ↔ radar-derived evidence; from the start) · **Anomaly Detector** (unlocks once every available date has been viewed; flags suspicious areas on the current date — decoys included — the player must interpret them) · **Evidence Connector** (the Case Journal; unlocks with the first verdict) · **Frequency Switch** (L-band / S-band) and **Terrain Scanner** — shown Locked, "Unlocks in a later case".
- **Briefing = a case file:** "CASE #001", location, initial report, evidence available (a short list built from the manifest: dates, acquisitions, layers), mission line "Discover what is happening and explain the evidence."
- **Globe API addition:** `setAnnotations(items: GlobeAnnotation[]): void` with `interface GlobeAnnotation { id: string; label: string; ring: LonLat[]; kind: "anomaly" | "note" }` — amber dashed outline + label, matte, clamped to the surface.

## 9. Mission data decisions (orchestrator)

- **AOI injected by the operator** (orchestrator has final say): the California Aqueduct corridor, Huron – Kettleman City, San Joaquin Valley, California — the subsidence case documented in the challenge resource pack (`../sars/07_NISAR_StoryMaps/Land_Subsidence`). Not an invented city. `aoi.decision = "INJECTED"`; the pipeline must still work with `PENDING` (→ `TEST_FIXTURE` bounds + `PLACEHOLDER` tiles).
- Context imagery: real NASA GIBS tiles, fetched at build time and bundled (works offline).
- Evidence displacement: real NISAR GUNW products need Earthdata auth + heavy preprocessing → **seeded deterministic SIMULATED displacement field + QA mask**, labelled `SIMULATED` in manifest, HUD and briefing. Acquisition dates/track/frame may come from the real NISAR catalogue in `../sars/EDA/data` if it covers the AOI (say so explicitly in `sourceId`/`citation`).
- Reference change mask: authored polygons → rasterised; it is the mission answer key, not a scientific product.
