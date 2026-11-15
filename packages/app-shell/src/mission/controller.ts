/* Mission game wiring: temporal watch FSM ↔ timeline ↔ globe; ROI ↔ validateRoi ↔ globe/2D editor;
 * scoring against the authored reference mask; ground track; focus arbitration. Framework-free. */
import { createTemporalWatch, daysBetween, nudgeVertex, scoreRoi, validateRoi } from "@blindrev/core-sim";
import { announce } from "@blindrev/ui-hud";
import { fetchMask, loadMission, loadPrefabs } from "../data/loaders";
import { nowDate } from "../env";
import { type LiveScene, onSceneChange } from "../scene/sceneManager";
import { type JournalEntry, type LayerKey, freshMissionUi, reducedMotion, useApp } from "../store";
import type {
  GlobeRenderer,
  LonLat,
  MaskGrid,
  MissionManifest,
  TemporalStep,
  TemporalWatch,
  WatchEmission,
  WatchState,
} from "../types";
import { detectAnomalies, loadDisplacement } from "./anomaly";
import { groundTrack, propagateNow } from "./nisar";
import { playCue } from "./sound";

export const STEP_INTERVAL_MS = 1200;

let watch: TemporalWatch | null = null;
let unsubWatch: (() => void) | null = null;
let playTimer: ReturnType<typeof setInterval> | null = null;
let trackTimer: ReturnType<typeof setInterval> | null = null;
let globe: GlobeRenderer | null = null;
let globeOffs: (() => void)[] = [];
let mission: MissionManifest | null = null;
let focusSuspended = false;

export function getMission(): MissionManifest {
  if (!mission) mission = loadMission();
  return mission;
}
export function getWatch(): TemporalWatch | null {
  return watch;
}
export function getGlobe(): GlobeRenderer | null {
  return globe;
}

const STATE_WORDS: Record<WatchState, string> = {
  IDLE: "Watch paused.",
  PLAYING: "Watch playing.",
  PAUSED_UNAVAILABLE: "Paused on a date with no acquisition.",
  SCRUBBING: "Scrubbing the timeline.",
};

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

function firstAvailableIndex(steps: TemporalStep[]): number {
  const i = steps.findIndex((s) => s.isAvailable);
  return Math.max(i, 0);
}

/** Reset the mission UI + create a fresh watch. Called whenever the mission scene mounts. */
export function resetMission(): void {
  const m = getMission();
  stopPlayTimer();
  unsubWatch?.();
  watch = createTemporalWatch(m.steps, { initialIndex: firstAvailableIndex(m.steps) });
  const ui = freshMissionUi();
  const snap = watch.getSnapshot();
  ui.index = snap.index;
  ui.watchState = snap.state;
  ui.contextLayerId = m.contextLayers.find((l) => l.kind === "optical")?.layerId ?? m.contextLayers[0]?.layerId ?? null;
  useApp.setState({ mission: ui });
  unsubWatch = watch.subscribe((s, emissions) => onWatch(s.state, s.index, s.step, emissions));
}

function onWatch(state: WatchState, index: number, step: TemporalStep, emissions: WatchEmission[]): void {
  const prev = useApp.getState().mission;
  let noAcq: { stepId: string; date: string; skipped?: boolean } | null = step.isAvailable
    ? null
    : { stepId: step.stepId, date: step.date };
  let skipped: { stepId: string; date: string } | null = null;
  for (const e of emissions) {
    if (e.type === "NoAcquisition") {
      if (e.index !== index) skipped = { stepId: e.stepId, date: e.date };
      announce(`No acquisition on ${fmtDate(e.date)}. The satellite recorded nothing here on that pass.`, "assertive");
      playCue("alert");
    } else if (e.type === "StateChanged") {
      announce(STATE_WORDS[e.to]);
    } else if (e.type === "StepChanged" && step.isAvailable) {
      announce(`${fmtDate(step.date)} — ${step.platform}, ${step.instrument}.`);
    } else if (e.type === "EndReached") {
      announce("End of the record. Pick two dates to compare.");
    }
  }
  if (!noAcq && skipped) noAcq = { ...skipped, skipped: true };
  const watched = prev.watched || state === "PLAYING" || index !== prev.index;
  const viewed = step.isAvailable && !prev.viewed.includes(step.stepId) ? [...prev.viewed, step.stepId] : prev.viewed;
  if (viewed !== prev.viewed && viewed.length === getMission().steps.filter((x) => x.isAvailable).length)
    announce("Every pass reviewed. Anomaly Detector unlocked.", "polite");
  let contextLayerId = prev.contextLayerId;
  if (prev.contextFollow && step.isAvailable)
    contextLayerId = contextFor(step.stepId, prev.contextKind) ?? contextLayerId;
  useApp.setState({
    mission: { ...prev, watchState: state, index, noAcquisition: noAcq, watched, viewed, contextLayerId },
  });
  if (index !== prev.index || !globeStepSynced) syncGlobeStep();
  if (state === "PLAYING") startPlayTimer();
  else stopPlayTimer();
}

