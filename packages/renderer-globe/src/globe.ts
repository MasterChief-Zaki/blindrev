import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  CesiumWidget,
  ClassificationType,
  Color,
  ColorGeometryInstanceAttribute,
  Credit,
  Ellipsoid,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  GeometryInstance,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  GroundPrimitive,
  HorizontalOrigin,
  ImageryLayer,
  Ion,
  LabelCollection,
  LabelStyle,
  Material,
  Matrix4,
  PerInstanceColorAppearance,
  PerspectiveFrustum,
  PointPrimitiveCollection,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineCollection,
  PolylineMaterialAppearance,
  Ray,
  Rectangle,
  type Scene,
  SceneTransforms,
  SingleTileImageryProvider,
  type TerrainProvider,
  TextureMagnificationFilter,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  WebMercatorTilingScheme,
} from "cesium";
import {
  type CamInput,
  type CameraConfig,
  type CameraPose,
  cameraHeightM,
  createCameraPose,
  type LonLat,
  type OrbitCamState,
  type OrbitState,
  type QualityPreset,
  type SegmentSample,
  sanitizeCamState,
  solveCameraFrame,
  stepCamera,
  type TemporalStep,
  type TerrainSampler,
  wheelZoom,
} from "@blindrev/core-sim";
import { normLon, splitAtAntimeridian } from "./pure/antimeridian";
import { type BasemapConfig, type BasemapSource, parseBasemap } from "./pure/basemap";
import { CAMERA_KEY_CODES, isTypingTarget, keysToIntent, wheelDeltaToNotches } from "./pure/input";
import { Emitter, isSimpleRing, resolveAssetUrl, TileProgress } from "./pure/misc";
import {
  type CamPose,
  dragToEastNorthMetres,
  easeBrand,
  FixedStepper,
  flightDurationMs,
  interpolatePose,
  offsetLonLat,
} from "./pure/motion";
import { createTransparentTileDiscardPolicy } from "./discard";
import { ensureGlobeStyles, PALETTE } from "./style";
import {
  type GlobeAnnotation,
  type GlobeEvents,
  type GlobeLayer,
  type GlobeRenderer,
  type GlobeRendererOptions,
  type GlobeStatus,
  WebGL2UnavailableError,
} from "./types";

/**
 * A3 decision (docs/reports/spike-A3-depth-globe.md): logarithmic depth ON. It is Cesium's
 * default for this stack and the only setting that keeps the orbital-height satellite marker,
 * nadir line and near-surface overlays free of depth artefacts in one frustum.
 */
export const LOG_DEPTH_DEFAULT = true;

const STEP_S = 1 / 60;
const ION_WORLD_TERRAIN_ASSET = 1;
const CLICK_SLOP_PX = 5;
const CLOSE_HIT_PX = 14;
const POINTER_THROTTLE_MS = 50;
const CAMERA_EVENT_MS = 100;
const QUALITY_IDLE_MS = 300;
const READY_TIMEOUT_MS = 20000;
const RESTORE_BUDGET_MS = 5000;
const HEIGHT_CACHE_MAX = 20000;
const HEIGHT_CELL_RAD = (0.0005 * Math.PI) / 180; // ≈ 55 m

function heightCellKey(lonRad: number, latRad: number): number {
  const i = Math.floor(lonRad / HEIGHT_CELL_RAD) + 400000;
  const j = Math.floor(latRad / HEIGHT_CELL_RAD) + 200000;
  return j * 1000000 + i;
}

const DEFAULT_VISIBLE: Record<GlobeLayer, boolean> = {
  evidence: true,
  qa: false,
  context: true,
  referenceMask: false,
  groundTrack: true,
  aoiOutline: true,
};
const DEFAULT_OPACITY: Record<GlobeLayer, number> = {
  evidence: 0.85,
  qa: 0.7,
  context: 1,
  referenceMask: 0.6,
  groundTrack: 1,
  aoiOutline: 1,
};

/** Debug/test hooks used by the sandbox A2/A3 harnesses (not part of the §5 contract). */
export interface GlobeDebugHooks {
  /** Replaces scene.globe.getHeight for the camera clamp (A2: forced gaps / synthetic slopes). */
  heightSampler: ((lonRad: number, latRad: number) => number | undefined) | null;
  /** Ground truth used only for the A2 "underground" metric; defaults to the real globe height. */
  truthTerrain: ((lonRad: number, latRad: number) => number) | null;
  onCameraFrame: ((s: CameraFrameSample) => void) | null;
}

export interface CameraFrameSample {
  lonDeg: number;
  latDeg: number;
  heightM: number; // camera ellipsoidal height actually applied to Cesium
  desiredHeightM: number; // before the clamp
  clampFloorM: number; // max(sampled terrain + clearance, minEllipsoidalHeight) as applied
  truthTerrainM: number; // terrain under the camera (truth function or real globe)
  nan: boolean;
}

interface RoiState {
  vertices: LonLat[];
  closed: boolean;
  valid: boolean;
  selectedIndex: number | null;
}

interface Runtime {
  root: HTMLDivElement;
  credits: HTMLDivElement;
  widget: CesiumWidget;
  scene: Scene;
  canvas: HTMLCanvasElement;
  loseExt: WEBGL_lose_context | null;
  baseLayers: ImageryLayer[];
  evidence: Map<string, ImageryLayer>;
  qa: Map<string, ImageryLayer>;
  context: Map<string, ImageryLayer>;
  reference: ImageryLayer | null;
  groundReady: boolean;
  roiFill: GroundPrimitive | null;
  roiCasing: GroundPolylinePrimitive | null;
  roiEdges: GroundPolylinePrimitive | null;
  roiPoints: PointPrimitiveCollection;
  aoiPrim: GroundPolylinePrimitive | null;
  aoiScrim: GroundPrimitive | null;
  aoiMaterial: Material | null;
  trackPrim: GroundPolylinePrimitive | null;
  trackPending: GroundPolylinePrimitive | null;
  trackMaterial: Material | null;
  trackKey: string;
  satPoints: PointPrimitiveCollection;
  satLines: PolylineCollection;
  satLabels: LabelCollection;
  annoPrim: GroundPolylinePrimitive | null;
  annoLabels: LabelCollection;
  frames: number;
  sawTiles: boolean;
  removers: Array<() => void>;
  dead: boolean;
}

interface Flight {
  from: CamPose;
  to: CamPose;
  startMs: number;
  durationMs: number;
}

function cssColor(hex: string, alpha = 1): Color {
  return Color.fromCssColorString(hex).withAlpha(alpha);
}

function clamp01(v: number): number {
  return !Number.isFinite(v) ? 0 : v < 0 ? 0 : Math.min(v, 1);
}

function boundsToRect(b: readonly [number, number, number, number]): Rectangle {
  return Rectangle.fromDegrees(b[0], b[1], b[2], b[3]);
}

function mercX(lonDeg: number): number {
  return (lonDeg * Math.PI * 6378137) / 180;
}
function mercY(latDeg: number): number {
  const l = Math.max(-85.0511287798066, Math.min(85.0511287798066, latDeg));
  return 6378137 * Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360));
}

function errorStatusCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const rec = err as { statusCode?: unknown; error?: unknown };
    if (typeof rec.statusCode === "number") return rec.statusCode;
    if (rec.error !== undefined && rec.error !== err) return errorStatusCode(rec.error);
  }
  return undefined;
}

function cloneCam(s: OrbitCamState): OrbitCamState {
  return { lonDeg: s.lonDeg, latDeg: s.latDeg, rangeM: s.rangeM, headingDeg: s.headingDeg, pitchDeg: s.pitchDeg };
}

function camFinite(s: OrbitCamState): boolean {
  return (
    Number.isFinite(s.lonDeg) &&
    Number.isFinite(s.latDeg) &&
    Number.isFinite(s.rangeM) &&
    Number.isFinite(s.headingDeg) &&
    Number.isFinite(s.pitchDeg) &&
    s.rangeM > 0
  );
}

export class GlobeRendererImpl implements GlobeRenderer {
  readonly ready: Promise<void>;
  readonly debug: GlobeDebugHooks = { heightSampler: null, truthTerrain: null, onCameraFrame: null };

  private readonly opts: GlobeRendererOptions;
  private readonly cfg: CameraConfig;
  /** cfg with terrainSamples forced ≥ 5 (spec §7). */
  private readonly cfgSolve: CameraConfig;
  private readonly basemap: BasemapConfig;
  private readonly emitter = new Emitter<GlobeEvents>();
  private readonly ellipsoid = Ellipsoid.WGS84;
  private rt: Runtime | null = null;
  private destroyed = false;
  private resolveReady: (() => void) | null = null;

  // Persistent state (survives context-loss rebuilds).
  private status: GlobeStatus;
  private step: TemporalStep | null = null;
  private contextLayerId: string | null = null;
  private readonly visible: Record<GlobeLayer, boolean> = { ...DEFAULT_VISIBLE };
  private readonly opacity: Record<GlobeLayer, number> = { ...DEFAULT_OPACITY };
  private roi: RoiState = { vertices: [], closed: false, valid: true, selectedIndex: null };
  private annotations: GlobeAnnotation[] = [];
  private drawMode = false;
  private track: OrbitState[] | null = null;
  private current: OrbitState | null = null;
  private quality: QualityPreset;
  private appliedQuality: QualityPreset | null = null;
  private suspended = false;
  private paused = false;
  private terrainChoice: "pending" | "world" | "ellipsoid" = "pending";
  private worldTerrain: TerrainProvider | null = null;
  private imageryOffline: boolean;
  private onlineErrors: number[] = [];

