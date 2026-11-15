import type { DataLabel, GlobeStatusLike, LonLat, OrbitState, RoiValidation, ScoreOutcome, WatchState } from "./types";
import { create } from "zustand";
import type { Anomaly } from "./mission/anomaly";
import type { RouteId } from "./env";
import { env } from "./env";

export type Overlay = null | "briefing" | "journal" | "settings" | "results" | "roi-editor" | "credits";
export type QualityId = "low" | "medium" | "high";
export type MotionPref = "system" | "on" | "off";

export interface Settings {
  quality: QualityId;
  motion: MotionPref;
  sound: boolean;
  volume: number;
  customCamera: boolean;
  /** Mission side panels open/closed (remembered). Undefined = decide from the viewport (≥ 1600 px wide → open). */
  panels?: { left: boolean; right: boolean };
}

export interface JournalEntry {
  id: string;
  missionId: string;
  caseId: string;
  title: string;
  pair: { a: string; b: string; aDate: string; bDate: string };
  vertices: LonLat[];
  areaKm2: number;
  outcome: ScoreOutcome;
  digest: string | null;
  savedAt: string;
  labels: DataLabel[];
}

export type LayerKey = "evidence" | "qa" | "context" | "groundTrack" | "referenceMask";
export interface LayerState {
  visible: boolean;
  opacity: number;
}

export interface MissionUi {
  watchState: WatchState;
  index: number;
  pair: { a: string | null; b: string | null };
  vertices: LonLat[];
  closed: boolean;
  selectedIndex: number | null;
  drawMode: boolean;
  validation: RoiValidation | null;
  outcome: ScoreOutcome | null;
  scoring: boolean;
  layers: Record<LayerKey, LayerState>;
  contextLayerId: string | null;
  /** context imagery follows the current date until the player picks a layer */
  contextFollow: boolean;
  /** Radar Vision: which real context imagery follows the date — optical (MODIS) or radar (NISAR GCOV) */
  contextKind: "optical" | "radar";
  rightTab: "layers" | "provenance" | "diagnostics" | "anomalies";
  pointer: LonLat | null;
  noAcquisition: { stepId: string; date: string; skipped?: boolean } | null;
  savedOutcomeDigest: string | null;
  watched: boolean;
  /** available stepIds the player has seen (Anomaly Detector unlocks when all are seen) */
  viewed: string[];
  anomalies: Anomaly[] | null;
  anomalyStepId: string | null;
  anomalyNote: string | null;
}

export interface WipeState {
  phase: "idle" | "covering" | "covered" | "revealing";
  progress: number | null;
  label: string;
  slow: boolean;
  mode: "loading" | "tunnel";
}

export interface AppState {
  route: RouteId;
  overlay: Overlay;
  overlayReturn: Overlay;
  wipe: WipeState;
  settings: Settings;
  systemReducedMotion: boolean;
  journal: JournalEntry[];
  hubFocus: string | null;
  hubMode: "3d" | "2d" | "stub";
  hubFallbackReason: string | null;
  globeMode: "cesium" | "stub";
  globeFallbackReason: string | null;
  globeStatus: GlobeStatusLike | null;
  nisar: OrbitState | null;
  tleSource: "snapshot" | "celestrak" | "cache";
  tleEpochIso: string;
  tleAgeHours: number;
  tleStale: boolean;
  bootError: string | null;
  mission: MissionUi;
  set: (p: Partial<AppState>) => void;
  setMission: (p: Partial<MissionUi>) => void;
  setSettings: (p: Partial<Settings>) => void;
  setLayer: (k: LayerKey, p: Partial<LayerState>) => void;
  addJournal: (e: JournalEntry) => void;
  removeJournal: (id: string) => void;
}

const SETTINGS_KEY = "blindrev.settings.v1";
const JOURNAL_KEY = "blindrev.journal.v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked: keep in memory */
  }
}

const DEFAULT_SETTINGS: Settings = {
  quality: "medium",
  motion: "system",
  sound: true,
  volume: 0.6,
  customCamera: true,
};

export function freshMissionUi(): MissionUi {
  return {
    watchState: "IDLE",
    index: 0,
    pair: { a: null, b: null },
    vertices: [],
    closed: false,
    selectedIndex: null,
    drawMode: false,
    validation: null,
    outcome: null,
    scoring: false,
    layers: {
      evidence: { visible: true, opacity: 0.85 },
      qa: { visible: false, opacity: 0.6 },
      context: { visible: true, opacity: 1 },
      groundTrack: { visible: true, opacity: 1 },
      referenceMask: { visible: false, opacity: 0.7 },
    },
    contextLayerId: null,
    contextFollow: true,
    contextKind: "optical",
    rightTab: "layers",
    pointer: null,
    noAcquisition: null,
    savedOutcomeDigest: null,
    watched: false,
    viewed: [],
    anomalies: null,
    anomalyStepId: null,
    anomalyNote: null,
  };
}

const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

export const useApp = create<AppState>((set, get) => ({
  route: "menu",
  overlay: null,
  overlayReturn: null,
  wipe: { phase: "idle", progress: null, label: "", slow: false, mode: "loading" },
  settings: { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(SETTINGS_KEY, {}) },
  systemReducedMotion: mq?.matches ?? false,
  journal: readJson<JournalEntry[]>(JOURNAL_KEY, []),
  hubFocus: null,
  hubMode: env.stub ? "stub" : env.hub2d ? "2d" : "3d",
  hubFallbackReason: env.hub2d ? "Requested 2D board (?hub=2d)" : null,
  globeMode: env.stub ? "stub" : "cesium",
  globeFallbackReason: null,
  globeStatus: null,
  nisar: null,
  tleSource: "snapshot",
  tleEpochIso: "",
  tleAgeHours: 0,
  tleStale: false,
  bootError: null,
  mission: freshMissionUi(),
  set: (p) => set(p),
  setMission: (p) => set({ mission: { ...get().mission, ...p } }),
  setSettings: (p) => {
    const settings = { ...get().settings, ...p };
    writeJson(SETTINGS_KEY, settings);
    set({ settings });
  },
  setLayer: (k, p) => {
    const m = get().mission;
    set({ mission: { ...m, layers: { ...m.layers, [k]: { ...m.layers[k], ...p } } } });
  },
  addJournal: (e) => {
    const journal = [e, ...get().journal.filter((x) => x.id !== e.id)];
    writeJson(JOURNAL_KEY, journal);
    set({ journal });
  },
  removeJournal: (id) => {
    const journal = get().journal.filter((x) => x.id !== id);
    writeJson(JOURNAL_KEY, journal);
    set({ journal });
  },
}));

mq?.addEventListener?.("change", (e) => useApp.setState({ systemReducedMotion: e.matches }));

export function reducedMotion(s: Pick<AppState, "settings" | "systemReducedMotion"> = useApp.getState()): boolean {
  if (env.motion === "reduced") return true;
  if (env.motion === "full") return false;
  if (s.settings.motion === "on") return true;
  if (s.settings.motion === "off") return false;
  return s.systemReducedMotion;
}

export function useReducedMotion(): boolean {
  return useApp((s) => reducedMotion(s));
}