let globeStepSynced = false;
function syncGlobeStep(): void {
  if (!globe || !watch) return;
  const step = watch.getSnapshot().step;
  globe.setStep(step);
  globeStepSynced = true;
}

function startPlayTimer(): void {
  if (playTimer) return;
  playTimer = setInterval(() => watch?.dispatch({ type: "TICK" }), STEP_INTERVAL_MS);
}
function stopPlayTimer(): void {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
}

/* ------------------------------------------------------------------ watch actions */
export const watchActions = {
  play(): void {
    if (!watch) return;
    if (reducedMotion()) {
      // Reduced motion: no auto-play sweep — advance one step instead and say so.
      watch.dispatch({ type: "STEP_FORWARD" });
      announce("Reduced motion is on, so auto-play is off. Moved forward one pass.");
      return;
    }
    const s = watch.getSnapshot();
    if (s.index >= getMission().steps.length - 1) watch.dispatch({ type: "RESET" });
    watch.dispatch({ type: "PLAY" });
  },
  pause(): void {
    watch?.dispatch({ type: "PAUSE" });
  },
  step(dir: -1 | 1): void {
    watch?.dispatch({ type: dir < 0 ? "STEP_BACK" : "STEP_FORWARD" });
  },
  scrubStart(): void {
    watch?.dispatch({ type: "SCRUB_START" });
  },
  scrubTo(i: number): void {
    if (!watch) return;
    if (watch.getSnapshot().state !== "SCRUBBING") watch.dispatch({ type: "SCRUB_START" });
    watch.dispatch({ type: "SCRUB_TO", index: i });
  },
  scrubEnd(): void {
    watch?.dispatch({ type: "SCRUB_END" });
  },
  jumpTo(i: number): void {
    if (!watch) return;
    watch.dispatch({ type: "SCRUB_START" });
    watch.dispatch({ type: "SCRUB_TO", index: i });
    watch.dispatch({ type: "SCRUB_END" });
  },
};

/* ------------------------------------------------------------------ pair */
export function stepById(id: string | null): TemporalStep | null {
  if (!id) return null;
  return getMission().steps.find((s) => s.stepId === id) ?? null;
}

export function setPair(pair: { a: string | null; b: string | null }): void {
  const m = useApp.getState().mission;
  useApp.setState({ mission: { ...m, pair, outcome: null } });
  const a = stepById(pair.a);
  const b = stepById(pair.b);
  if (a && b) {
    const dt = Math.abs(daysBetween(a.date, b.date));
    const min = loadPrefabs().constants.scoring.dtMinDays;
    announce(
      dt >= min
        ? `Date pair set: ${fmtDate(a.date)} and ${fmtDate(b.date)}, ${Math.round(dt)} days apart.`
        : `Those dates are ${Math.round(dt)} days apart. Pick dates at least ${min} days apart.`,
    );
  }
}

export function pairStatus(): { ok: boolean; reason: string | null; dtDays: number | null } {
  const { pair } = useApp.getState().mission;
  const a = stepById(pair.a);
  const b = stepById(pair.b);
  const min = loadPrefabs().constants.scoring.dtMinDays;
  if (!a || !b) return { ok: false, reason: "Choose dates A and B on the timeline.", dtDays: null };
  const dt = Math.abs(daysBetween(a.date, b.date));
  if (!a.isAvailable || !b.isAvailable)
    return { ok: false, reason: "Pick two dates that both have a pass.", dtDays: dt };
  if (dt < min)
    return { ok: false, reason: `Dates must be at least ${min} days apart (now ${Math.round(dt)}).`, dtDays: dt };
  return { ok: true, reason: null, dtDays: dt };
}

