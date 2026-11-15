import type {
  CameraConfig,
  LonLat,
  MissionManifest,
  OrbitState,
  QualityPreset,
  TemporalStep,
} from "@blindrev/core-sim";

// ARCHITECTURE §5 — @blindrev/renderer-globe public contract (names are normative).

export type GlobeLayer = "evidence" | "qa" | "context" | "referenceMask" | "groundTrack" | "aoiOutline";

/** ARCHITECTURE §10 addendum — Anomaly Detector flags (decoys included). Amber dashed ring + label. */
export interface GlobeAnnotation {
  id: string;
  label: string;
  ring: LonLat[];
  kind: "anomaly" | "note";
}

export interface GlobeStatus {
  terrain: "WORLD_TERRAIN" | "ELLIPSOID";
  imagery: "ONLINE" | "OFFLINE_BUNDLED";
  offline: boolean;
  contextLost: boolean;
  sceneReady: boolean;
  logDepth: boolean;
  webgl2: boolean;
  message: string | null;
}

export interface GlobeEvents {
  status: GlobeStatus;
  roiVertexAdded: LonLat;
  roiCloseRequested: void;
  camera: { lonDeg: number; latDeg: number; heightM: number };
  pointer: { lon: number; lat: number } | null;
  contextLost: void;
  contextRestored: void;
  progress: { loaded: number; pending: number };
}

export interface GlobeRendererOptions {
  container: HTMLElement;
  mission: MissionManifest;
  quality: QualityPreset;
  cameraConfig: CameraConfig;
  basemap: unknown /* data/prefabs/basemap.json */;
  ionToken: string | null;
  reducedMotion: boolean;
  useCustomCamera: boolean; // false = Cesium default controller (documented rollback)
  offlineOnly?: boolean; // true = never touch the network (tests, OFFLINE mode)
}

export interface GlobeRenderer {
  readonly ready: Promise<void>; // scene-ready: terrain provider ready + first imagery drawn
  setStep(step: TemporalStep | null): void; // swap the evidence raster (and its QA mask); unavailable step → hide evidence
  setContextLayer(layerId: string | null): void;
  setLayerVisible(layer: GlobeLayer, visible: boolean): void;
  setLayerOpacity(layer: GlobeLayer, opacity: number): void;
  setRoi(vertices: LonLat[], state: { closed: boolean; valid: boolean; selectedIndex: number | null }): void;
  setRoiDrawMode(enabled: boolean): void; // pointer click → "roiVertexAdded"; click on first vertex / dblclick → "roiCloseRequested"
  setGroundTrack(track: OrbitState[] | null, current: OrbitState | null): void; // nadir track only, no swath
  setAnnotations(items: GlobeAnnotation[]): void; // §10 addendum; [] clears; survives context-loss rebuilds
  flyTo(target: "home" | "aoi"): void; // instant under reducedMotion
  /**
   * Optional (additive). CSS-px insets of the HUD around the free map rectangle. Once set, the "aoi" target
   * fits the AOI bounds to that rectangle for any viewport size and panel state (null = authored pose).
   */
  setViewInsets?(insets: { top: number; right: number; bottom: number; left: number } | null): void;
  setInputSuspended(suspended: boolean): void; // focus arbitration: HUD inputs/modals hold the keyboard
  setQuality(q: QualityPreset): void;
  getStatus(): GlobeStatus;
  getCanvas(): HTMLCanvasElement;
  on<K extends keyof GlobeEvents>(ev: K, fn: (p: GlobeEvents[K]) => void): () => void;
  pause(): void;
  resume(): void;
  forceContextLoss(): void;
  forceContextRestore(): void; // WEBGL_lose_context, for the A1 harness
  destroy(): void; // releases every GPU resource and removes the canvas
}

export class WebGL2UnavailableError extends Error {
  override readonly name = "WebGL2UnavailableError";
  constructor(
    message = "WebGL2 is required for the mission globe but is not available.",
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
