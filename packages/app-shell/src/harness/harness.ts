/* window.__BLINDREV__ — E2E + §12 budget harness. Honest by construction: anything not measured is
 * reported as NOT MEASURED with a reason. */
import { loadPrefabs } from "../data/loaders";
import type { RouteId } from "../env";
import { env } from "../env";
import {
  getMission,
  getWatch,
  pairStatus,
  roiActions,
  setPair,
  validateMission,
  validateStatus,
  watchActions,
} from "../mission/controller";
import { tleRefreshLog } from "../mission/nisar";
import { navigate, p95, routeTimings } from "../scene/navigation";
import { currentScene, lifecycle } from "../scene/sceneManager";
import { useApp } from "../store";
import type { LonLat } from "../types";

/* ------------------------------------------------------------ frame sampler */
const frame = { samples: [] as number[], running: false, raf: 0, last: 0, startedAt: 0 };
function frameLoop(t: number): void {
  if (!frame.running) return;
  if (frame.last) frame.samples.push(t - frame.last);
  if (frame.samples.length > 20000) frame.samples.splice(0, frame.samples.length - 20000);
  frame.last = t;
  frame.raf = requestAnimationFrame(frameLoop);
}
function pct(v: number[], q: number): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? null;
}
const frameApi = {
  start(): void {
    frame.samples = [];
    frame.last = 0;
    frame.running = true;
    frame.startedAt = performance.now();
    frame.raf = requestAnimationFrame(frameLoop);
  },
  stop() {
    frame.running = false;
    cancelAnimationFrame(frame.raf);
    return frameApi.stats();
  },
  stats() {
    const n = frame.samples.length;
    return {
      count: n,
      p50Ms: pct(frame.samples, 0.5),
      p95Ms: pct(frame.samples, 0.95),
      meanFps: n ? 1000 / (frame.samples.reduce((a, b) => a + b, 0) / n) : null,
      route: useApp.getState().route,
    };
  },
  async sample(ms: number) {
    frameApi.start();
    await new Promise((r) => setTimeout(r, ms));
    return frameApi.stop();
  },
};

/* ------------------------------------------------------------ heap sampler / soak */
interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}
function heapMb(): number | null {
  const m = (performance as Performance & { memory?: PerfMemory }).memory;
  return m ? m.usedJSHeapSize / 1048576 : null;
}
const soak = {
  snapshots: [] as { tS: number; heapMb: number | null; route: RouteId }[],
  running: false,
  timer: 0 as ReturnType<typeof setInterval> | 0,
  startedAt: 0,
  durationMin: 0,
  snapshotS: 60,
  warmupMin: 5,
};
function soakVerdict() {
  const c = loadPrefabs().constants.soak;
  const vals = soak.snapshots.map((s) => s.heapMb).filter((v): v is number => v !== null);
  if (!vals.length)
    return {
      status: "NOT MEASURED" as const,
      reason: "performance.memory unavailable in this runtime (Chromium-only API)",
      snapshots: soak.snapshots.length,
    };
  const baseline = vals[0] ?? 0;
  const peak = Math.max(...vals);
  const warm = soak.snapshots
    .filter((s) => s.tS >= soak.warmupMin * 60 && s.heapMb !== null)
    .map((s) => s.heapMb as number);
  let run = 0;
  let maxRun = 0;
  for (let i = 1; i < warm.length; i++) {
    run = (warm[i] as number) > (warm[i - 1] as number) ? run + 1 : 0;
    maxRun = Math.max(maxRun, run);
  }
  const delta = peak - baseline;
  const elapsedMin = soak.snapshots.length ? (soak.snapshots[soak.snapshots.length - 1]?.tS ?? 0) / 60 : 0;
  return {
    status: (delta <= c.maxHeapDeltaMb && maxRun < 5 ? "PASS" : "FAIL") as "PASS" | "FAIL",
    baselineMb: Math.round(baseline * 10) / 10,
    peakMb: Math.round(peak * 10) / 10,
    deltaMb: Math.round(delta * 10) / 10,
    maxConsecutiveRiseAfterWarmup: maxRun,
    elapsedMin: Math.round(elapsedMin * 100) / 100,
    plannedMin: soak.durationMin,
    complete: !soak.running,
    note: elapsedMin < 30 ? "Shorter than the 30-min §12 soak — not a gate result." : null,
    snapshots: soak.snapshots.length,
  };
}
const soakApi = {
  start(minutes?: number, snapshotS?: number) {
    const c = loadPrefabs().constants.soak;
    soak.durationMin = minutes ?? c.durationMin;
    soak.snapshotS = snapshotS ?? (soak.durationMin < 5 ? 5 : c.snapshotS);
    soak.warmupMin = soak.durationMin >= 10 ? 5 : 0;
    soak.snapshots = [];
    soak.startedAt = performance.now();
    soak.running = true;
    const snap = () => {
      const tS = (performance.now() - soak.startedAt) / 1000;
      soak.snapshots.push({ tS: Math.round(tS), heapMb: heapMb(), route: useApp.getState().route });
      if (tS >= soak.durationMin * 60) soakApi.stop();
    };
    snap();
    if (soak.timer) clearInterval(soak.timer);
    soak.timer = setInterval(snap, soak.snapshotS * 1000);
    return { durationMin: soak.durationMin, snapshotS: soak.snapshotS };
  },
  stop() {
    soak.running = false;
    if (soak.timer) clearInterval(soak.timer);
    soak.timer = 0;
    return soakVerdict();
  },
  status: () => ({ running: soak.running, ...soakVerdict() }),
};