/* ------------------------------------------------------------------ ROI */
function setRoiState(vertices: LonLat[], closed: boolean, selectedIndex: number | null): void {
  const cfg = loadPrefabs().constants.scoring;
  const validation = vertices.length ? validateRoi(vertices, cfg) : null;
  const m = useApp.getState().mission;
  useApp.setState({ mission: { ...m, vertices, closed, selectedIndex, validation, outcome: null } });
}

export const roiActions = {
  toggleDraw(on?: boolean): void {
    const m = useApp.getState().mission;
    const next = on ?? !m.drawMode;
    if (next && m.closed) {
      announce("Your region is closed. Clear it to draw a new one, or adjust it in the 2D editor.");
      return;
    }
    useApp.setState({ mission: { ...m, drawMode: next } });
    announce(next ? "Marking on. Click the globe to place corners; click the first corner to close." : "Marking off.");
  },
  addVertex(p: LonLat): void {
    const m = useApp.getState().mission;
    if (m.closed) return;
    const v = [...m.vertices, { lon: p.lon, lat: p.lat }];
    setRoiState(v, false, v.length - 1);
    announce(`Corner ${v.length} at ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}.`);
    playCue("select");
  },
  close(): void {
    const m = useApp.getState().mission;
    if (m.vertices.length < 3) {
      announce("A region needs at least three corners.");
      return;
    }
    setRoiState(m.vertices, true, m.selectedIndex);
    const st = useApp.getState().mission;
    useApp.setState({ mission: { ...st, drawMode: false } });
    const val = st.validation;
    announce(
      val?.ok
        ? `Region closed: ${m.vertices.length} corners, ${val.areaKm2.toFixed(1)} square kilometres.`
        : `Region closed, but it needs fixing: ${val?.errors.map((e) => e.message).join(" ") ?? ""}`,
    );
  },
  undo(): void {
    const m = useApp.getState().mission;
    if (!m.vertices.length) return;
    const v = m.vertices.slice(0, -1);
    setRoiState(v, false, v.length ? v.length - 1 : null);
  },
  clear(): void {
    setRoiState([], false, null);
    announce("Region cleared.");
  },
  set(vertices: LonLat[], closed: boolean): void {
    const m = useApp.getState().mission;
    const sel = m.selectedIndex !== null && m.selectedIndex < vertices.length ? m.selectedIndex : null;
    setRoiState(vertices, closed, sel);
  },
  select(i: number | null): void {
    const m = useApp.getState().mission;
    useApp.setState({ mission: { ...m, selectedIndex: i } });
  },
  nudge(dir: "N" | "S" | "E" | "W", coarse: boolean): void {
    const m = useApp.getState().mission;
    if (m.selectedIndex === null) return;
    const c = loadPrefabs().constants;
    const v = nudgeVertex(m.vertices, m.selectedIndex, dir, coarse, c.roiNudgeDeg);
    setRoiState(v, m.closed, m.selectedIndex);
    const p = v[m.selectedIndex];
    if (p) announce(`Corner ${m.selectedIndex + 1} moved to ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}.`);
  },
  selectNext(dir: 1 | -1): void {
    const m = useApp.getState().mission;
    if (!m.vertices.length) return;
    const n = m.vertices.length;
    const i = m.selectedIndex === null ? 0 : (m.selectedIndex + dir + n) % n;
    useApp.setState({ mission: { ...m, selectedIndex: i } });
    const p = m.vertices[i];
    if (p) announce(`Corner ${i + 1} of ${n} selected: ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}.`);
  },
};

export function validateStatus(): { ok: boolean; reason: string | null } {
  const m = useApp.getState().mission;
  if (!m.vertices.length) return { ok: false, reason: "Mark a region on the globe first." };
  if (!m.closed) return { ok: false, reason: "Close your region: click its first corner." };
  if (!m.validation?.ok) return { ok: false, reason: m.validation?.errors[0]?.message ?? "Region is not valid yet." };
  const p = pairStatus();
  if (!p.ok) return { ok: false, reason: p.reason };
  return { ok: true, reason: null };
}

