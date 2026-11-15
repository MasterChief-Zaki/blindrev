import type { TemporalStep } from "../contracts";
import type {
  TemporalWatch,
  TemporalWatchOptions,
  WatchEmission,
  WatchEvent,
  WatchJournalEntry,
  WatchSnapshot,
  WatchState,
} from "./types";

/**
 * Temporal Watch FSM (spec §9). Pure: the UI owns the timer and dispatches `TICK`.
 *
 * Internal state = (`state`, `index`, `scrubbing` flag). `scrubbing` is true between
 * `SCRUB_START` and `SCRUB_END`; it is what lets PAUSED_UNAVAILABLE occur *during* a scrub.
 *
 * Definitions
 * - `rest(i)`  = IDLE if `steps[i].isAvailable`, else PAUSED_UNAVAILABLE.
 * - `seek(t)`  = clamp `t` (rounded; ±Infinity → ends; NaN → current index) into `[0, n-1]`, move
 *   there (StepChanged if the index changed), then state = scrubbing
 *   ? (available ? SCRUBBING : PAUSED_UNAVAILABLE) : rest(t). Landing on an unavailable step emits
 *   NoAcquisition when the index changed or the previous state was not PAUSED_UNAVAILABLE
 *   (scrub jitter on the same empty step does not spam the live region).
 * - `advance()` = scan `j = index+1 … n-1`: each unavailable `j` emits NoAcquisition(j) (explicit
 *   "No acquisition" telemetry — never a synthesised step, never an interpolated date); the
 *   first available `j` becomes the index (StepChanged) and the state stays PLAYING. If the scan
 *   reaches the end: EndReached, index unchanged, state = rest(index). The scan is a bounded
 *   `for` loop (≤ n-1 iterations), so an all-unavailable mission cannot loop.
 * - "rewind" (PLAY only): if no available step lies strictly after `index`, playback restarts
 *   from step 0 (seek(0) semantics for emissions) before entering PLAYING.
 *
 * Transition table ("–" = no-op: journaled with from === to, no emissions):
 *
 * | state \ event           | PLAY                  | PAUSE    | TICK      | STEP_FORWARD / STEP_BACK / SCRUB_TO(i) | SCRUB_START                    | SCRUB_END                    | RESET              |
 * |-------------------------|-----------------------|----------|-----------|----------------------------------------|--------------------------------|------------------------------|--------------------|
 * | IDLE                    | (rewind) → PLAYING    | –        | –         | seek(index±1 / i)                      | → SCRUBBING                    | –                            | seek(initialIndex) |
 * | PLAYING                 | –                     | rest(i)  | advance() | seek(…) — manual stepping pauses play   | → SCRUBBING (pauses playback)¹ | –                            | seek(initialIndex) |
 * | PAUSED_UNAVAILABLE      | (rewind) → PLAYING    | –        | –         | seek(…)                                | scrubbing on; stays PAUSED_U.  | –                            | seek(initialIndex) |
 * | PAUSED_UNAVAILABLE+scrub| – (finish scrub first)| –        | –         | seek(…): avail → SCRUBBING             | –                              | scrubbing off; stays PAUSED_U| seek(initialIndex) |
 * | SCRUBBING               | – (finish scrub first)| –        | –         | seek(…): unavail → PAUSED_U + NoAcq    | –                              | → rest(index) = IDLE         | seek(initialIndex) |
 *
 * ¹ SCRUB_START from PLAYING on an unavailable step (only possible right after PLAY from
 *   PAUSED_UNAVAILABLE) goes to PAUSED_UNAVAILABLE with scrubbing on. RESET always clears
 *   scrubbing. SCRUB_END never resumes playback.
 *
 * Emission order within one dispatch: step-level emissions in sweep order (NoAcquisition…,
 * StepChanged), then EndReached, then a single StateChanged if the state differs. All emissions
 * of one dispatch share one `atMs` read from the injected clock. Every dispatched event —
 * including no-ops — is journaled `{ atMs, event, from, to, index }`.
 *
 * Initial state = rest(initialIndex) (PAUSED_UNAVAILABLE when the first shown step has no
 * acquisition). Subscribers are notified only when a dispatch produced emissions. The snapshot
 * object is replaced only on change, so it is safe for `useSyncExternalStore`.
 */
