import { loadPrefabs } from "../data/loaders";
import type { RouteId } from "../env";
import { playCue } from "../mission/sound";
import { reducedMotion, useApp } from "../store";
import { mountScene, unmountScene } from "./sceneManager";

export interface RouteTiming {
  from: RouteId;
  to: RouteId;
  /** cover-complete → first frame after renderer.ready (visible blank / Ink-only time) */
  blankMs: number;
  /** renderer construction → ready */
  readyMs: number;
  coverMs: number;
  slow: boolean;
  impl: string;
  /** hub → case data tunnel shown (its 1.2 s minimum is included in blankMs — documented deviation) */
  tunnel: boolean;
  tunnelSkipped: boolean;
  at: string;
}

export const routeTimings: RouteTiming[] = [];
let busy = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame((t) => r(t)));

const LABELS: Record<RouteId, string> = {
  menu: "Returning to base",
  hub: "Preparing your expedition",
  mission: "Preparing your expedition",
};

/** Data tunnel (hub → case): min 1.2 s, max 2 s, skippable (deviation logged in docs/decisions/F.md). */
export const TUNNEL_MIN_MS = 1200;
export const TUNNEL_MAX_MS = 2000;
let skipResolve: (() => void) | null = null;
export function skipTunnel(): void {
  const w = useApp.getState().wipe;
  if (w.mode === "tunnel") useApp.setState({ wipe: { ...w, mode: "loading" } });
  skipResolve?.();
}

export function isNavigating(): boolean {
  return busy;
}

/** Route switch: wipe to Ink (500 ms), destroy the outgoing renderer while covered, mount the incoming
 *  one behind the wipe, hold with a progress HUD until ready (3 s cap → loading-screen state), reveal. */
export async function navigate(to: RouteId): Promise<RouteTiming | null> {
  if (busy) return null;
  const st = useApp.getState();
  if (st.route === to && to !== "mission") return null;
  busy = true;
  const from = st.route;
  const { wipe } = loadPrefabs().constants;
  const rm = reducedMotion();
  const dur = rm ? 0 : wipe.durationMs;
  const set = (p: Partial<ReturnType<typeof useApp.getState>["wipe"]>) =>
    useApp.setState((s) => ({ wipe: { ...s.wipe, ...p } }));

  try {
    const t0 = performance.now();
    const tunnel = from === "hub" && to === "mission" && !rm;
    set({ phase: "covering", progress: null, label: LABELS[to], slow: false, mode: tunnel ? "tunnel" : "loading" });
    playCue("wipe");
    if (dur) await sleep(dur);
    set({ phase: "covered" });
    const tCovered = performance.now();

    // Outgoing renderer is destroyed while fully occluded.
    unmountScene();
    useApp.setState({ route: to, overlay: null, overlayReturn: null });
    await nextFrame();

    let readyMs = 0;
    let impl = "dom";
    let skipped = false;
    const skip = new Promise<void>((r) => {
      skipResolve = () => {
        skipped = true;
        r();
      };
    });
    const tunnelEnd = tunnel
      ? setTimeout(() => {
          const w = useApp.getState().wipe;
          if (w.mode === "tunnel") set({ mode: "loading" });
        }, TUNNEL_MAX_MS)
      : null;
    if (to !== "menu") {
      const slowTimer = setTimeout(() => set({ slow: true }), wipe.progressCapMs);
      const tMount = performance.now();
      const scene = await mountScene(to, (p) => set({ progress: p }));
      readyMs = performance.now() - tMount;
      clearTimeout(slowTimer);
      impl = scene.impl;
      set({ progress: 1 });
    }
    if (tunnel && !skipped) {
      const left = TUNNEL_MIN_MS - (performance.now() - tCovered);
      if (left > 0) await Promise.race([skip, sleep(left)]);
    }
    if (tunnelEnd) clearTimeout(tunnelEnd);
    skipResolve = null;
    await nextFrame();
    const blankMs = performance.now() - tCovered;
    const timing: RouteTiming = {
      from,
      to,
      blankMs: Math.round(blankMs * 10) / 10,
      readyMs: Math.round(readyMs * 10) / 10,
      coverMs: Math.round((tCovered - t0) * 10) / 10,
      slow: useApp.getState().wipe.slow,
      impl,
      tunnel,
      tunnelSkipped: skipped,
      at: new Date().toISOString(),
    };
    routeTimings.push(timing);
    set({ phase: "revealing", slow: false, mode: "loading" });
    if (dur) await sleep(dur);
    set({ phase: "idle", progress: null });
    return timing;
  } catch (e) {
    console.error("[navigate] failed", e);
    set({ phase: "idle", progress: null, slow: false });
    useApp.setState({ bootError: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    busy = false;
  }
}

export function p95(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? null;
}