/** Score the ROI against the authored reference mask with the QA masks of the chosen pair. */
export async function validateMission(): Promise<void> {
  const st = useApp.getState();
  const m = st.mission;
  const ms = getMission();
  const val = m.validation;
  let a = stepById(m.pair.a);
  let b = stepById(m.pair.b);
  if (!val || !a || !b) return;
  if (a.date > b.date) [a, b] = [b, a];
  useApp.setState({ mission: { ...m, scoring: true } });
  try {
    const refAsset = ms.masks[ms.referenceMaskId];
    if (!refAsset) throw new Error(`reference mask ${ms.referenceMaskId} missing from manifest`);
    const reference = await fetchMask(refAsset);
    const qa: MaskGrid[] = [];
    for (const s of [a, b]) {
      const asset = s.qaMaskId ? ms.masks[s.qaMaskId] : undefined;
      if (asset) qa.push(await fetchMask(asset));
    }
    const outcome = scoreRoi({
      rings: val.rings,
      reference,
      qa,
      stepA: a,
      stepB: b,
      config: loadPrefabs().constants.scoring,
    });
    const cur = useApp.getState().mission;
    useApp.setState({ mission: { ...cur, outcome, scoring: false, savedOutcomeDigest: null }, overlay: "results" });
    if (outcome.kind === "SCORE") {
      announce(
        `Verdict ${outcome.tier}. Overlap ${(outcome.iou * 100).toFixed(0)} percent, precision ${(outcome.precision * 100).toFixed(0)}, recall ${(outcome.recall * 100).toFixed(0)}.`,
        "assertive",
      );
      playCue(outcome.tier === "FAIL" ? "alert" : "confirm");
    } else {
      announce(`No score: ${outcome.message}`, "assertive");
      playCue("alert");
    }
  } catch (e) {
    console.error("[mission] scoring failed", e);
    const cur = useApp.getState().mission;
    useApp.setState({
      mission: {
        ...cur,
        scoring: false,
        outcome: {
          kind: "REJECTED",
          code: "GRID_MISMATCH",
          message: `Could not load mission masks: ${e instanceof Error ? e.message : String(e)}`,
        },
      },
      overlay: "results",
    });
  }
}

export function saveOutcomeToJournal(): JournalEntry | null {
  const st = useApp.getState();
  const m = st.mission;
  const ms = getMission();
  const a = stepById(m.pair.a);
  const b = stepById(m.pair.b);
  if (!m.outcome || !a || !b) return null;
  const [first, second] = a.date <= b.date ? [a, b] : [b, a];
  const digest = m.outcome.kind === "SCORE" ? m.outcome.digest : null;
  const entry: JournalEntry = {
    id: `${ms.missionId}-${Date.now().toString(36)}`,
    missionId: ms.missionId,
    caseId: ms.caseId,
    title: ms.title,
    pair: { a: first.stepId, b: second.stepId, aDate: first.date, bDate: second.date },
    vertices: m.vertices,
    areaKm2: m.validation?.areaKm2 ?? 0,
    outcome: m.outcome,
    digest,
    savedAt: nowDate().toISOString(),
    labels: [...ms.labels],
  };
  st.addJournal(entry);
  useApp.setState({ mission: { ...useApp.getState().mission, savedOutcomeDigest: digest ?? entry.id } });
  announce("Saved to your Case Journal.");
  playCue("confirm");
  return entry;
}

/* ------------------------------------------------------------------ investigator tools (§10) */
export function anomalyUnlocked(): boolean {
  const m = useApp.getState().mission;
  return getMission()
    .steps.filter((s) => s.isAvailable)
    .every((s) => m.viewed.includes(s.stepId));
}

/** Context layer of a given kind for a step (falls back to the nearest earlier step with one). */
export function contextFor(stepId: string, kind: "optical" | "radar"): string | null {
  const ms = getMission();
  if (kind === "optical") {
    // Sharp optical image of this date if one exists (maxZoom ≥ 10, e.g. HLS S30); otherwise the default
    // optical view = the first optical context layer (D lists the sharp, date-independent layer first).
    const sharp = ms.contextLayers.find((c) => c.kind === "optical" && c.stepId === stepId && c.tiling.maxZoom >= 10);
    return sharp?.layerId ?? ms.contextLayers.find((c) => c.kind === "optical")?.layerId ?? null;
  }
  const idx = ms.steps.findIndex((s) => s.stepId === stepId);
  for (let i = idx; i >= 0; i--) {
    const sid = ms.steps[i]?.stepId;
    const l = ms.contextLayers.find((c) => c.stepId === sid && c.kind === "radar");
    if (l) return l.layerId;
  }
  return ms.contextLayers.find((c) => c.kind === "radar")?.layerId ?? null;
}

/** Radar Vision (§10): switch the real context imagery between optical (MODIS) and NISAR L-band radar (GCOV)
 *  for the current date. The SIMULATED displacement evidence stays a separate overlay toggle. */