  // Camera.
  private cam: OrbitCamState;
  private lastGoodCam: OrbitCamState;
  private lastKnownTerrainM = 0;
  private lastTargetTerrainM = 0;
  private lastFloorTerrainM = Number.NEGATIVE_INFINITY;
  private readonly heightCache = new Map<number, number>();
  private readonly stepper = new FixedStepper(STEP_S, 0.1, 6);
  private lastFrameMs = -1;
  private flight: Flight | null = null;
  private pendingNotches = 0;
  private readonly held = new Set<string>();
  private defaultView: { position: Cartesian3; direction: Cartesian3; up: Cartesian3 } | null = null;
  private lastMotionMs = 0;
  private lastCamEventMs = 0;
  private lastCamPayload = { lonDeg: Number.NaN, latDeg: Number.NaN, heightM: Number.NaN };

  // Pointer.
  private pointerDown: {
    id: number;
    x: number;
    y: number;
    button: number;
    dragging: boolean;
    lastX: number;
    lastY: number;
  } | null = null;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private hoverPos: { x: number; y: number } | null = null;
  private hoverDirty = false;
  private lastPointerEmitMs = 0;
  private lastClick: { x: number; y: number; t: number } | null = null;
  private readonly progress = new TileProgress();

  // Restore bookkeeping.
  private restoreStartedMs = 0;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingRestoredFrame = false;

  // Scratch (pre-allocated; no per-frame Cartesian allocation in the camera path).
  private readonly sTmp = new Cartesian3();
  private readonly sCarto = new Cartographic();
  private readonly sCarto2 = new Cartographic();
  private readonly sWin = new Cartesian2();
  private readonly sRay = new Ray();
  private readonly sPick = new Cartesian3();
  private readonly pose: CameraPose = createCameraPose();
  private readonly segSamples: SegmentSample[] = [];
  private samplerRt: Runtime | null = null;
  private readonly sampler: TerrainSampler = (lonRad, latRad) =>
    this.samplerRt ? this.terrainHeight(this.samplerRt, lonRad, latRad) : undefined;
  private readonly windowListeners: Array<() => void> = [];

  constructor(opts: GlobeRendererOptions) {
    this.opts = opts;
    this.cfg = opts.cameraConfig;
    this.cfgSolve = { ...opts.cameraConfig, terrainSamples: Math.max(5, Math.floor(opts.cameraConfig.terrainSamples)) };
    this.quality = opts.quality;
    this.basemap = parseBasemap(opts.basemap);
    const offlineOnly = opts.offlineOnly === true;
    const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    this.imageryOffline = offlineOnly || browserOffline || !this.basemap.online;
    if (offlineOnly || !opts.ionToken) this.terrainChoice = "ellipsoid";
    this.status = {
      terrain: "ELLIPSOID",
      imagery: this.imageryOffline ? "OFFLINE_BUNDLED" : "ONLINE",
      offline: this.imageryOffline,
      contextLost: false,
      sceneReady: false,
      logDepth: LOG_DEPTH_DEFAULT,
      webgl2: false,
      message: this.terrainChoice === "ellipsoid" && !opts.ionToken ? "Ellipsoid terrain — no ion token" : null,
    };

    const home = opts.mission.camera.home;
    this.cam = {
      lonDeg: home.lon,
      latDeg: home.lat,
      rangeM: Math.min(this.cfg.rangeMaxM, Math.max(this.cfg.rangeMinM, home.heightM)),
      headingDeg: this.cfg.home.headingDeg,
      pitchDeg: this.cfg.home.pitchDeg,
    };
    this.lastGoodCam = cloneCam(this.cam);

    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    if (typeof window !== "undefined" && !window.CESIUM_BASE_URL) {
      window.CESIUM_BASE_URL = new URL("cesium/", document.baseURI).href;
    }
    if (opts.ionToken && !offlineOnly) Ion.defaultAccessToken = opts.ionToken;
    ensureGlobeStyles(document);

    this.rt = this.buildRuntime(); // throws WebGL2UnavailableError
    this.installWindowListeners();
    if (this.terrainChoice === "pending") void this.loadWorldTerrain();
    setTimeout(() => this.markReady("timeout"), READY_TIMEOUT_MS);
  }

  // ───────────────────────────────────────────── runtime (re)build

