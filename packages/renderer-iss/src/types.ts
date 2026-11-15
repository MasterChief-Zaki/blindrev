/**
 * Public types of @blindrev/renderer-iss (ARCHITECTURE §5).
 * `OrbitState` / `QualityPreset` are structurally compatible with the core-sim contracts.
 */
import type { QualityPreset } from "@blindrev/core-sim";

/** Structural subset of core-sim's `OrbitState` (§4). Any `OrbitState` is assignable to it. */
export interface HubOrbitState {
  timeIso: string;
  lonDeg: number;
  latDeg: number;
  heightM: number;
  velEcefMps?: { x: number; y: number; z: number };
  ecefM?: { x: number; y: number; z: number };
}

export interface HubMission {
  id: string;
  caseId: string;
  title: string;
  kicker: string;
  theme: string;
  locked: boolean;
}

export interface HubEvents {
  missionFocus: string | null;
  missionSelect: string;
  contextLost: undefined;
  contextRestored: undefined;
}

export interface HubRendererOptions {
  container: HTMLElement;
  missions: HubMission[];
  quality: QualityPreset;
  reducedMotion: boolean;
  nisar: HubOrbitState | null;
}

export interface HubRenderer {
  /** Resolves when textures/models are loaded and the first frame is drawn. Rejects (never hangs) on fatal failure. */
  readonly ready: Promise<void>;
  /** DOM HUD drives focus too (keyboard parity). Produces the same highlight as pointer hover. Does not emit `missionFocus`. */
  focusMission(id: string | null): void;
  /** Propagated NISAR sub-satellite state (not telemetry). Drives the Earth orientation under the exhibit + the telemetry strip. */
  setNisar(state: HubOrbitState | null): void;
  on<K extends keyof HubEvents>(ev: K, fn: (p: HubEvents[K]) => void): () => void;
  getCanvas(): HTMLCanvasElement;
  pause(): void;
  resume(): void;
  /** WEBGL_lose_context.loseContext(), for the A1 harness. */
  forceContextLoss(): void;
  /** WEBGL_lose_context.restoreContext(), for the A1 harness. */
  forceContextRestore(): void;
  /** Releases every GPU resource, removes listeners and the canvas, and loses the GL context. Idempotent. */
  destroy(): void;
}

/** Thrown synchronously by `createHubRenderer` when no WebGL2 context can be created. */
export class WebGL2UnavailableError extends Error {
  override readonly name = "WebGL2UnavailableError";
  constructor(message = "WebGL2 is not available in this browser/WebView.") {
    super(message);
  }
}