export function setRadarVision(on: boolean): void {
  const m = useApp.getState().mission;
  const step = getMission().steps[m.index];
  const kind = on ? "radar" : "optical";
  const id = step ? contextFor(step.stepId, kind) : null;
  useApp.getState().setMission({ contextKind: kind, contextFollow: true, ...(id ? { contextLayerId: id } : {}) });
  useApp.getState().setLayer("context", { visible: true });
  announce(
    on
      ? "Radar Vision on: real NISAR L-band radar for this date, via NASA GIBS. It shows how much of the radar signal the ground sends back."
      : "Radar Vision off: optical satellite imagery for this date.",
  );
}

type AnnotatableGlobe = GlobeRenderer & {
  setAnnotations?: (items: { id: string; label: string; ring: LonLat[]; kind: "anomaly" | "note" }[]) => void;
};

function pushAnnotations(): void {
  const g = globe as AnnotatableGlobe | null;
  if (!g || typeof g.setAnnotations !== "function") return;
  const m = useApp.getState().mission;
  g.setAnnotations(
    (m.anomalies ?? []).map((a) => ({ id: a.id, label: a.label, ring: a.ring, kind: "anomaly" as const })),
  );
}

export async function runAnomalyDetector(): Promise<void> {
  const ms = getMission();
  const m = useApp.getState().mission;
  const step = ms.steps[m.index];
  if (!step || !step.isAvailable) {
    useApp.getState().setMission({
      anomalies: [],
      anomalyStepId: step?.stepId ?? null,
      anomalyNote: "No acquisition on this date, so there is nothing to scan.",
    });
    return;
  }
  const qa = step.qaMaskId ? ms.masks[step.qaMaskId] : undefined;
  const grid = await loadDisplacement(step, qa ? { width: qa.width, height: qa.height } : undefined);
  if (!grid) {
    useApp.getState().setMission({
      anomalies: [],
      anomalyStepId: step.stepId,
      anomalyNote: "This date has no ground-motion data in the case file.",
    });
    pushAnnotations();
    return;
  }
  const t = ms.legend.thresholds;
  const threshold = Math.min(Math.abs(t[0]), Math.abs(t[1])) || 1;
  const list = detectAnomalies(grid, threshold, ms.legend.unit);
  useApp.getState().setMission({
    anomalies: list,
    anomalyStepId: step.stepId,
    anomalyNote: `Scanned ${fmtDate(step.date)} for motion of ${threshold} ${ms.legend.unit} or more, up or down. ${list.length} candidate${list.length === 1 ? "" : "s"}. Some may be decoys, so you decide what they mean.`,
  });
  pushAnnotations();
  announce(`Anomaly Detector flagged ${list.length} areas on ${fmtDate(step.date)}. Some may be decoys.`);
  playCue("tick");
}

export function clearAnomalies(): void {
  useApp.getState().setMission({ anomalies: null, anomalyStepId: null, anomalyNote: null });
  pushAnnotations();
}

/* ------------------------------------------------------------------ globe attach / detach */
const LAYERS: LayerKey[] = ["evidence", "qa", "context", "groundTrack", "referenceMask"];

function pushAllToGlobe(g: GlobeRenderer): void {
  const st = useApp.getState();
  const m = st.mission;
  for (const k of LAYERS) {
    g.setLayerVisible(k, m.layers[k].visible);
    g.setLayerOpacity(k, m.layers[k].opacity);
  }
  g.setLayerVisible("aoiOutline", true);
  g.setContextLayer(m.contextLayerId);
  g.setRoi(m.vertices, { closed: m.closed, valid: !!m.validation?.ok, selectedIndex: m.selectedIndex });
  g.setRoiDrawMode(m.drawMode);
  g.setInputSuspended(st.overlay !== null || focusSuspended);
  syncGlobeStep();
  pushTrack(true);
  pushAnnotations();
}

function pushTrack(full: boolean): void {
  if (!globe) return;
  try {
    const cur = propagateNow();
    globe.setGroundTrack(full ? groundTrack() : groundTrack(), cur);
  } catch (e) {
    console.warn("[mission] ground track unavailable", e);
  }
}

let pointerRaf = 0;
let pendingPointer: LonLat | null = null;