  private buildRuntime(): Runtime {
    const container = this.opts.container;
    const root = document.createElement("div");
    root.className = "br-globe-root";
    const credits = document.createElement("div");
    credits.className = "br-globe-credits";
    root.appendChild(credits);
    container.appendChild(root);

    let widget: CesiumWidget;
    try {
      widget = new CesiumWidget(root, {
        baseLayer: false,
        terrainProvider: this.worldTerrain ?? new EllipsoidTerrainProvider(),
        skyBox: false, // no stars, sun or moon (no lens flare / sun bloom)
        scene3DOnly: true,
        useDefaultRenderLoop: !this.paused,
        useBrowserRecommendedResolution: !this.quality.allow4k,
        showRenderLoopErrors: false,
        requestRenderMode: false,
        msaaSamples: 4,
        creditContainer: credits,
        creditViewport: root,
        contextOptions: {
          requestWebgl1: false,
          webgl: { alpha: false, depth: true, stencil: true, antialias: false, powerPreference: "high-performance" },
        },
      });
    } catch (err) {
      root.remove();
      throw new WebGL2UnavailableError(
        `Could not create a WebGL2 context for the mission globe: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const canvas = widget.canvas;
    const gl2 = canvas.getContext("webgl2");
    if (!gl2) {
      widget.destroy();
      root.remove();
      throw new WebGL2UnavailableError();
    }
    const loseExt = gl2.getExtension("WEBGL_lose_context");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Mission globe");
    canvas.tabIndex = 0;

    const scene = widget.scene;
    const rt: Runtime = {
      root,
      credits,
      widget,
      scene,
      canvas,
      loseExt,
      baseLayers: [],
      evidence: new Map(),
      qa: new Map(),
      context: new Map(),
      reference: null,
      groundReady: false,
      roiFill: null,
      roiCasing: null,
      roiEdges: null,
      roiPoints: scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection,
      aoiPrim: null,
      aoiScrim: null,
      aoiMaterial: null,
      trackPrim: null,
      trackPending: null,
      trackMaterial: null,
      trackKey: "",
      satLines: scene.primitives.add(new PolylineCollection()) as PolylineCollection,
      satPoints: scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection,
      satLabels: scene.primitives.add(new LabelCollection({ scene })) as LabelCollection,
      annoPrim: null,
      annoLabels: scene.primitives.add(new LabelCollection({ scene })) as LabelCollection,
      frames: 0,
      sawTiles: false,
      removers: [],
      dead: false,
    };

    this.setupScene(rt);
    this.setupBaseImagery(rt);
    this.setupMissionLayers(rt);
    this.setupEvents(rt);
    this.applyQualityNow(rt, this.quality);
    this.applyCameraInitial(rt);
    this.patchStatus({ webgl2: true, logDepth: scene.logarithmicDepthBuffer });

    void GroundPrimitive.initializeTerrainHeights()
      .then(() => {
        if (rt.dead) return;
        rt.groundReady = true;
        this.rebuildAoi(rt);
        this.rebuildRoi(rt);
        this.rebuildTrack(rt, true);
        this.rebuildAnnotations(rt);
      })
      .catch((err: unknown) => {
        console.warn("[renderer-globe] approximate terrain heights unavailable; ground overlays disabled", err);
      });
    return rt;
  }

  private setupScene(rt: Runtime): void {
    const { scene } = rt;
    const globe = scene.globe;
    scene.backgroundColor = cssColor(PALETTE.ink);
    globe.baseColor = cssColor(PALETTE.graphite);
    globe.enableLighting = false;
    globe.dynamicAtmosphereLighting = false;
    globe.showGroundAtmosphere = false;
    globe.showWaterEffect = false;
    globe.depthTestAgainstTerrain = false;
    globe.preloadAncestors = true;
    globe.preloadSiblings = false;
    scene.highDynamicRange = false;
    scene.logarithmicDepthBuffer = this.status.logDepth;
    scene.postProcessStages.fxaa.enabled = false;
    scene.postProcessStages.bloom.enabled = false;
    scene.postProcessStages.ambientOcclusion.enabled = false;
    scene.fog.enabled = true;
    scene.fog.density = 1.0e-4;
    if (scene.skyAtmosphere) {
      // Restrained limb: darker, indigo-tinted, no glow bloom.
      scene.skyAtmosphere.show = true;
      scene.skyAtmosphere.brightnessShift = -0.42;
      scene.skyAtmosphere.saturationShift = -0.15;
      scene.skyAtmosphere.hueShift = 0.06; // nudge toward Indigo (#6C5CE7), the depth token
    }
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.shadowMap.enabled = false;

    const sscc = scene.screenSpaceCameraController;
    if (this.opts.useCustomCamera) {
      sscc.enableInputs = false;
      sscc.enableRotate = false;
      sscc.enableTranslate = false;
      sscc.enableZoom = false;
      sscc.enableTilt = false;
      sscc.enableLook = false;
    } else {
      sscc.minimumZoomDistance = this.cfg.minClearanceM;
      sscc.maximumZoomDistance = this.cfg.rangeMaxM;
      sscc.enableCollisionDetection = true;
    }
  }

  // ───────────────────────────────────────────── imagery

  private templateProvider(
    src: BasemapSource,
    online: boolean,
    discardTransparent = false,
  ): UrlTemplateImageryProvider {
    const url = online ? src.urlTemplate : resolveAssetUrl(src.urlTemplate, document.baseURI);
    const credit = src.attribution ? new Credit(src.attribution, true) : undefined;
    return new UrlTemplateImageryProvider({
      url,
      tilingScheme: src.crs === "EPSG:4326" ? new GeographicTilingScheme() : new WebMercatorTilingScheme(),
      minimumLevel: src.minZoom,
      maximumLevel: src.maxZoom,
      rectangle: src.bounds ? boundsToRect(src.bounds) : undefined,
      tileWidth: src.tileSize,
      tileHeight: src.tileSize,
      credit,
      tileDiscardPolicy: discardTransparent ? createTransparentTileDiscardPolicy(document) : undefined,
    });
  }

  private setupBaseImagery(rt: Runtime): void {
    const layers = rt.scene.imageryLayers;
    for (const l of rt.baseLayers) layers.remove(l, true);
    rt.baseLayers = [];
    const useOffline = this.imageryOffline || !this.basemap.online;
    const src = useOffline ? this.basemap.offline : this.basemap.online;
    if (!src) {
      this.patchStatus({ message: "No basemap configured" });
      return;
    }
    const addLayer = (s: BasemapSource, online: boolean, index: number): void => {
      const provider = this.templateProvider(s, online);
      provider.errorEvent.addEventListener((e: unknown) => {
        if (online) this.onOnlineImageryError(e);
        // Bundled tiles: missing tiles outside coverage are expected; Cesium falls back to ancestors.
      });
      const layer = new ImageryLayer(provider, {});
      layers.add(layer, index);
      rt.baseLayers.push(layer);
    };
    addLayer(src, !useOffline, 0);
    if (src.regional) addLayer(src.regional, !useOffline, 1);
    this.patchStatus({ imagery: useOffline ? "OFFLINE_BUNDLED" : "ONLINE", offline: useOffline });
    this.reorderLayers(rt);
  }

  private onOnlineImageryError(e: unknown): void {
    if (this.imageryOffline) return;
    const now = performance.now();
    const code = errorStatusCode(e);
    this.onlineErrors = this.onlineErrors.filter((t) => now - t < 10000);
    this.onlineErrors.push(now);
    const offlineNow = typeof navigator !== "undefined" && navigator.onLine === false;
    const hard = code === 401 || code === 403 || code === 429 || code === undefined || code >= 500;
    if (offlineNow || (hard && this.onlineErrors.length >= 3) || this.onlineErrors.length >= 8) {
      this.goOffline(code === undefined ? "network error" : `HTTP ${code}`);
    }
  }

  private goOffline(reason: string): void {
    if (this.imageryOffline || !this.basemap.offline) return;
    this.imageryOffline = true;
    this.patchStatus({ message: `Imagery offline (${reason}). Using bundled tiles.` });
    if (this.rt) this.setupBaseImagery(this.rt);
  }

  private stepLayer(step: TemporalStep): ImageryLayer | null {
    if (!step.isAvailable || !step.tileUrlTemplate) return null;
    const url = resolveAssetUrl(step.tileUrlTemplate, document.baseURI);
    const rect = boundsToRect(step.bounds);
    const credit = step.attribution ? new Credit(step.attribution, false) : undefined;
    const filters = { alpha: 0, magnificationFilter: TextureMagnificationFilter.NEAREST };
    if (step.tiling.tileMatrixSet === "SINGLE_TILE") {
      if (step.crs === "EPSG:3857") {
        const [w, s, e, n] = step.bounds;
        const tilingScheme = new WebMercatorTilingScheme({
          rectangleSouthwestInMeters: new Cartesian2(mercX(w), mercY(s)),
          rectangleNortheastInMeters: new Cartesian2(mercX(e), mercY(n)),
        });
        return new ImageryLayer(
          new UrlTemplateImageryProvider({ url, tilingScheme, maximumLevel: 0, rectangle: rect, credit }),
          filters,
        );
      }
      return ImageryLayer.fromProviderAsync(
        SingleTileImageryProvider.fromUrl(url, { rectangle: rect, credit }),
        filters,
      );
    }
    return new ImageryLayer(
      new UrlTemplateImageryProvider({
        url,
        tilingScheme: step.crs === "EPSG:3857" ? new WebMercatorTilingScheme() : new GeographicTilingScheme(),
        minimumLevel: step.tiling.minZoom,
        maximumLevel: step.tiling.maxZoom,
        rectangle: rect,
        credit,
      }),
      filters,
    );
  }

  private maskLayer(maskId: string): ImageryLayer | null {
    const m = this.opts.mission.masks[maskId];
    if (!m?.pngUrl) return null;
    const url = resolveAssetUrl(m.pngUrl, document.baseURI);
    return ImageryLayer.fromProviderAsync(
      SingleTileImageryProvider.fromUrl(url, { rectangle: boundsToRect(m.bounds) }),
      {
        alpha: 0,
        magnificationFilter: TextureMagnificationFilter.NEAREST,
      },
    );
  }

  /** Preload every available step's evidence + QA raster (alpha 0 = loaded but skipped at draw time). */
  private setupMissionLayers(rt: Runtime): void {
    const layers = rt.scene.imageryLayers;
    for (const step of this.opts.mission.steps) {
      const ev = this.stepLayer(step);
      if (ev) {
        ev.errorEvent.addEventListener((err: unknown) =>
          console.warn(`[renderer-globe] evidence ${step.stepId} failed`, err),
        );
        layers.add(ev);
        rt.evidence.set(step.stepId, ev);
      }
      if (step.qaMaskId && !rt.qa.has(step.qaMaskId)) {
        const qa = this.maskLayer(step.qaMaskId);
        if (qa) {
          layers.add(qa);
          rt.qa.set(step.qaMaskId, qa);
        }
      }
    }
    if (this.contextLayerId) this.ensureContextLayer(rt, this.contextLayerId);
    if (this.visible.referenceMask) this.ensureReference(rt);
    this.reorderLayers(rt);
    this.applyLayerAlphas(rt);
  }

  private ensureContextLayer(rt: Runtime, layerId: string): ImageryLayer | null {
    const existing = rt.context.get(layerId);
    if (existing) return existing;
    const def = this.opts.mission.contextLayers.find((c) => c.layerId === layerId);
    if (!def) return null;
    const bundled: BasemapSource = {
      urlTemplate: def.tileUrlTemplate,
      crs: def.crs,
      minZoom: def.tiling.minZoom,
      maxZoom: def.tiling.maxZoom,
      attribution: def.attribution,
      title: def.title,
      tileSize: 256,
      bounds: def.bounds,
      regional: null,
    };
    const provider = this.templateProvider(bundled, false, true);
    provider.errorEvent.addEventListener(() => {
      /* bundled context tiles outside coverage are expected; ancestors are used */
    });
    const layer = new ImageryLayer(provider, { alpha: 0 });
    rt.scene.imageryLayers.add(layer);
    rt.context.set(layerId, layer);
    this.reorderLayers(rt);
    return layer;
  }

  private ensureReference(rt: Runtime): ImageryLayer | null {
    if (rt.reference) return rt.reference;
    const layer = this.maskLayer(this.opts.mission.referenceMaskId);
    if (!layer) return null;
    rt.scene.imageryLayers.add(layer);
    rt.reference = layer;
    this.reorderLayers(rt);
    return layer;
  }

  /** Draw order: base → context → evidence → QA → reference. */
  private reorderLayers(rt: Runtime): void {
    const layers = rt.scene.imageryLayers;
    for (const l of rt.context.values()) layers.raiseToTop(l);
    for (const l of rt.evidence.values()) layers.raiseToTop(l);
    for (const l of rt.qa.values()) layers.raiseToTop(l);
    if (rt.reference) layers.raiseToTop(rt.reference);
    for (let i = rt.baseLayers.length - 1; i >= 0; i--) {
      const l = rt.baseLayers[i];
      if (l) layers.lowerToBottom(l);
    }
  }

  private applyLayerAlphas(rt: Runtime): void {
    const step = this.step;
    const stepOk = step !== null && step.isAvailable;
    for (const [id, l] of rt.evidence) {
      l.alpha = stepOk && step.stepId === id && this.visible.evidence ? this.opacity.evidence : 0;
    }
    const qaId = stepOk ? step.qaMaskId : null;
    for (const [id, l] of rt.qa) {
      l.alpha = qaId === id && this.visible.qa ? this.opacity.qa : 0;
    }
    for (const [id, l] of rt.context) {
      l.alpha = id === this.contextLayerId && this.visible.context ? this.opacity.context : 0;
    }
    if (rt.reference) rt.reference.alpha = this.visible.referenceMask ? this.opacity.referenceMask : 0;
    if (rt.aoiPrim) rt.aoiPrim.show = this.visible.aoiOutline;
    if (rt.aoiScrim) rt.aoiScrim.show = this.visible.aoiOutline;
    if (rt.aoiMaterial) rt.aoiMaterial.uniforms.color = cssColor(PALETTE.amber, 0.95 * this.opacity.aoiOutline);
    const trackOn = this.visible.groundTrack;
    if (rt.trackPrim) rt.trackPrim.show = trackOn;
    if (rt.trackMaterial) rt.trackMaterial.uniforms.color = cssColor(PALETTE.pearl, 0.7 * this.opacity.groundTrack);
    rt.satPoints.show = trackOn;
    rt.satLines.show = trackOn;
    rt.satLabels.show = trackOn;
  }

  // ───────────────────────────────────────────── terrain

  private async loadWorldTerrain(): Promise<void> {
    try {
      const provider = await CesiumTerrainProvider.fromIonAssetId(ION_WORLD_TERRAIN_ASSET, {
        requestVertexNormals: false,
        requestWaterMask: false,
      });
      if (this.destroyed) return;
      provider.errorEvent.addEventListener((e: unknown) => {
        const code = errorStatusCode(e);
        if (code === 401 || code === 403 || code === 429) this.fallbackTerrain(`World Terrain HTTP ${code}`);
      });
      this.worldTerrain = provider;
      this.terrainChoice = "world";
      if (this.rt) this.rt.scene.terrainProvider = provider;
      this.patchStatus({ terrain: "WORLD_TERRAIN", message: null });
    } catch (err) {
      const code = errorStatusCode(err);
      this.fallbackTerrain(code ? `World Terrain unavailable (HTTP ${code})` : "World Terrain unavailable (network)");
    }
  }

  private fallbackTerrain(reason: string): void {
    this.terrainChoice = "ellipsoid";
    this.worldTerrain = null;
    if (this.rt && !(this.rt.scene.terrainProvider instanceof EllipsoidTerrainProvider)) {
      this.rt.scene.terrainProvider = new EllipsoidTerrainProvider();
    }
    this.patchStatus({ terrain: "ELLIPSOID", message: `${reason} — ellipsoid terrain` });
  }

  // ───────────────────────────────────────────── events / frame loop

  private setupEvents(rt: Runtime): void {
    const { scene, canvas } = rt;
    const add = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      o?: AddEventListenerOptions,
    ): void => {
      el.addEventListener(type, fn, o);
      rt.removers.push(() => el.removeEventListener(type, fn, o));
    };
    const onLost = (e: Event): void => {
      e.preventDefault();
      this.onContextLost(rt);
    };
    canvas.addEventListener("webglcontextlost", onLost, false);
    rt.removers.push(() => canvas.removeEventListener("webglcontextlost", onLost, false));

    rt.removers.push(scene.preUpdate.addEventListener(() => this.onPreUpdate(rt)));
    rt.removers.push(scene.postRender.addEventListener(() => this.onPostRender(rt)));
    rt.removers.push(
      scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
        if (n > 0) rt.sawTiles = true;
        this.emitter.emit("progress", this.progress.update(n));
      }),
    );

    add(canvas, "pointerdown", (e) => this.onPointerDown(rt, e));
    add(canvas, "pointermove", (e) => this.onPointerMove(rt, e));
    add(canvas, "pointerup", (e) => this.onPointerUp(rt, e));
    add(canvas, "pointercancel", (e) => this.onPointerCancel(rt, e));
    add(canvas, "pointerleave", () => {
      this.hoverPos = null;
      this.hoverDirty = true;
    });
    add(canvas, "dblclick", (e) => {
      if (!this.drawMode) return;
      e.preventDefault();
      this.emitter.emit("roiCloseRequested", undefined);
    });
    add(canvas, "contextmenu", (e) => {
      if (this.opts.useCustomCamera) e.preventDefault();
    });
    add(
      canvas,
      "wheel",
      (e) => {
        if (!this.opts.useCustomCamera) return;
        e.preventDefault();
        this.flight = null;
        this.pendingNotches += wheelDeltaToNotches(e.deltaY, e.deltaMode);
      },
      { passive: false },
    );
  }

  private installWindowListeners(): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!this.opts.useCustomCamera || !CAMERA_KEY_CODES.has(e.code)) return;
      if (this.keyboardBlocked() || e.ctrlKey || e.metaKey || e.altKey) return;
      this.held.add(e.code);
      this.flight = null;
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      this.held.delete(e.code);
    };
    const clear = (): void => this.held.clear();
    const onOffline = (): void => this.goOffline("browser offline");
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", clear);
    this.windowListeners.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("blur", clear),
      () => window.removeEventListener("offline", onOffline),
      () => document.removeEventListener("visibilitychange", clear),
    );
  }

  private keyboardBlocked(): boolean {
    return this.suspended || isTypingTarget(document.activeElement as HTMLElement | null);
  }

  private onPreUpdate(rt: Runtime): void {
    if (rt.dead) return;
    const now = performance.now();
    if (this.opts.useCustomCamera) {
      const dt = this.lastFrameMs < 0 ? 0 : (now - this.lastFrameMs) / 1000;
      this.lastFrameMs = now;
      this.stepCustomCamera(dt, now);
      this.applyCamera(rt);
    }
  }

  private onPostRender(rt: Runtime): void {
    if (rt.dead) return;
    rt.frames++;
    const now = performance.now();
    if (this.awaitingRestoredFrame && rt.frames >= 2) {
      this.awaitingRestoredFrame = false;
      this.patchStatus({ contextLost: false, message: this.status.message });
      this.emitter.emit("contextRestored", undefined);
    }
    // Swap a pending ground-track primitive once its worker geometry is ready (no flicker).
    if (rt.trackPending?.ready) {
      if (rt.trackPrim) rt.scene.groundPrimitives.remove(rt.trackPrim);
      rt.trackPrim = rt.trackPending;
      rt.trackPending = null;
      rt.trackPrim.show = this.visible.groundTrack;
    }
    // Scene-ready: terrain provider settled + first imagery drawn.
    if (!this.status.sceneReady && this.terrainChoice !== "pending" && rt.frames > 2) {
      if (rt.scene.globe.tilesLoaded && (rt.sawTiles || rt.frames > 90)) this.markReady("tiles");
    }
    // Camera event + motion tracking.
    const c = rt.scene.camera.positionCartographic;
    const lonDeg = (c.longitude * 180) / Math.PI;
    const latDeg = (c.latitude * 180) / Math.PI;
    const p = this.lastCamPayload;
    const moved =
      Math.abs(lonDeg - p.lonDeg) > 1e-9 || Math.abs(latDeg - p.latDeg) > 1e-9 || Math.abs(c.height - p.heightM) > 1e-3;
    if (moved || Number.isNaN(p.lonDeg)) {
      this.lastMotionMs = now;
      if (now - this.lastCamEventMs >= CAMERA_EVENT_MS) {
        this.lastCamEventMs = now;
        this.lastCamPayload = { lonDeg, latDeg, heightM: c.height };
        this.emitter.emit("camera", { lonDeg, latDeg, heightM: c.height });
      }
    }
    // Deferred resolution change (never resize during camera motion).
    if (this.appliedQuality !== this.quality && now - this.lastMotionMs > QUALITY_IDLE_MS) {
      this.applyQualityNow(rt, this.quality);
    }
    // Throttled hover probe.
    if (this.hoverDirty && now - this.lastPointerEmitMs >= POINTER_THROTTLE_MS) {
      this.hoverDirty = false;
      this.lastPointerEmitMs = now;
      this.emitter.emit("pointer", this.hoverPos ? this.pickLonLat(rt, this.hoverPos.x, this.hoverPos.y) : null);
    }
    if (!this.opts.useCustomCamera && rt.frames % 30 === 0) this.snapshotDefaultView(rt);
  }

  private markReady(_why: "tiles" | "timeout"): void {
    if (this.status.sceneReady || this.destroyed) return;
    this.patchStatus({ sceneReady: true });
    this.resolveReady?.();
    this.resolveReady = null;
  }

  // ───────────────────────────────────────────── custom ENU camera

  private stepCustomCamera(dtS: number, nowMs: number): void {
    const n = this.stepper.advance(dtS);
    let s = this.cam;
    if (this.flight) {
      const f = this.flight;
      const t = f.durationMs <= 0 ? 1 : (nowMs - f.startMs) / f.durationMs;
      s = { ...interpolatePose(f.from, f.to, easeBrand(Math.min(1, t))) };
      if (t >= 1) this.flight = null;
    } else {
      const intent = this.keyboardBlocked() ? null : keysToIntent(this.held);
      if (intent && (intent.forward || intent.right || intent.zoom || intent.rotate || intent.tilt)) {
        // core-sim CamInput: east/north are heading-relative (north = forward, east = right).
        const input: CamInput = {
          east: intent.right,
          north: intent.forward,
          zoom: intent.zoom,
          rotate: intent.rotate,
          tilt: intent.tilt,
        };
        for (let i = 0; i < n; i++) s = stepCamera(s, input, STEP_S, this.cfg);
      }
      if (this.pendingNotches !== 0) {
        s = wheelZoom(s, this.pendingNotches, this.cfg);
        this.pendingNotches = 0;
      }
    }
    s = sanitizeCamState(s, this.cfg);
    if (camFinite(s)) {
      this.cam = s;
      this.lastGoodCam = cloneCam(s);
    } else {
      this.cam = cloneCam(this.lastGoodCam);
    }
  }

  /** Raw terrain height (globe.getHeight, or the A2 stub); undefined = tile not loaded. */
  private rawTerrainHeight(rt: Runtime, lonRad: number, latRad: number): number | undefined {
    const hs = this.debug.heightSampler;
    if (hs) return hs(lonRad, latRad);
    const c = this.sCarto;
    c.longitude = lonRad;
    c.latitude = latRad;
    c.height = 0;
    return rt.scene.globe.getHeight(c);
  }

  /**
   * Camera-clamp sampler: raw height, else the last height observed in the same ~55 m cell
   * (terrain seen earlier along the camera→target segment is remembered when its tile drops out).
   */
  private terrainHeight(rt: Runtime, lonRad: number, latRad: number): number | undefined {
    const key = heightCellKey(lonRad, latRad);
    const h = this.rawTerrainHeight(rt, lonRad, latRad);
    if (h !== undefined && Number.isFinite(h)) {
      const cache = this.heightCache;
      if (cache.size >= HEIGHT_CACHE_MAX && !cache.has(key)) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(key, h);
      return h;
    }
    return this.heightCache.get(key);
  }

  /**
   * Apply the OrbitCamState to the Cesium camera with the terrain-collision clamp (spec §7):
   * core-sim solveCameraFrame → pose → cfg.terrainSamples (≥ 5) getHeight samples along the
   * camera→target segment → clampCameraHeight → lifted pose. Copied into Cesium's camera through
   * pre-allocated Cartesian3 scratch objects.
   */
  private applyCamera(rt: Runtime): void {
    const s = this.cam;
    const cfg = this.cfg;
    const deg = Math.PI / 180;
    const th = this.terrainHeight(rt, s.lonDeg * deg, s.latDeg * deg);
    if (th !== undefined && Number.isFinite(th)) this.lastTargetTerrainM = th;
    this.samplerRt = rt;
    // "Last-known" for unloaded samples = max(core-sim's last-known, last frame's floor terrain):
    // never descend into terrain we cannot currently see (A2 gap hardening, see decisions/G.md).
    const lastKnownIn = Math.max(this.lastKnownTerrainM, this.lastFloorTerrainM);
    const frame = solveCameraFrame(s, this.cfgSolve, this.sampler, lastKnownIn, {
      targetHeightM: this.lastTargetTerrainM,
      samples: this.segSamples,
      out: this.pose,
    });
    this.lastKnownTerrainM = frame.clamp.lastKnownTerrainM;
    this.lastFloorTerrainM = frame.clamp.floorM - cfg.minClearanceM;
    const pose = frame.pose;
    const P = pose.positionEcef;
    const D = pose.directionEcef;
    const U = pose.upEcef;
    const R = pose.rightEcef;
    const nan = !Number.isFinite(P.x + P.y + P.z + D.x + D.y + D.z + U.x + U.y + U.z + R.x + R.y + R.z);
    if (!nan) {
      const camera = rt.scene.camera;
      Cartesian3.fromElements(P.x, P.y, P.z, camera.position);
      Cartesian3.fromElements(D.x, D.y, D.z, camera.direction);
      Cartesian3.fromElements(U.x, U.y, U.z, camera.up);
      Cartesian3.fromElements(R.x, R.y, R.z, camera.right);
    }
    const hook = this.debug.onCameraFrame;
    if (hook) {
      const lonR = pose.position.lonDeg * deg;
      const latR = pose.position.latDeg * deg;
      let truth: number;
      const truthFn = this.debug.truthTerrain;
      if (truthFn) truth = truthFn(lonR, latR);
      else {
        const c = this.sCarto2;
        c.longitude = lonR;
        c.latitude = latR;
        c.height = 0;
        const g = rt.scene.globe.getHeight(c);
        truth = g === undefined ? Number.NaN : g;
      }
      hook({
        lonDeg: pose.position.lonDeg,
        latDeg: pose.position.latDeg,
        heightM: pose.position.heightM,
        desiredHeightM: frame.clamp.clamped ? cameraHeightM(s, this.lastTargetTerrainM) : pose.position.heightM,
        clampFloorM: frame.clamp.floorM,
        truthTerrainM: truth,
        nan,
      });
    }
  }

  private applyCameraInitial(rt: Runtime): void {
    const camera = rt.scene.camera;
    camera.lookAtTransform(Matrix4.IDENTITY);
    if (this.opts.useCustomCamera) {
      this.lastFrameMs = -1;
      this.stepper.reset();
      this.applyCamera(rt);
      return;
    }
    if (this.defaultView) {
      camera.setView({
        destination: this.defaultView.position,
        orientation: { direction: this.defaultView.direction, up: this.defaultView.up },
      });
      return;
    }
    const s = this.cam;
    camera.setView({
      destination: Cartesian3.fromDegrees(s.lonDeg, s.latDeg, s.rangeM),
      orientation: { heading: (s.headingDeg * Math.PI) / 180, pitch: (s.pitchDeg * Math.PI) / 180, roll: 0 },
    });
  }

  private snapshotDefaultView(rt: Runtime): void {
    const c = rt.scene.camera;
    this.defaultView = {
      position: Cartesian3.clone(c.positionWC),
      direction: Cartesian3.clone(c.directionWC),
      up: Cartesian3.clone(c.upWC),
    };
  }

  private targetPose(target: "home" | "aoi"): CamPose {
    const m = this.opts.mission.camera;
    if (target === "home") {
      return {
        lonDeg: m.home.lon,
        latDeg: m.home.lat,
        rangeM: this.clampRange(m.home.heightM),
        headingDeg: this.cfg.home.headingDeg,
        pitchDeg: this.cfg.home.pitchDeg,
      };
    }
    return (
      this.fitAoiPose() ?? {
        lonDeg: m.aoi.lon,
        latDeg: m.aoi.lat,
        rangeM: this.clampRange(m.aoi.heightM),
        headingDeg: 0,
        pitchDeg: -90,
      }
    );
  }

  private viewInsets: { top: number; right: number; bottom: number; left: number } | null = null;

  setViewInsets(insets: { top: number; right: number; bottom: number; left: number } | null): void {
    this.viewInsets = insets;
  }

  /**
   * Nadir pose that fits the AOI bounds to the free map rectangle (canvas minus the HUD insets), for any
   * viewport size. Null until insets are set and the canvas has a size (callers fall back to the authored pose).
   */
  private fitAoiPose(): CamPose | null {
    const ins = this.viewInsets;
    const rt = this.rt;
    const b = this.opts.mission.aoi.bounds ?? this.opts.mission.effectiveBounds;
    if (!ins || !rt || !b) return null;
    const cw = rt.canvas.clientWidth;
    const ch = rt.canvas.clientHeight;
    const fw = cw - ins.left - ins.right;
    const fh = ch - ins.top - ins.bottom;
    if (!(cw > 0 && ch > 0 && fw > 40 && fh > 40)) return null;
    const [w, s, e, n] = b;
    const latC = (s + n) / 2;
    const lonC = (w + e) / 2;
    const R = 6371008.8;
    const rad = Math.PI / 180;
    const cosLat = Math.max(0.05, Math.cos(latC * rad));
    const hM = (n - s) * rad * R;
    const wM = (e - w) * rad * R * cosLat;
    const fill = 0.94; // small margin so the frame and its corner ticks stay clear of the HUD
    const frustum = rt.scene.camera.frustum;
    const fovy = frustum instanceof PerspectiveFrustum && frustum.fovy !== undefined ? frustum.fovy : Math.PI / 3;
    const k = 2 * Math.tan(fovy / 2);
    const rangeM = this.clampRange((Math.max(hM / (fh * fill), wM / (fw * fill)) * ch) / k);
    const mpp = (rangeM * k) / ch;
    // Free-rectangle centre relative to the canvas centre (px, +x right, +y down): aim the camera the other way.
    const dx = ins.left + fw / 2 - cw / 2;
    const dy = ins.top + fh / 2 - ch / 2;
    return {
      lonDeg: lonC - (dx * mpp) / (R * cosLat) / rad,
      latDeg: latC + (dy * mpp) / R / rad,
      rangeM,
      headingDeg: 0,
      pitchDeg: -90,
    };
  }

  private clampRange(r: number): number {
    return Math.min(this.cfg.rangeMaxM, Math.max(this.cfg.rangeMinM, r));
  }

  // ───────────────────────────────────────────── pointer

  private canvasXY(rt: Runtime, e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = rt.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pickLonLat(rt: Runtime, x: number, y: number): { lon: number; lat: number } | null {
    const scene = rt.scene;
    this.sWin.x = x;
    this.sWin.y = y;
    const ray = scene.camera.getPickRay(this.sWin, this.sRay);
    let hit: Cartesian3 | undefined;
    if (ray) hit = scene.globe.pick(ray, scene, this.sPick);
    if (!hit) hit = scene.camera.pickEllipsoid(this.sWin, this.ellipsoid, this.sPick);
    if (!hit) return null;
    const c = this.ellipsoid.cartesianToCartographic(hit, this.sCarto);
    if (!c) return null;
    return { lon: normLon((c.longitude * 180) / Math.PI), lat: (c.latitude * 180) / Math.PI };
  }

  private onPointerDown(rt: Runtime, e: PointerEvent): void {
    const { x, y } = this.canvasXY(rt, e);
    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, { x, y });
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        if (a && b) this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.pointerDown = null;
        return;
      }
    }
    if (this.pointerDown) return;
    this.pointerDown = { id: e.pointerId, x, y, button: e.button, dragging: false, lastX: x, lastY: y };
    if (this.opts.useCustomCamera) {
      try {
        rt.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
  }

  private onPointerMove(rt: Runtime, e: PointerEvent): void {
    const { x, y } = this.canvasXY(rt, e);
    this.hoverPos = { x, y };
    this.hoverDirty = true;
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x, y });
      if (this.touches.size === 2 && this.opts.useCustomCamera) {
        const [a, b] = [...this.touches.values()];
        if (a && b) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.pinchDist > 0 && d > 0) {
            this.flight = null;
            this.pendingNotches += Math.log(d / this.pinchDist) / Math.max(1e-3, this.cfg.wheelZoomStep);
          }
          this.pinchDist = d;
        }
        return;
      }
    }
    const pd = this.pointerDown;
    if (!pd || pd.id !== e.pointerId) return;
    if (!pd.dragging && Math.hypot(x - pd.x, y - pd.y) > CLICK_SLOP_PX) {
      pd.dragging = true;
      rt.root.classList.add("br-drag");
    }
    if (pd.dragging && this.opts.useCustomCamera) {
      const dx = x - pd.lastX;
      const dy = y - pd.lastY;
      this.flight = null;
      if (pd.button === 2 || pd.button === 1 || e.shiftKey) {
        // Rotate heading / tilt (convenience; keyboard Q/E R/F is the primary path).
        const pitch = Math.max(-90, Math.min(-5, this.cam.pitchDeg - dy * 0.25));
        this.cam = { ...this.cam, headingDeg: (((this.cam.headingDeg + dx * 0.3) % 360) + 360) % 360, pitchDeg: pitch };
      } else {
        const frustum = rt.scene.camera.frustum;
        const fovy = frustum instanceof PerspectiveFrustum && frustum.fovy !== undefined ? frustum.fovy : Math.PI / 3;
        const en = dragToEastNorthMetres(dx, dy, rt.canvas.clientHeight, fovy, this.cam.rangeM, this.cam.headingDeg);
        const ll = offsetLonLat(this.cam.lonDeg, this.cam.latDeg, en.east, en.north, this.cfg.latClampDeg);
        this.cam = { ...this.cam, lonDeg: ll.lonDeg, latDeg: ll.latDeg };
      }
    }
    pd.lastX = x;
    pd.lastY = y;
  }

  private onPointerUp(rt: Runtime, e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinchDist = 0;
    const pd = this.pointerDown;
    if (!pd || pd.id !== e.pointerId) return;
    this.pointerDown = null;
    rt.root.classList.remove("br-drag");
    try {
      rt.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (pd.dragging || pd.button !== 0) return;
    if (this.drawMode) this.handleDrawClick(rt, pd.x, pd.y, e.timeStamp);
  }

  private onPointerCancel(rt: Runtime, e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    if (this.pointerDown?.id === e.pointerId) this.pointerDown = null;
    rt.root.classList.remove("br-drag");
  }

  private handleDrawClick(rt: Runtime, x: number, y: number, t: number): void {
    // Second click of a double-click lands on the same spot: let "dblclick" close instead.
    const lc = this.lastClick;
    if (lc && t - lc.t < 400 && Math.hypot(x - lc.x, y - lc.y) < 6) {
      this.lastClick = null;
      return;
    }
    this.lastClick = { x, y, t };
    const v = this.roi.vertices;
    if (!this.roi.closed && v.length >= 3) {
      const first = v[0];
      if (first) {
        const pos = Cartesian3.fromDegrees(first.lon, first.lat, this.lastTargetTerrainM, this.ellipsoid, this.sTmp);
        const win = SceneTransforms.worldToWindowCoordinates(rt.scene, pos, this.sWin);
        if (win && Math.hypot(win.x - x, win.y - y) <= CLOSE_HIT_PX) {
          this.emitter.emit("roiCloseRequested", undefined);
          return;
        }
      }
    }
    const ll = this.pickLonLat(rt, x, y);
    if (ll) this.emitter.emit("roiVertexAdded", ll);
  }

  // ───────────────────────────────────────────── vector overlays

  private surfaceHeight(rt: Runtime, lonDeg: number, latDeg: number): number {
    const c = this.sCarto2;
    c.longitude = (lonDeg * Math.PI) / 180;
    c.latitude = (latDeg * Math.PI) / 180;
    c.height = 0;
    const h = rt.scene.globe.getHeight(c);
    return h !== undefined && Number.isFinite(h) ? h : 0;
  }

  private rebuildAoi(rt: Runtime): void {
    if (!rt.groundReady) return;
    if (rt.aoiPrim) rt.scene.groundPrimitives.remove(rt.aoiPrim);
    rt.aoiPrim = null;
    const b = this.opts.mission.aoi.bounds ?? this.opts.mission.effectiveBounds;
    if (!b) return;
    const [w, s, e, n] = b;
    const positions = Cartesian3.fromDegreesArray([w, s, e, s, e, n, w, n, w, s]);
    const material = Material.fromType("Color", { color: cssColor(PALETTE.amber, 0.95 * this.opacity.aoiOutline) });
    rt.aoiMaterial = material;
    // Corner ticks: a heavier L at each corner so the case frame reads as a survey frame, not a stray box.
    const tx = (e - w) * 0.06;
    const ty = (n - s) * 0.06;
    const tick = (pts: number[]) =>
      new GeometryInstance({
        geometry: new GroundPolylineGeometry({
          positions: Cartesian3.fromDegreesArray(pts),
          width: 6,
          arcType: ArcType.RHUMB,
        }),
      });
    rt.aoiPrim = rt.scene.groundPrimitives.add(
      new GroundPolylinePrimitive({
        geometryInstances: [
          new GeometryInstance({
            geometry: new GroundPolylineGeometry({ positions, width: 2, arcType: ArcType.RHUMB }),
          }),
          tick([w, s + ty, w, s, w + tx, s]),
          tick([e - tx, s, e, s, e, s + ty]),
          tick([e, n - ty, e, n, e - tx, n]),
          tick([w + tx, n, w, n, w, n - ty]),
        ],
        appearance: new PolylineMaterialAppearance({ material }),
        asynchronous: false,
        classificationType: ClassificationType.BOTH,
      }),
    ) as GroundPolylinePrimitive;
    rt.aoiPrim.show = this.visible.aoiOutline;
    // Matte Ink scrim outside the case area: the AOI reads as a lit table and the coarse base map recedes.
    // Static geometry (built once per rebuild), flat colour, no glow.
    if (rt.aoiScrim) rt.scene.groundPrimitives.remove(rt.aoiScrim);
    rt.aoiScrim = null;
    try {
      const pad = 3;
      const lat = (v: number) => Math.max(-85, Math.min(85, v));
      const outer = Cartesian3.fromDegreesArray([
        w - pad,
        lat(s - pad),
        e + pad,
        lat(s - pad),
        e + pad,
        lat(n + pad),
        w - pad,
        lat(n + pad),
      ]);
      const hole = Cartesian3.fromDegreesArray([w, s, w, n, e, n, e, s]);
      rt.aoiScrim = rt.scene.groundPrimitives.add(
        new GroundPrimitive({
          geometryInstances: new GeometryInstance({
            geometry: new PolygonGeometry({
              polygonHierarchy: new PolygonHierarchy(outer, [new PolygonHierarchy(hole)]),
              arcType: ArcType.RHUMB,
            }),
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(cssColor(PALETTE.ink, 0.5)) },
          }),
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
          asynchronous: false,
          classificationType: ClassificationType.BOTH,
        }),
      ) as GroundPrimitive;
      rt.aoiScrim.show = this.visible.aoiOutline;
    } catch (err) {
      console.warn("[renderer-globe] AOI scrim skipped", err);
    }
  }

  private rebuildRoi(rt: Runtime): void {
    const { scene } = rt;
    rt.roiPoints.removeAll();
    const { vertices, closed, valid, selectedIndex } = this.roi;
    const color = valid ? PALETTE.cyan : PALETTE.magenta;
    const ink = cssColor(PALETTE.ink, 0.9);
    vertices.forEach((v, i) => {
      const sel = i === selectedIndex;
      const firstHint = i === 0 && this.drawMode && !closed && vertices.length >= 3;
      rt.roiPoints.add({
        position: Cartesian3.fromDegrees(v.lon, v.lat, this.surfaceHeight(rt, v.lon, v.lat) + 2),
        pixelSize: sel ? 16 : firstHint ? 13 : 10,
        color: sel ? cssColor(PALETTE.pearl) : cssColor(color),
        outlineColor: sel ? cssColor(color) : ink,
        outlineWidth: sel ? 4 : 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    });
    if (!rt.groundReady) return;

    const oldFill = rt.roiFill;
    const oldCasing = rt.roiCasing;
    const oldEdges = rt.roiEdges;
    rt.roiFill = null;
    rt.roiCasing = null;
    rt.roiEdges = null;

    if (vertices.length >= 2) {
      const ring = closed && vertices.length >= 3 ? [...vertices, vertices[0] as LonLat] : vertices;
      const flat: number[] = [];
      for (const v of ring) flat.push(v.lon, v.lat);
      const positions = Cartesian3.fromDegreesArray(flat);
      const mkLine = (width: number, material: Material): GroundPolylinePrimitive =>
        scene.groundPrimitives.add(
          new GroundPolylinePrimitive({
            geometryInstances: new GeometryInstance({
              geometry: new GroundPolylineGeometry({ positions, width, arcType: ArcType.GEODESIC }),
            }),
            appearance: new PolylineMaterialAppearance({ material }),
            asynchronous: false,
            classificationType: ClassificationType.BOTH,
          }),
        ) as GroundPolylinePrimitive;
      if (closed && vertices.length >= 3 && isSimpleRing(vertices)) {
        try {
          rt.roiFill = scene.groundPrimitives.add(
            new GroundPrimitive({
              geometryInstances: new GeometryInstance({
                geometry: new PolygonGeometry({
                  polygonHierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat.slice(0, -2))),
                }),
                attributes: {
                  color: ColorGeometryInstanceAttribute.fromColor(cssColor(color, valid ? 0.2 : 0.14)),
                },
              }),
              appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
              asynchronous: false,
              classificationType: ClassificationType.BOTH,
            }),
          ) as GroundPrimitive;
        } catch (err) {
          console.warn("[renderer-globe] ROI fill skipped", err);
        }
      }
      rt.roiCasing = mkLine(6, Material.fromType("Color", { color: cssColor(PALETTE.ink, 0.55) }));
      rt.roiEdges = mkLine(
        3,
        valid
          ? Material.fromType("Color", { color: cssColor(PALETTE.cyan) })
          : Material.fromType(Material.PolylineDashType, {
              color: cssColor(PALETTE.magenta),
              gapColor: Color.TRANSPARENT,
              dashLength: 14,
            }),
      );
    }
    if (oldFill) scene.groundPrimitives.remove(oldFill);
    if (oldCasing) scene.groundPrimitives.remove(oldCasing);
    if (oldEdges) scene.groundPrimitives.remove(oldEdges);
  }

  private trackKeyOf(track: OrbitState[] | null): string {
    if (!track || track.length === 0) return "";
    const a = track[0];
    const b = track[track.length - 1];
    return `${track.length}|${a?.timeIso}|${b?.timeIso}|${a?.lonDeg}|${b?.lonDeg}`;
  }

  private rebuildTrack(rt: Runtime, force: boolean): void {
    const key = this.trackKeyOf(this.track);
    if (rt.groundReady && (force || key !== rt.trackKey)) {
      rt.trackKey = key;
      if (rt.trackPending) {
        rt.scene.groundPrimitives.remove(rt.trackPending);
        rt.trackPending = null;
      }
      if (!this.track || this.track.length < 2) {
        if (rt.trackPrim) rt.scene.groundPrimitives.remove(rt.trackPrim);
        rt.trackPrim = null;
      } else {
        const pieces = splitAtAntimeridian(this.track.map((o) => ({ lon: o.lonDeg, lat: o.latDeg })));
        const instances = pieces.map(
          (piece) =>
            new GeometryInstance({
              geometry: new GroundPolylineGeometry({
                positions: Cartesian3.fromDegreesArray(piece.flatMap((p) => [p.lon, p.lat])),
                width: 2,
                arcType: ArcType.GEODESIC,
              }),
            }),
        );
        const material = Material.fromType("Color", { color: cssColor(PALETTE.pearl, 0.7 * this.opacity.groundTrack) });
        rt.trackMaterial = material;
        const prim = new GroundPolylinePrimitive({
          geometryInstances: instances,
          appearance: new PolylineMaterialAppearance({ material }),
          asynchronous: true,
          classificationType: ClassificationType.BOTH,
        });
        prim.show = this.visible.groundTrack;
        rt.trackPending = rt.scene.groundPrimitives.add(prim) as GroundPolylinePrimitive;
      }
    }
    // Satellite marker at orbital height + nadir line (cheap; updated every call).
    rt.satPoints.removeAll();
    rt.satLines.removeAll();
    rt.satLabels.removeAll();
    const cur = this.current;
    if (cur && Number.isFinite(cur.lonDeg) && Number.isFinite(cur.latDeg) && Number.isFinite(cur.heightM)) {
      const sat = Cartesian3.fromDegrees(cur.lonDeg, cur.latDeg, cur.heightM);
      const ground = Cartesian3.fromDegrees(cur.lonDeg, cur.latDeg, 0);
      rt.satLines.add({
        positions: [ground, sat],
        width: 1.5,
        material: Material.fromType("Color", { color: cssColor(PALETTE.pearl, 0.55) }),
      });
      rt.satPoints.add({
        position: sat,
        pixelSize: 11,
        color: cssColor(PALETTE.amber),
        outlineColor: cssColor(PALETTE.ink),
        outlineWidth: 2,
      });
      rt.satPoints.add({
        position: ground,
        pixelSize: 6,
        color: cssColor(PALETTE.pearl, 0.9),
        outlineColor: cssColor(PALETTE.ink),
        outlineWidth: 1,
      });
      rt.satLabels.add({
        position: sat,
        text: "NISAR",
        font: '600 13px "IBM Plex Mono", ui-monospace, monospace',
        fillColor: cssColor(PALETTE.pearl),
        style: LabelStyle.FILL,
        showBackground: true,
        backgroundColor: cssColor(PALETTE.ink, 0.8),
        backgroundPadding: new Cartesian2(6, 4),
        pixelOffset: new Cartesian2(12, -10),
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.BOTTOM,
      });
    }
    const on = this.visible.groundTrack;
    rt.satPoints.show = on;
    rt.satLines.show = on;
    rt.satLabels.show = on;
  }

  // ───────────────────────────────────────────── quality

  private applyQualityNow(rt: Runtime, q: QualityPreset): void {
    const globe = rt.scene.globe;
    globe.tileCacheSize = q.tileCacheSize;
    globe.maximumScreenSpaceError = q.maximumScreenSpaceError;
    rt.widget.useBrowserRecommendedResolution = !q.allow4k;
    rt.widget.resolutionScale = q.renderScale;
    this.appliedQuality = q;
  }

  // ───────────────────────────────────────────── context loss / rebuild

  private onContextLost(rt: Runtime): void {
    if (rt.dead || this.destroyed || rt !== this.rt) return;
    this.patchStatus({ contextLost: true });
    this.emitter.emit("contextLost", undefined);
    if (!this.opts.useCustomCamera) this.snapshotDefaultView(rt);
    this.teardownRuntime(rt, false);
    this.rt = null;
    this.restoreStartedMs = performance.now();
    this.scheduleRebuild(50);
  }

  private scheduleRebuild(delayMs: number): void {
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null;
      this.rebuildNow();
    }, delayMs);
  }

  private rebuildNow(): void {
    if (this.destroyed || this.rt) return;
    try {
      this.rt = this.buildRuntime();
      this.awaitingRestoredFrame = true;
      this.applyAllState(this.rt);
    } catch (err) {
      if (performance.now() - this.restoreStartedMs < RESTORE_BUDGET_MS) {
        this.scheduleRebuild(400);
      } else {
        this.patchStatus({
          message: `Graphics context could not be restored: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  private applyAllState(rt: Runtime): void {
    this.applyLayerAlphas(rt);
    this.rebuildRoi(rt);
    this.rebuildTrack(rt, true);
    this.rebuildAnnotations(rt);
    rt.root.classList.toggle("br-draw", this.drawMode);
  }

  /** §10 addendum: amber dashed rings clamped to the surface + labels on a small Ink scrim. */
  private rebuildAnnotations(rt: Runtime): void {
    rt.annoLabels.removeAll();
    const items = this.annotations.filter(
      (a) => a.ring.length >= 2 && a.ring.every((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat)),
    );
    for (const a of items) {
      // Label anchored at the ring's northernmost vertex so it never covers the flagged area.
      let top = a.ring[0] as LonLat;
      for (const p of a.ring) if (p.lat > top.lat) top = p;
      rt.annoLabels.add({
        position: Cartesian3.fromDegrees(top.lon, top.lat, this.surfaceHeight(rt, top.lon, top.lat) + 5),
        text: a.label,
        font: '600 13px "IBM Plex Sans", system-ui, sans-serif',
        fillColor: cssColor(PALETTE.amber),
        style: LabelStyle.FILL,
        showBackground: true,
        backgroundColor: cssColor(PALETTE.ink, 0.82),
        backgroundPadding: new Cartesian2(6, 4),
        pixelOffset: new Cartesian2(0, -8),
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    if (!rt.groundReady) return;
    const old = rt.annoPrim;
    rt.annoPrim = null;
    if (items.length > 0) {
      const instances = items.map((a) => {
        const flat: number[] = [];
        for (const p of a.ring) flat.push(p.lon, p.lat);
        const first = a.ring[0] as LonLat;
        const last = a.ring[a.ring.length - 1] as LonLat;
        if (a.ring.length >= 3 && (first.lon !== last.lon || first.lat !== last.lat)) flat.push(first.lon, first.lat);
        return new GeometryInstance({
          id: a.id,
          geometry: new GroundPolylineGeometry({
            positions: Cartesian3.fromDegreesArray(flat),
            width: 3,
            arcType: ArcType.GEODESIC,
          }),
        });
      });
      rt.annoPrim = rt.scene.groundPrimitives.add(
        new GroundPolylinePrimitive({
          geometryInstances: instances,
          appearance: new PolylineMaterialAppearance({
            material: Material.fromType(Material.PolylineDashType, {
              color: cssColor(PALETTE.amber),
              gapColor: cssColor(PALETTE.ink, 0.45),
              dashLength: 12,
            }),
          }),
          asynchronous: false,
          classificationType: ClassificationType.BOTH,
        }),
      ) as GroundPolylinePrimitive;
    }
    if (old) rt.scene.groundPrimitives.remove(old);
  }

  private teardownRuntime(rt: Runtime, releaseContext: boolean): void {
    rt.dead = true;
    for (const r of rt.removers.splice(0)) {
      try {
        r();
      } catch {
        /* ignore */
      }
    }
    try {
      rt.widget.useDefaultRenderLoop = false;
    } catch {
      /* ignore */
    }
    try {
      if (!rt.widget.isDestroyed()) rt.widget.destroy();
    } catch (err) {
      console.warn("[renderer-globe] widget destroy failed", err);
    }
    if (releaseContext && rt.loseExt) {
      try {
        rt.loseExt.loseContext();
      } catch {
        /* already lost */
      }
    }
    rt.root.remove();
    this.pointerDown = null;
    this.touches.clear();
  }

  private patchStatus(patch: Partial<GlobeStatus>): void {
    const next = { ...this.status, ...patch };
    const changed = (Object.keys(next) as Array<keyof GlobeStatus>).some((k) => next[k] !== this.status[k]);
    this.status = next;
    if (changed) this.emitter.emit("status", { ...next });
  }

  // ───────────────────────────────────────────── public API (§5)

  setStep(step: TemporalStep | null): void {
    this.step = step;
    if (this.rt) {
      if (step && step.isAvailable && !this.rt.evidence.has(step.stepId)) {
        // Step not part of the manifest preload (host passed a foreign step): add it now.
        const l = this.stepLayer(step);
        if (l) {
          this.rt.scene.imageryLayers.add(l);
          this.rt.evidence.set(step.stepId, l);
          this.reorderLayers(this.rt);
        }
      }
      this.applyLayerAlphas(this.rt);
    }
  }

  setContextLayer(layerId: string | null): void {
    this.contextLayerId = layerId;
    if (this.rt) {
      if (layerId) this.ensureContextLayer(this.rt, layerId);
      this.applyLayerAlphas(this.rt);
    }
  }

  setLayerVisible(layer: GlobeLayer, visible: boolean): void {
    this.visible[layer] = visible;
    if (!this.rt) return;
    if (layer === "referenceMask" && visible) this.ensureReference(this.rt);
    this.applyLayerAlphas(this.rt);
  }

  setLayerOpacity(layer: GlobeLayer, opacity: number): void {
    this.opacity[layer] = clamp01(opacity);
    if (this.rt) this.applyLayerAlphas(this.rt);
  }

  setRoi(vertices: LonLat[], state: { closed: boolean; valid: boolean; selectedIndex: number | null }): void {
    this.roi = {
      vertices: vertices.map((v) => ({ lon: v.lon, lat: v.lat })),
      closed: state.closed,
      valid: state.valid,
      selectedIndex: state.selectedIndex,
    };
    if (this.rt) this.rebuildRoi(this.rt);
  }

  setRoiDrawMode(enabled: boolean): void {
    this.drawMode = enabled;
    this.lastClick = null;
    if (this.rt) {
      this.rt.root.classList.toggle("br-draw", enabled);
      this.rebuildRoi(this.rt);
    }
  }

  setGroundTrack(track: OrbitState[] | null, current: OrbitState | null): void {
    this.track = track;
    this.current = current;
    if (this.rt) this.rebuildTrack(this.rt, false);
  }

  setAnnotations(items: GlobeAnnotation[]): void {
    this.annotations = items.map((a) => ({
      id: a.id,
      label: a.label,
      kind: a.kind,
      ring: a.ring.map((p) => ({ lon: p.lon, lat: p.lat })),
    }));
    if (this.rt) this.rebuildAnnotations(this.rt);
  }

  flyTo(target: "home" | "aoi"): void {
    const to = this.targetPose(target);
    if (this.opts.useCustomCamera) {
      if (this.opts.reducedMotion) {
        this.flight = null;
        this.cam = { ...to };
        this.lastGoodCam = cloneCam(this.cam);
        return;
      }
      const from: CamPose = cloneCam(this.cam);
      this.flight = { from, to, startMs: performance.now(), durationMs: flightDurationMs(from, to) };
      return;
    }
    const rt = this.rt;
    if (!rt) {
      this.cam = { ...to };
      this.defaultView = null;
      return;
    }
    const pitch = (to.pitchDeg * Math.PI) / 180;
    const height = to.rangeM * Math.max(0.05, Math.sin(-pitch));
    rt.scene.camera.flyTo({
      destination: Cartesian3.fromDegrees(to.lonDeg, to.latDeg, height),
      orientation: { heading: (to.headingDeg * Math.PI) / 180, pitch, roll: 0 },
      duration: this.opts.reducedMotion ? 0 : flightDurationMs(cloneCam(this.cam), to) / 1000,
    });
  }

  setInputSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.held.clear();
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    const rt = this.rt;
    if (!rt) return;
    // Cache size and SSE are safe to change any time; resolution waits for the camera to settle.
    rt.scene.globe.tileCacheSize = q.tileCacheSize;
    rt.scene.globe.maximumScreenSpaceError = q.maximumScreenSpaceError;
    if (performance.now() - this.lastMotionMs > QUALITY_IDLE_MS) this.applyQualityNow(rt, q);
  }

  getStatus(): GlobeStatus {
    return { ...this.status };
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.rt) throw new Error("Globe canvas unavailable (context lost or destroyed)");
    return this.rt.canvas;
  }

  on<K extends keyof GlobeEvents>(ev: K, fn: (p: GlobeEvents[K]) => void): () => void {
    return this.emitter.on(ev, fn);
  }

  pause(): void {
    this.paused = true;
    this.held.clear();
    if (this.rt) this.rt.widget.useDefaultRenderLoop = false;
  }

  resume(): void {
    this.paused = false;
    this.lastFrameMs = -1;
    this.stepper.reset();
    if (this.rt) this.rt.widget.useDefaultRenderLoop = true;
  }

  forceContextLoss(): void {
    const rt = this.rt;
    if (!rt) return;
    if (rt.loseExt) rt.loseExt.loseContext();
    else this.onContextLost(rt);
  }

  forceContextRestore(): void {
    if (this.destroyed || this.rt) return;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
    this.rebuildNow();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    for (const r of this.windowListeners.splice(0)) r();
    if (this.rt) this.teardownRuntime(this.rt, true);
    this.rt = null;
    this.held.clear();
    this.emitter.clear();
    this.resolveReady = null;
  }

  // ───────────────────────────────────────────── internals exposed to the sandbox harness

  /** @internal */ getRuntimeScene(): Scene | null {
    return this.rt?.scene ?? null;
  }
  /** @internal */ getCamState(): OrbitCamState {
    return cloneCam(this.cam);
  }
  /** @internal */ setCamState(s: OrbitCamState): void {
    this.flight = null;
    this.cam = cloneCam(s);
    this.lastGoodCam = cloneCam(s);
  }
  /** @internal */ resetTerrainMemory(): void {
    this.lastKnownTerrainM = 0;
    this.lastTargetTerrainM = 0;
    this.lastFloorTerrainM = Number.NEGATIVE_INFINITY;
    this.heightCache.clear();
  }
  /** @internal */ setLogDepth(on: boolean): void {
    if (this.rt) this.rt.scene.logarithmicDepthBuffer = on;
    this.patchStatus({ logDepth: on });
  }
}

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

export function createGlobeRenderer(opts: GlobeRendererOptions): GlobeRenderer {
  return new GlobeRendererImpl(opts);
}