/* ------------------------------------------------------------ context-loss cycles */
interface CtxLossResult {
  cycles: number;
  unrecovered: number;
  recoveryMs: number[];
  p95RecoveryMs: number | null;
  maxRecoveryMs: number | null;
  scene: string;
  status: "PASS" | "FAIL" | "NOT MEASURED";
  reason?: string;
}
let lastCtxLoss: CtxLossResult | null = null;
async function contextLossCycles(n = 10, timeoutMs = 5000): Promise<CtxLossResult> {
  const sc = currentScene();
  if (!sc?.renderer) {
    lastCtxLoss = {
      cycles: 0,
      unrecovered: 0,
      recoveryMs: [],
      p95RecoveryMs: null,
      maxRecoveryMs: null,
      scene: sc ? `${sc.kind}/${sc.impl}` : "none",
      status: "NOT MEASURED",
      reason: "No live WebGL renderer on this route",
    };
    return lastCtxLoss;
  }
  const r = sc.renderer as {
    on(ev: "contextRestored", fn: () => void): () => void;
    forceContextLoss(): void;
    forceContextRestore(): void;
  };
  const times: number[] = [];
  let unrecovered = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const ok = await new Promise<boolean>((resolve) => {
      let done = false;
      const off = r.on("contextRestored", () => {
        if (done) return;
        done = true;
        off();
        resolve(true);
      });
      setTimeout(() => {
        if (done) return;
        done = true;
        off();
        resolve(false);
      }, timeoutMs);
      r.forceContextLoss();
      setTimeout(() => r.forceContextRestore(), 50);
    });
    if (ok) times.push(performance.now() - t0);
    else unrecovered++;
    await new Promise((res) => setTimeout(res, 250));
  }
  lastCtxLoss = {
    cycles: n,
    unrecovered,
    recoveryMs: times.map((t) => Math.round(t)),
    p95RecoveryMs: pct(times, 0.95),
    maxRecoveryMs: times.length ? Math.max(...times) : null,
    scene: `${sc.kind}/${sc.impl}`,
    status: unrecovered === 0 && times.every((t) => t <= 5000) ? "PASS" : "FAIL",
  };
  return lastCtxLoss;
}