function attach(g: GlobeRenderer): void {
  globe = g;
  globeStepSynced = false;
  resetMission();
  globeOffs.push(
    g.on("roiVertexAdded", (p) => roiActions.addVertex(p)),
    g.on("roiCloseRequested", () => roiActions.close()),
    g.on("status", (s) => useApp.setState({ globeStatus: s })),
    g.on("pointer", (p) => {
      pendingPointer = p;
      if (!pointerRaf)
        pointerRaf = requestAnimationFrame(() => {
          pointerRaf = 0;
          const m = useApp.getState().mission;
          useApp.setState({ mission: { ...m, pointer: pendingPointer } });
        });
    }),
    g.on("contextRestored", () => {
      if (globe) pushAllToGlobe(globe);
    }),
  );
  useApp.setState({ globeStatus: g.getStatus() });
  pushAllToGlobe(g);
  trackTimer = setInterval(() => pushTrack(false), 1000);
}

function detach(): void {
  stopPlayTimer();
  if (trackTimer) clearInterval(trackTimer);
  trackTimer = null;
  for (const off of globeOffs) off();
  globeOffs = [];
  unsubWatch?.();
  unsubWatch = null;
  watch = null;
  globe = null;
  cancelAnimationFrame(pointerRaf);
  pointerRaf = 0;
}

/** Install once at boot: follows the live scene and mirrors store changes into the globe. */
export function installMissionController(): void {
  onSceneChange((s: LiveScene | null) => {
    if (s?.kind === "mission") {
      if (globe !== s.renderer) {
        if (globe) detach();
        attach(s.renderer);
      }
    } else if (globe) detach();
  });

  useApp.subscribe((s, prev) => {
    const g = globe;
    if (!g) return;
    const m = s.mission;
    const pm = prev.mission;
    if (
      m.vertices !== pm.vertices ||
      m.closed !== pm.closed ||
      m.selectedIndex !== pm.selectedIndex ||
      m.validation !== pm.validation
    )
      g.setRoi(m.vertices, { closed: m.closed, valid: !!m.validation?.ok, selectedIndex: m.selectedIndex });
    if (m.drawMode !== pm.drawMode) g.setRoiDrawMode(m.drawMode);
    if (m.layers !== pm.layers)
      for (const k of LAYERS) {
        if (m.layers[k].visible !== pm.layers[k].visible) g.setLayerVisible(k, m.layers[k].visible);
        if (m.layers[k].opacity !== pm.layers[k].opacity) g.setLayerOpacity(k, m.layers[k].opacity);
      }
    if (m.contextLayerId !== pm.contextLayerId) g.setContextLayer(m.contextLayerId);
    if (s.overlay !== prev.overlay) g.setInputSuspended(s.overlay !== null || focusSuspended);
  });

  // Focus arbitration: text inputs / sliders / dialogs in the HUD hold the keyboard.
  const update = (): void => {
    const el = document.activeElement as HTMLElement | null;
    const inHud =
      !!el &&
      (el.matches("input, select, textarea, [role='slider'], [contenteditable='true']") ||
        !!el.closest("[role='dialog']"));
    if (inHud !== focusSuspended) {
      focusSuspended = inHud;
      globe?.setInputSuspended(useApp.getState().overlay !== null || focusSuspended);
    }
  };
  document.addEventListener("focusin", update);
  document.addEventListener("focusout", () => setTimeout(update, 0));
}

/** Arrow-key nudge of the selected vertex while the map (scene host) has focus. */
export function handleMapKey(e: { key: string; shiftKey: boolean }): boolean {
  const dirs: Record<string, "N" | "S" | "E" | "W"> = { ArrowUp: "N", ArrowDown: "S", ArrowLeft: "W", ArrowRight: "E" };
  const m = useApp.getState().mission;
  const d = dirs[e.key];
  if (d && m.selectedIndex !== null) {
    roiActions.nudge(d, e.shiftKey);
    return true;
  }
  if (e.key === "[" || e.key === "]") {
    roiActions.selectNext(e.key === "]" ? 1 : -1);
    return true;
  }
  if (e.key === "Escape" && m.drawMode) {
    roiActions.toggleDraw(false);
    return true;
  }
  if (e.key === "Enter" && m.drawMode && m.vertices.length >= 3) {
    roiActions.close();
    return true;
  }
  if (e.key === "Backspace" && m.drawMode && !m.closed) {
    roiActions.undo();
    return true;
  }
  return false;
}

export function missionNow(): Date {
  return nowDate();
}
