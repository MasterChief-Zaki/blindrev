import type { TemporalStep } from "../contracts";

export type WatchState = "IDLE" | "PLAYING" | "PAUSED_UNAVAILABLE" | "SCRUBBING";

export type WatchEvent =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "TICK" }
  | { type: "STEP_FORWARD" }
  | { type: "STEP_BACK" }
  | { type: "SCRUB_START" }
  | { type: "SCRUB_TO"; index: number }
  | { type: "SCRUB_END" }
  | { type: "RESET" };

export type WatchEmission =
  | { type: "StateChanged"; from: WatchState; to: WatchState; atMs: number }
  | { type: "StepChanged"; index: number; stepId: string; atMs: number }
  | { type: "NoAcquisition"; index: number; stepId: string; date: string; atMs: number }
  | { type: "EndReached"; atMs: number };

export interface WatchSnapshot {
  state: WatchState;
  index: number;
  step: TemporalStep;
}

export interface WatchJournalEntry {
  atMs: number;
  event: WatchEvent;
  from: WatchState;
  to: WatchState;
  /** Step index after the event was applied. */
  index: number;
}

export interface TemporalWatch {
  getSnapshot(): WatchSnapshot;
  dispatch(e: WatchEvent): WatchEmission[];
  subscribe(fn: (s: WatchSnapshot, emissions: WatchEmission[]) => void): () => void;
  getJournal(): ReadonlyArray<WatchJournalEntry>;
}

export interface TemporalWatchOptions {
  /** Injected clock (ms). Default: a logical clock — the 0-based dispatch sequence number. */
  now?: () => number;
  /** Starting step; clamped into range. Default 0. */
  initialIndex?: number;
  /** Journal ring-buffer size; oldest entries are dropped beyond it. Default 10 000. */
  journalLimit?: number;
}
