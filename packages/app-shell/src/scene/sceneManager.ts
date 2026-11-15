/* Single-live-canvas lifecycle. Exactly one WebGL2 renderer (globe OR hub) exists at any time; the
 * outgoing one is destroy()ed while the wipe covers the screen, the incoming one is created behind it. */
import { loadMission, loadPrefabs } from "../data/loaders";
import { createStubGlobeRenderer, createStubHubRenderer } from "../dev/stubRenderers";
import { env } from "../env";
import { reducedMotion, useApp } from "../store";
import type {
  GlobeRenderer,
  GlobeRendererOptions,
  HubMission,
  HubRenderer,
  HubRendererOptions,
  MissionManifest,
} from "../types";

export type SceneKind = "hub" | "mission";

export type LiveScene =
  | { kind: "mission"; renderer: GlobeRenderer; host: HTMLDivElement; impl: "cesium" | "stub"; createdAt: number }
  | { kind: "hub"; renderer: HubRenderer; host: HTMLDivElement; impl: "three" | "stub"; createdAt: number }
  | { kind: "hub"; renderer: null; host: HTMLDivElement; impl: "2d"; createdAt: number };

let root: HTMLElement | null = null;
let live: LiveScene | null = null;
const listeners = new Set<(s: LiveScene | null) => void>();
/** Count of renderers created / destroyed — the harness asserts created − destroyed ≤ 1. */
export const lifecycle = { created: 0, destroyed: 0, maxLive: 0 };