/* ------------------------------------------------------------ snapshot + telemetry */
function snapshot() {
  const s = useApp.getState();
  const w = getWatch()?.getSnapshot();
  const sc = currentScene();
  return {
    route: s.route,
    overlay: s.overlay,
    wipe: s.wipe,
    scene: sc ? { kind: sc.kind, impl: sc.impl } : null,
    lifecycle: { ...lifecycle, live: lifecycle.created - lifecycle.destroyed },
    hubMode: s.hubMode,
    hubFallbackReason: s.hubFallbackReason,
    globeMode: s.globeMode,
    globeFallbackReason: s.globeFallbackReason,
    globeStatus: s.globeStatus,
    watch: w
      ? { state: w.state, index: w.index, stepId: w.step.stepId, date: w.step.date, isAvailable: w.step.isAvailable }
      : null,
    mission: {
      pair: s.mission.pair,
      vertices: s.mission.vertices,
      closed: s.mission.closed,
      selectedIndex: s.mission.selectedIndex,
      validation: s.mission.validation,
      outcome: s.mission.outcome,
      noAcquisition: s.mission.noAcquisition,
      layers: s.mission.layers,
    },
    pairStatus: s.route === "mission" ? pairStatus() : null,
    validateStatus: s.route === "mission" ? validateStatus() : null,
    nisar: s.nisar,
    tle: {
      source: s.tleSource,
      epochIso: s.tleEpochIso,
      ageHours: s.tleAgeHours,
      stale: s.tleStale,
      refreshLog: tleRefreshLog,
    },
    journalCount: s.journal.length,
    settings: s.settings,
  };
}

function telemetry() {
  const blanks = routeTimings.map((t) => t.blankMs);
  const p = p95(blanks);
  return {
    schema: "blindrev.telemetry.v1",
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    flags: { stub: env.stub, hub2d: env.hub2d, offline: env.offline },
    frame: frame.samples.length ? frameApi.stats() : { status: "NOT MEASURED", reason: "frame sampler not run" },
    routeSwitch: {
      count: routeTimings.length,
      blankP95Ms: p,
      gate: p === null ? "NOT MEASURED" : p <= 500 ? "PASS" : "FAIL",
      timings: routeTimings,
    },
    soak: soakVerdict(),
    contextLoss: lastCtxLoss ?? { status: "NOT MEASURED", reason: "contextLossCycles() not run" },
    lifecycle: { ...lifecycle },
    tleRefresh: tleRefreshLog,
    state: snapshot(),
  };
}

function exportTelemetry(download = true) {
  const t = telemetry();
  if (download) {
    const blob = new Blob([JSON.stringify(t, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `blindrev-telemetry-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return t;
}

const waitFor = async (pred: () => boolean, timeoutMs = 30000): Promise<boolean> => {
  const t0 = performance.now();
  while (!pred()) {
    if (performance.now() - t0 > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
};

export function installHarness(): void {
  const api = {
    version: 1,
    state: snapshot,
    get scene() {
      return currentScene();
    },
    get mission() {
      return getMission();
    },
    actions: {
      goTo: (r: RouteId) => navigate(r),
      waitIdle: (timeoutMs?: number) => waitFor(() => useApp.getState().wipe.phase === "idle", timeoutMs),
      openOverlay: (o: ReturnType<typeof useApp.getState>["overlay"]) => useApp.setState({ overlay: o }),
      closeOverlay: () => useApp.setState({ overlay: null }),
      play: () => watchActions.play(),
      pause: () => watchActions.pause(),
      step: (d: -1 | 1) => watchActions.step(d),
      scrubTo: (i: number) => watchActions.jumpTo(i),
      selectPair: (a: string, b: string) => setPair({ a, b }),
      setRoi: (vertices: LonLat[], closed = true) => roiActions.set(vertices, closed),
      addVertex: (p: LonLat) => roiActions.addVertex(p),
      closeRoi: () => roiActions.close(),
      clearRoi: () => roiActions.clear(),
      selectVertex: (i: number | null) => roiActions.select(i),
      nudge: (dir: "N" | "S" | "E" | "W", coarse = false) => roiActions.nudge(dir, coarse),
      validate: async () => {
        await validateMission();
        return useApp.getState().mission.outcome;
      },
      getOutcome: () => useApp.getState().mission.outcome,
      /** The authored answer-key polygon — for E2E only (never shown in the HUD). */
      referencePolygon: () => getMission().referencePolygons[0] ?? null,
    },
    perf: {
      frames: frameApi,
      soak: soakApi,
      heapMb,
      routeTimings: () => routeTimings.slice(),
      routeBlankP95: () => p95(routeTimings.map((t) => t.blankMs)),
      contextLossCycles,
    },
    telemetry,
    exportTelemetry,
  };
  (window as unknown as { __BLINDREV__: typeof api }).__BLINDREV__ = api;
  if (env.soakMinutes !== null) {
    soakApi.start(env.soakMinutes);
    frameApi.start();
  }
}