export function createTemporalWatch(steps: TemporalStep[], opts: TemporalWatchOptions = {}): TemporalWatch {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new RangeError("createTemporalWatch: a mission needs at least one temporal step");
  }
  const list: ReadonlyArray<TemporalStep> = steps.slice();
  const n = list.length;
  const last = n - 1;
  let logical = 0;
  const clock = opts.now;
  const journalLimit =
    opts.journalLimit !== undefined && opts.journalLimit > 0 ? Math.floor(opts.journalLimit) : 10_000;

  const clampIndex = (raw: number, fallback: number): number => {
    if (Number.isNaN(raw)) return fallback;
    if (raw === Number.POSITIVE_INFINITY) return last;
    if (raw === Number.NEGATIVE_INFINITY) return 0;
    const r = Math.round(raw);
    return Math.max(0, Math.min(last, r));
  };
  const stepAt = (i: number): TemporalStep => list[i] as TemporalStep;
  const available = (i: number): boolean => stepAt(i).isAvailable === true;
  const rest = (i: number): WatchState => (available(i) ? "IDLE" : "PAUSED_UNAVAILABLE");
  const hasAvailableAfter = (i: number): boolean => {
    for (let j = i + 1; j < n; j++) if (available(j)) return true;
    return false;
  };

  const initialIndex = clampIndex(opts.initialIndex ?? 0, 0);
  let index = initialIndex;
  let state: WatchState = rest(index);
  let scrubbing = false;

  const makeSnapshot = (): WatchSnapshot => Object.freeze({ state, index, step: stepAt(index) });
  let snapshot = makeSnapshot();
  const journal: WatchJournalEntry[] = [];
  const listeners = new Set<(s: WatchSnapshot, emissions: WatchEmission[]) => void>();

  const noAcq = (i: number, atMs: number): WatchEmission => {
    const s = stepAt(i);
    return { type: "NoAcquisition", index: i, stepId: s.stepId, date: s.date, atMs };
  };

  /** Move to `target` and settle the state per `seek` semantics. Pushes emissions to `out`. */
  const seek = (target: number, atMs: number, out: WatchEmission[]): void => {
    const t = clampIndex(target, index);
    const moved = t !== index;
    const prevState = state;
    index = t;
    if (moved) out.push({ type: "StepChanged", index: t, stepId: stepAt(t).stepId, atMs });
    if (available(t)) {
      state = scrubbing ? "SCRUBBING" : "IDLE";
    } else {
      if (moved || prevState !== "PAUSED_UNAVAILABLE") out.push(noAcq(t, atMs));
      state = "PAUSED_UNAVAILABLE";
    }
  };

  const advance = (atMs: number, out: WatchEmission[]): void => {
    for (let j = index + 1; j < n; j++) {
      if (available(j)) {
        index = j;
        out.push({ type: "StepChanged", index: j, stepId: stepAt(j).stepId, atMs });
        return; // stays PLAYING
      }
      out.push(noAcq(j, atMs));
    }
    out.push({ type: "EndReached", atMs });
    state = rest(index);
  };

  const apply = (e: WatchEvent, atMs: number, out: WatchEmission[]): void => {
    switch (e.type) {
      case "PLAY": {
        if (scrubbing || state === "PLAYING") return;
        if (!hasAvailableAfter(index)) seek(0, atMs, out);
        state = "PLAYING";
        return;
      }
      case "PAUSE": {
        if (state === "PLAYING") state = rest(index);
        return;
      }
      case "TICK": {
        if (state === "PLAYING") advance(atMs, out);
        return;
      }
      case "STEP_FORWARD": {
        seek(index + 1, atMs, out);
        return;
      }
      case "STEP_BACK": {
        seek(index - 1, atMs, out);
        return;
      }
      case "SCRUB_TO": {
        const raw = typeof e.index === "number" ? e.index : Number.NaN;
        seek(raw, atMs, out);
        return;
      }
      case "SCRUB_START": {
        if (scrubbing) return;
        scrubbing = true;
        state = available(index) ? "SCRUBBING" : "PAUSED_UNAVAILABLE";
        return;
      }
      case "SCRUB_END": {
        if (!scrubbing) return;
        scrubbing = false;
        state = rest(index);
        return;
      }
      case "RESET": {
        scrubbing = false;
        seek(initialIndex, atMs, out);
        return;
      }
      default:
        return; // unknown runtime event: journaled no-op
    }
  };

  const dispatch = (e: WatchEvent): WatchEmission[] => {
    const atMs = clock ? clock() : logical;
    logical++;
    const from = state;
    const out: WatchEmission[] = [];
    apply(e, atMs, out);
    if (state !== from) out.push({ type: "StateChanged", from, to: state, atMs });

    const eventCopy = Object.freeze({ ...e }) as WatchEvent;
    journal.push(Object.freeze({ atMs, event: eventCopy, from, to: state, index }));
    if (journal.length > journalLimit) journal.splice(0, journal.length - journalLimit);

    if (out.length > 0) {
      snapshot = makeSnapshot();
      let firstError: unknown = null;
      for (const fn of Array.from(listeners)) {
        try {
          fn(snapshot, out.slice());
        } catch (err) {
          if (firstError === null) firstError = err;
        }
      }
      if (firstError !== null) throw firstError;
    }
    return out;
  };

  return {
    getSnapshot: () => snapshot,
    dispatch,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getJournal: () => journal.slice(),
  };
}