export function setSceneRoot(el: HTMLElement | null): void {
  root = el;
}
export function currentScene(): LiveScene | null {
  return live;
}
export function onSceneChange(fn: (s: LiveScene | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(): void {
  for (const fn of listeners) fn(live);
}

function makeHost(kind: SceneKind): HTMLDivElement {
  if (!root) throw new Error("scene root not mounted");
  const host = document.createElement("div");
  host.className = `scene-host scene-host--${kind}`;
  host.dataset.scene = kind;
  root.appendChild(host);
  return host;
}

export function unmountScene(): void {
  if (!live) return;
  const old = live;
  live = null;
  emit();
  try {
    old.renderer?.destroy();
  } catch (e) {
    console.warn("[scene] destroy failed", e);
  }
  if (old.renderer) lifecycle.destroyed++;
  old.host.remove();
}

function track(): void {
  const alive = lifecycle.created - lifecycle.destroyed;
  lifecycle.maxLive = Math.max(lifecycle.maxLive, alive);
}

export function hubMissions(): HubMission[] {
  const m = loadMission();
  return [
    { id: m.missionId, caseId: m.caseId, title: m.title, kicker: m.kicker, theme: m.theme, locked: false },
    {
      id: "green-kingdom",
      caseId: "CASE_002",
      title: "The Green Kingdom",
      kicker: "Forests and vegetation",
      theme: "deforestation",
      locked: true,
    },
    {
      id: "drowned-world",
      caseId: "CASE_003",
      title: "The Drowned World",
      kicker: "Wetlands and water",
      theme: "wetlands",
      locked: true,
    },
    {
      id: "frozen-frontier",
      caseId: "CASE_004",
      title: "The Frozen Frontier",
      kicker: "Ice and glaciers",
      theme: "glacier",
      locked: true,
    },
  ];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** HUD-aware framing: the side panels, tool rail and timeline cover ~55 % of the screen, so the AOI
 *  camera is pulled back and nudged south to centre the AOI in the free area (manifest left untouched). */
function hudFramed(m: MissionManifest): MissionManifest {
  const aoi = m.camera.aoi;
  const latSpan = m.effectiveBounds[3] - m.effectiveBounds[1];
  // Free area: between ≤ 340 px side panels (collapsed on small screens) and above a ~190 px timeline.
  const compact = typeof innerHeight === "number" && innerHeight <= 820;
  const k = compact ? 1.9 : 1.6;
  const shift = compact ? 0.2 : 0.1;
  return { ...m, camera: { ...m.camera, aoi: { ...aoi, heightM: aoi.heightM * k, lat: aoi.lat - latSpan * shift } } };
}

/** Create the globe behind the wipe. Falls back to the Canvas2D fixture when Cesium fails. */
async function mountGlobe(): Promise<LiveScene> {
  const st = useApp.getState();
  const prefabs = loadPrefabs();
  const mission = loadMission();
  const host = makeHost("mission");
  const opts: GlobeRendererOptions = {
    container: host,
    mission: env.stub ? mission : hudFramed(mission),
    quality: prefabs.quality[st.settings.quality],
    cameraConfig: prefabs.camera,
    basemap: prefabs.basemap,
    ionToken: env.offline ? null : env.ionToken,
    reducedMotion: reducedMotion(),
    useCustomCamera: st.settings.customCamera,
    offlineOnly: env.offline,
  };
  if (!env.stub) {
    try {
      const mod = await import("@blindrev/renderer-globe");
      const renderer = mod.createGlobeRenderer(opts);
      lifecycle.created++;
      track();
      useApp.setState({ globeMode: "cesium", globeFallbackReason: null });
      return { kind: "mission", renderer, host, impl: "cesium", createdAt: performance.now() };
    } catch (e) {
      console.warn("[scene] globe renderer failed — using 2D fixture", e);
      host.replaceChildren();
      useApp.setState({ globeMode: "stub", globeFallbackReason: errMsg(e) });
    }
  }
  const renderer = createStubGlobeRenderer(opts);
  lifecycle.created++;
  track();
  return { kind: "mission", renderer, host, impl: "stub", createdAt: performance.now() };
}

async function mountHub(): Promise<LiveScene> {
  const st = useApp.getState();
  const prefabs = loadPrefabs();
  const host = makeHost("hub");
  const opts: HubRendererOptions = {
    container: host,
    missions: hubMissions(),
    quality: prefabs.quality[st.settings.quality],
    reducedMotion: reducedMotion(),
    nisar: st.nisar,
  };
  if (env.stub) {
    const renderer = createStubHubRenderer(opts);
    lifecycle.created++;
    track();
    return { kind: "hub", renderer, host, impl: "stub", createdAt: performance.now() };
  }
  if (st.hubMode === "2d") return { kind: "hub", renderer: null, host, impl: "2d", createdAt: performance.now() };
  try {
    const mod = await import("@blindrev/renderer-iss");
    const renderer = mod.createHubRenderer(opts);
    lifecycle.created++;
    track();
    return { kind: "hub", renderer, host, impl: "three", createdAt: performance.now() };
  } catch (e) {
    console.warn("[scene] hub renderer failed — using the 2D command board", e);
    host.replaceChildren();
    useApp.setState({ hubMode: "2d", hubFallbackReason: errMsg(e) });
    return { kind: "hub", renderer: null, host, impl: "2d", createdAt: performance.now() };
  }
}

/** Mount a scene and resolve when it is ready (or when it failed and a fallback replaced it). */
export async function mountScene(
  kind: SceneKind,
  onProgress: (p: number | null) => void,
  hardLimitMs = 20000,
): Promise<LiveScene> {
  if (live) unmountScene();
  let scene = kind === "mission" ? await mountGlobe() : await mountHub();
  live = scene;
  emit();
  if (!scene.renderer) return scene;

  let off: (() => void) | null = null;
  if (scene.kind === "mission") {
    off = scene.renderer.on("progress", (p) => {
      const total = p.loaded + p.pending;
      onProgress(total > 0 ? p.loaded / total : null);
    });
  }
  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), hardLimitMs));
  try {
    const res = await Promise.race([scene.renderer.ready.then(() => "ok" as const), timeout]);
    if (res === "timeout") console.warn(`[scene] ${kind} not ready after ${hardLimitMs} ms — revealing anyway`);
  } catch (e) {
    console.warn(`[scene] ${kind} ready rejected — falling back`, e);
    off?.();
    off = null;
    unmountScene();
    if (kind === "mission") {
      useApp.setState({ globeMode: "stub", globeFallbackReason: errMsg(e) });
      const host = makeHost("mission");
      const prefabs = loadPrefabs();
      const st = useApp.getState();
      const renderer = createStubGlobeRenderer({
        container: host,
        mission: loadMission(),
        quality: prefabs.quality[st.settings.quality],
        cameraConfig: prefabs.camera,
        basemap: prefabs.basemap,
        ionToken: null,
        reducedMotion: reducedMotion(),
        useCustomCamera: st.settings.customCamera,
        offlineOnly: true,
      });
      lifecycle.created++;
      track();
      scene = { kind: "mission", renderer, host, impl: "stub", createdAt: performance.now() };
      await renderer.ready;
    } else {
      useApp.setState({ hubMode: "2d", hubFallbackReason: errMsg(e) });
      scene = { kind: "hub", renderer: null, host: makeHost("hub"), impl: "2d", createdAt: performance.now() };
    }
    live = scene;
    emit();
  } finally {
    off?.();
  }
  return scene;
}
