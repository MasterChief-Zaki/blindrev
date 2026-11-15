/* Type-only re-exports. `import type` is erased at build time, so pulling renderer types here never
 * drags Cesium / Three into the main chunk — the renderers themselves load lazily via import(). */
export type {
  Bounds,
  CameraConfig,
  DataLabel,
  GameConstants,
  LonLat,
  MaskGrid,
  MissionManifest,
  OrbitState,
  QualityPreset,
  RoiValidation,
  ScoreOutcome,
  TemporalStep,
  TemporalWatch,
  WatchEmission,
  WatchSnapshot,
  WatchState,
} from "@blindrev/core-sim";
export type {
  GlobeEvents,
  GlobeLayer,
  GlobeRenderer,
  GlobeRendererOptions,
  GlobeStatus,
} from "@blindrev/renderer-globe";
export type { HubEvents, HubMission, HubRenderer, HubRendererOptions } from "@blindrev/renderer-iss";

import type { GlobeStatus } from "@blindrev/renderer-globe";
export type GlobeStatusLike = GlobeStatus;
