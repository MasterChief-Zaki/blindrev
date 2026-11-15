import { describe, expect, it } from "vitest";
import type { TemporalStep } from "../contracts";
import { makeStep } from "../util/testFixtures";
import { createTemporalWatch } from "./index";
import type { WatchEmission, WatchEvent, WatchState } from "./index";

// Fixed clock: advances only when the test says so.
function fixedClock(start = 1_000) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v) };
}

// A0 U1 U2 A3 U4 A5  (A = available, U = unavailable)
const STEPS: TemporalStep[] = [
  makeStep("s0", "2026-01-01T00:00:00Z", true),
  makeStep("s1", "2026-01-13T00:00:00Z", false),
  makeStep("s2", "2026-01-25T00:00:00Z", false),
  makeStep("s3", "2026-02-06T00:00:00Z", true),
  makeStep("s4", "2026-02-18T00:00:00Z", false),
  makeStep("s5", "2026-03-02T00:00:00Z", true),
];

const AT = 1_000;
const sc = (from: WatchState, to: WatchState, atMs = AT): WatchEmission => ({ type: "StateChanged", from, to, atMs });
const step = (i: number, atMs = AT): WatchEmission => ({ type: "StepChanged", index: i, stepId: `s${i}`, atMs });
const noAcq = (i: number, steps = STEPS, atMs = AT): WatchEmission => ({
  type: "NoAcquisition",
  index: i,
  stepId: (steps[i] as TemporalStep).stepId,
  date: (steps[i] as TemporalStep).date,
  atMs,
});
const end = (atMs = AT): WatchEmission => ({ type: "EndReached", atMs });

function watchAt(index: number, steps = STEPS) {
  const clock = fixedClock(AT);
  const w = createTemporalWatch(steps, { now: clock.now, initialIndex: index });
  return { w, clock };
}

/** Drive a watch into a given state at a given index. */
function inState(state: WatchState | "PAUSED_UNAVAILABLE+scrub", index: number) {
  const { w, clock } = watchAt(index);
  switch (state) {
    case "IDLE":
    case "PAUSED_UNAVAILABLE":
      break;
    case "PLAYING":
      w.dispatch({ type: "PLAY" });
      break;
    case "SCRUBBING":
    case "PAUSED_UNAVAILABLE+scrub":
      w.dispatch({ type: "SCRUB_START" });
      break;
  }
  const expected = state === "PAUSED_UNAVAILABLE+scrub" ? "PAUSED_UNAVAILABLE" : state;
  expect(w.getSnapshot().state).toBe(expected);
  expect(w.getSnapshot().index).toBe(index);
  return { w, clock };
}

describe("createTemporalWatch — construction", () => {
  it("starts IDLE on an available step and PAUSED_UNAVAILABLE on an unavailable one", () => {
    expect(watchAt(0).w.getSnapshot()).toMatchObject({ state: "IDLE", index: 0 });
    expect(watchAt(1).w.getSnapshot()).toMatchObject({ state: "PAUSED_UNAVAILABLE", index: 1 });
  });

  it("clamps initialIndex (and treats NaN as 0)", () => {
    expect(watchAt(-5).w.getSnapshot().index).toBe(0);
    expect(watchAt(99).w.getSnapshot().index).toBe(5);
    expect(watchAt(Number.NaN).w.getSnapshot().index).toBe(0);
    expect(watchAt(2.6).w.getSnapshot().index).toBe(3);
  });

  it("rejects an empty mission", () => {
    expect(() => createTemporalWatch([])).toThrow(RangeError);
  });

  it("snapshot.step is always the caller's step object (never a synthesised step)", () => {
    const { w } = watchAt(0);
    for (const e of [{ type: "PLAY" }, { type: "TICK" }, { type: "TICK" }, { type: "STEP_BACK" }] as WatchEvent[]) {
      w.dispatch(e);
      const s = w.getSnapshot();
      expect(STEPS).toContain(s.step);
      expect(s.step).toBe(STEPS[s.index]);
    }
  });
});

describe("transitions from IDLE", () => {
  it("PLAY → PLAYING (no move when an available step lies ahead)", () => {
    const { w } = inState("IDLE", 0);
    expect(w.dispatch({ type: "PLAY" })).toEqual([sc("IDLE", "PLAYING")]);
    expect(w.getSnapshot()).toMatchObject({ state: "PLAYING", index: 0 });
  });

  it("PLAY at the last available step rewinds to step 0 then plays", () => {
    const { w } = inState("IDLE", 5);
    expect(w.dispatch({ type: "PLAY" })).toEqual([step(0), sc("IDLE", "PLAYING")]);
    expect(w.getSnapshot()).toMatchObject({ state: "PLAYING", index: 0 });
  });

  it("PAUSE, TICK, SCRUB_END are no-ops", () => {
    for (const e of [{ type: "PAUSE" }, { type: "TICK" }, { type: "SCRUB_END" }] as WatchEvent[]) {
      const { w } = inState("IDLE", 0);
      expect(w.dispatch(e)).toEqual([]);
      expect(w.getSnapshot()).toMatchObject({ state: "IDLE", index: 0 });
    }
  });

  it("STEP_FORWARD onto an unavailable step → PAUSED_UNAVAILABLE + NoAcquisition", () => {
    const { w } = inState("IDLE", 0);
    expect(w.dispatch({ type: "STEP_FORWARD" })).toEqual([step(1), noAcq(1), sc("IDLE", "PAUSED_UNAVAILABLE")]);
  });

  it("STEP_BACK / SCRUB_TO onto an available step stay IDLE", () => {
    const { w } = inState("IDLE", 3);
    expect(w.dispatch({ type: "SCRUB_TO", index: 5 })).toEqual([step(5)]);
    expect(w.getSnapshot().state).toBe("IDLE");
    expect(w.dispatch({ type: "SCRUB_TO", index: 0 })).toEqual([step(0)]);
    const { w: w2 } = inState("IDLE", 3);
    expect(w2.dispatch({ type: "STEP_BACK" })).toEqual([step(2), noAcq(2), sc("IDLE", "PAUSED_UNAVAILABLE")]);
  });

  it("STEP_BACK at index 0 and STEP_FORWARD at the last index do nothing", () => {
    expect(inState("IDLE", 0).w.dispatch({ type: "STEP_BACK" })).toEqual([]);
    expect(inState("IDLE", 5).w.dispatch({ type: "STEP_FORWARD" })).toEqual([]);
  });

  it("SCRUB_START → SCRUBBING", () => {
    const { w } = inState("IDLE", 0);
    expect(w.dispatch({ type: "SCRUB_START" })).toEqual([sc("IDLE", "SCRUBBING")]);
  });

  it("RESET returns to the initial index", () => {
    const { w } = watchAt(0);
    w.dispatch({ type: "SCRUB_TO", index: 3 });
    expect(w.dispatch({ type: "RESET" })).toEqual([step(0)]);
    expect(w.getSnapshot()).toMatchObject({ state: "IDLE", index: 0 });
  });
});

describe("transitions from PLAYING", () => {
  it("TICK advances to the next available step, one NoAcquisition per skipped step", () => {
    const { w } = inState("PLAYING", 0);
    expect(w.dispatch({ type: "TICK" })).toEqual([noAcq(1), noAcq(2), step(3)]);
    expect(w.getSnapshot()).toMatchObject({ state: "PLAYING", index: 3 });
    expect(w.dispatch({ type: "TICK" })).toEqual([noAcq(4), step(5)]);
    expect(w.getSnapshot()).toMatchObject({ state: "PLAYING", index: 5 });
  });

  it("TICK at the end → EndReached + IDLE (index unchanged)", () => {
    const { w } = inState("IDLE", 3);
    w.dispatch({ type: "PLAY" });
    w.dispatch({ type: "TICK" });
    expect(w.dispatch({ type: "TICK" })).toEqual([end(), sc("PLAYING", "IDLE")]);
    expect(w.getSnapshot()).toMatchObject({ state: "IDLE", index: 5 });
  });

  it("TICK with only unavailable steps ahead emits them, then EndReached", () => {
    const steps = [
      makeStep("s0", "2026-01-01", true),
      makeStep("s1", "2026-01-13", false),
      makeStep("s2", "2026-01-25", false),
    ];
    const w = createTemporalWatch(steps, { now: () => AT });
    w.dispatch({ type: "PLAY" });
    expect(w.dispatch({ type: "TICK" })).toEqual([noAcq(1, steps), noAcq(2, steps), end(), sc("PLAYING", "IDLE")]);
    expect(w.getSnapshot()).toMatchObject({ state: "IDLE", index: 0 });
  });

  it("NoAcquisition carries the step's own date (no interpolation)", () => {
    const { w } = inState("PLAYING", 0);
    const out = w.dispatch({ type: "TICK" });
    const dates = out.filter((e) => e.type === "NoAcquisition").map((e) => (e as { date: string }).date);
    expect(dates).toEqual([STEPS[1]?.date, STEPS[2]?.date]);
  });

  it("PAUSE → IDLE; PLAY while PLAYING is a no-op", () => {
    const { w } = inState("PLAYING", 0);
    expect(w.dispatch({ type: "PLAY" })).toEqual([]);
    expect(w.dispatch({ type: "PAUSE" })).toEqual([sc("PLAYING", "IDLE")]);
  });

  it("STEP_FORWARD pauses playback (onto unavailable → PAUSED_UNAVAILABLE)", () => {
    const { w } = inState("PLAYING", 0);
    expect(w.dispatch({ type: "STEP_FORWARD" })).toEqual([step(1), noAcq(1), sc("PLAYING", "PAUSED_UNAVAILABLE")]);
  });

  it("STEP_BACK pauses playback (onto available → IDLE)", () => {
    const { w } = inState("PLAYING", 0);
    w.dispatch({ type: "TICK" }); // → 3
    expect(w.dispatch({ type: "STEP_BACK" })).toEqual([step(2), noAcq(2), sc("PLAYING", "PAUSED_UNAVAILABLE")]);
    const { w: w2 } = inState("PLAYING", 3);
    w2.dispatch({ type: "TICK" }); // → 5
    w2.dispatch({ type: "SCRUB_TO", index: 3 });
    expect(w2.getSnapshot()).toMatchObject({ state: "IDLE", index: 3 });
  });

  it("SCRUB_TO (click-seek, no SCRUB_START) pauses playback", () => {
    const { w } = inState("PLAYING", 0);
    expect(w.dispatch({ type: "SCRUB_TO", index: 3 })).toEqual([step(3), sc("PLAYING", "IDLE")]);
  });

  it("SCRUB_START pauses playback → SCRUBBING; SCRUB_END does not resume", () => {
    const { w } = inState("PLAYING", 0);
    expect(w.dispatch({ type: "SCRUB_START" })).toEqual([sc("PLAYING", "SCRUBBING")]);
    expect(w.dispatch({ type: "TICK" })).toEqual([]);
    expect(w.dispatch({ type: "SCRUB_END" })).toEqual([sc("SCRUBBING", "IDLE")]);
  });

  it("RESET stops playback", () => {
    const { w } = inState("PLAYING", 0);
    w.dispatch({ type: "TICK" });
    expect(w.dispatch({ type: "RESET" })).toEqual([step(0), sc("PLAYING", "IDLE")]);
  });
});

describe("transitions from PAUSED_UNAVAILABLE", () => {
  it("PLAY → PLAYING; the next TICK skips onward with NoAcquisition", () => {
    const { w } = inState("PAUSED_UNAVAILABLE", 1);
    expect(w.dispatch({ type: "PLAY" })).toEqual([sc("PAUSED_UNAVAILABLE", "PLAYING")]);
    expect(w.dispatch({ type: "TICK" })).toEqual([noAcq(2), step(3)]);
  });

  it("PLAY with no available step ahead rewinds to 0", () => {
    const { w } = inState("PAUSED_UNAVAILABLE", 4);
    w.dispatch({ type: "SCRUB_TO", index: 4 }); // stays, no spam
    const steps = [...STEPS.slice(0, 5)]; // A0 U1 U2 A3 U4
    const w2 = createTemporalWatch(steps, { now: () => AT, initialIndex: 4 });
    expect(w2.dispatch({ type: "PLAY" })).toEqual([step(0), sc("PAUSED_UNAVAILABLE", "PLAYING")]);
    expect(w.getSnapshot().index).toBe(4);
  });

  it("PAUSE on PLAYING-over-an-unavailable-step → PAUSED_UNAVAILABLE", () => {
    const { w } = inState("PAUSED_UNAVAILABLE", 1);
    w.dispatch({ type: "PLAY" });
    expect(w.dispatch({ type: "PAUSE" })).toEqual([sc("PLAYING", "PAUSED_UNAVAILABLE")]);
  });

  it("STEP onto an available step → IDLE; onto another unavailable step → NoAcquisition", () => {
    const { w } = inState("PAUSED_UNAVAILABLE", 1);
    expect(w.dispatch({ type: "STEP_FORWARD" })).toEqual([step(2), noAcq(2)]);
    expect(w.getSnapshot().state).toBe("PAUSED_UNAVAILABLE");
    expect(w.dispatch({ type: "STEP_FORWARD" })).toEqual([step(3), sc("PAUSED_UNAVAILABLE", "IDLE")]);
  });

  it("SCRUB_TO the same unavailable index does not re-announce", () => {
    const { w } = inState("PAUSED_UNAVAILABLE", 1);
    expect(w.dispatch({ type: "SCRUB_TO", index: 1 })).toEqual([]);
  });

  it("TICK, PAUSE and SCRUB_END are no-ops", () => {
    for (const e of [{ type: "TICK" }, { type: "PAUSE" }, { type: "SCRUB_END" }] as WatchEvent[]) {
      const { w } = inState("PAUSED_UNAVAILABLE", 1);
      expect(w.dispatch(e)).toEqual([]);
      expect(w.getSnapshot().state).toBe("PAUSED_UNAVAILABLE");
    }
  });

  it("SCRUB_START keeps PAUSED_UNAVAILABLE but starts a scrub (journaled, no emission)", () => {
    const { w } = inState("PAUSED_UNAVAILABLE", 1);
    expect(w.dispatch({ type: "SCRUB_START" })).toEqual([]);
    const j = w.getJournal();
    expect(j[j.length - 1]).toMatchObject({
      from: "PAUSED_UNAVAILABLE",
      to: "PAUSED_UNAVAILABLE",
      event: { type: "SCRUB_START" },
    });
    expect(w.dispatch({ type: "SCRUB_TO", index: 3 })).toEqual([step(3), sc("PAUSED_UNAVAILABLE", "SCRUBBING")]);
  });

  it("RESET from PAUSED_UNAVAILABLE → initial step", () => {
    const { w } = watchAt(0);
    w.dispatch({ type: "STEP_FORWARD" });
    expect(w.dispatch({ type: "RESET" })).toEqual([step(0), sc("PAUSED_UNAVAILABLE", "IDLE")]);
  });
});

describe("transitions while scrubbing", () => {
  it("SCRUBBING: unavailable → PAUSED_UNAVAILABLE + NoAcq; available → back to SCRUBBING; END → IDLE", () => {
    const { w } = inState("SCRUBBING", 0);
    expect(w.dispatch({ type: "SCRUB_TO", index: 1 })).toEqual([
      step(1),
      noAcq(1),
      sc("SCRUBBING", "PAUSED_UNAVAILABLE"),
    ]);
    expect(w.dispatch({ type: "SCRUB_TO", index: 2 })).toEqual([step(2), noAcq(2)]);
    expect(w.dispatch({ type: "SCRUB_TO", index: 2 })).toEqual([]); // jitter: no spam
    expect(w.dispatch({ type: "SCRUB_TO", index: 3 })).toEqual([step(3), sc("PAUSED_UNAVAILABLE", "SCRUBBING")]);
    expect(w.dispatch({ type: "SCRUB_END" })).toEqual([sc("SCRUBBING", "IDLE")]);
  });

  it("SCRUB_END while paused on an unavailable step keeps PAUSED_UNAVAILABLE and ends the scrub", () => {
    const { w } = inState("SCRUBBING", 0);
    w.dispatch({ type: "SCRUB_TO", index: 2 });
    expect(w.dispatch({ type: "SCRUB_END" })).toEqual([]);
    expect(w.getSnapshot().state).toBe("PAUSED_UNAVAILABLE");
    // Scrub is over: landing on an available step now gives IDLE, not SCRUBBING.
    expect(w.dispatch({ type: "SCRUB_TO", index: 3 })).toEqual([step(3), sc("PAUSED_UNAVAILABLE", "IDLE")]);
  });

  it("PLAY, PAUSE, TICK and a second SCRUB_START are ignored mid-scrub", () => {
    for (const e of [{ type: "PLAY" }, { type: "PAUSE" }, { type: "TICK" }, { type: "SCRUB_START" }] as WatchEvent[]) {
      const { w } = inState("SCRUBBING", 0);
      expect(w.dispatch(e)).toEqual([]);
      expect(w.getSnapshot().state).toBe("SCRUBBING");
      const p = inState("PAUSED_UNAVAILABLE+scrub", 1).w;
      expect(p.dispatch(e)).toEqual([]);
      expect(p.getSnapshot().state).toBe("PAUSED_UNAVAILABLE");
    }
  });

  it("STEP_FORWARD / STEP_BACK while scrubbing behave like SCRUB_TO(index ± 1)", () => {
    const { w } = inState("SCRUBBING", 3);
    expect(w.dispatch({ type: "STEP_BACK" })).toEqual([step(2), noAcq(2), sc("SCRUBBING", "PAUSED_UNAVAILABLE")]);
    expect(w.dispatch({ type: "STEP_FORWARD" })).toEqual([step(3), sc("PAUSED_UNAVAILABLE", "SCRUBBING")]);
  });

  it("SCRUB_START from PLAYING over an unavailable step → PAUSED_UNAVAILABLE with a scrub active", () => {
    const { w } = inState("PAUSED_UNAVAILABLE", 1);
    w.dispatch({ type: "PLAY" });
    expect(w.dispatch({ type: "SCRUB_START" })).toEqual([sc("PLAYING", "PAUSED_UNAVAILABLE")]);
    expect(w.dispatch({ type: "SCRUB_TO", index: 0 })).toEqual([step(0), sc("PAUSED_UNAVAILABLE", "SCRUBBING")]);
  });

  it("RESET clears the scrub", () => {
    const { w } = inState("SCRUBBING", 0);
    w.dispatch({ type: "SCRUB_TO", index: 5 });
    expect(w.dispatch({ type: "RESET" })).toEqual([step(0), sc("SCRUBBING", "IDLE")]);
    expect(w.dispatch({ type: "SCRUB_TO", index: 3 })).toEqual([step(3)]); // IDLE → IDLE, no scrub
  });
});

describe("index clamping", () => {
  it("clamps out-of-range SCRUB_TO, rounds fractions, ignores NaN", () => {
    const { w } = watchAt(3);
    expect(w.dispatch({ type: "SCRUB_TO", index: -7 })).toEqual([step(0)]);
    expect(w.dispatch({ type: "SCRUB_TO", index: 1e9 })).toEqual([step(5)]);
    expect(w.dispatch({ type: "SCRUB_TO", index: 2.6 })).toEqual([step(3)]);
    expect(w.dispatch({ type: "SCRUB_TO", index: Number.NaN })).toEqual([]);
    expect(w.dispatch({ type: "SCRUB_TO", index: Number.NEGATIVE_INFINITY })).toEqual([step(0)]);
    expect(w.dispatch({ type: "SCRUB_TO", index: Number.POSITIVE_INFINITY })).toEqual([step(5)]);
    expect(w.getSnapshot().index).toBe(5);
  });
});

describe("degenerate missions", () => {
  const ALL_U = [
    makeStep("u0", "2026-01-01", false),
    makeStep("u1", "2026-01-13", false),
    makeStep("u2", "2026-01-25", false),
  ];

  it("an all-unavailable mission never loops: one TICK ends playback", () => {
    const w = createTemporalWatch(ALL_U, { now: () => AT });
    expect(w.getSnapshot().state).toBe("PAUSED_UNAVAILABLE");
    expect(w.dispatch({ type: "PLAY" })).toEqual([sc("PAUSED_UNAVAILABLE", "PLAYING")]);
    expect(w.dispatch({ type: "TICK" })).toEqual([
      noAcq(1, ALL_U),
      noAcq(2, ALL_U),
      end(),
      sc("PLAYING", "PAUSED_UNAVAILABLE"),
    ]);
    // A UI timer that keeps ticking is harmless.
    for (let i = 0; i < 1000; i++) expect(w.dispatch({ type: "TICK" })).toEqual([]);
    // Replaying is bounded too.
    for (let i = 0; i < 50; i++) {
      w.dispatch({ type: "PLAY" });
      const out = w.dispatch({ type: "TICK" });
      expect(out.length).toBeLessThanOrEqual(ALL_U.length + 2);
      expect(w.getSnapshot().state).toBe("PAUSED_UNAVAILABLE");
    }
  });

  it("all-unavailable: PLAY from a later index rewinds and announces step 0", () => {
    const w = createTemporalWatch(ALL_U, { now: () => AT, initialIndex: 2 });
    expect(w.dispatch({ type: "PLAY" })).toEqual([
      { type: "StepChanged", index: 0, stepId: "u0", atMs: AT },
      noAcq(0, ALL_U),
      sc("PAUSED_UNAVAILABLE", "PLAYING"),
    ]);
  });

  it("a single-step mission plays and ends immediately", () => {
    const one = [makeStep("only", "2026-01-01", true)];
    const w = createTemporalWatch(one, { now: () => AT });
    expect(w.dispatch({ type: "PLAY" })).toEqual([sc("IDLE", "PLAYING")]);
    expect(w.dispatch({ type: "TICK" })).toEqual([end(), sc("PLAYING", "IDLE")]);
  });
});

describe("journal, clock and subscriptions", () => {
  it("journals every dispatched event (including no-ops) with atMs from the injected clock", () => {
    const clock = fixedClock(500);
    const w = createTemporalWatch(STEPS, { now: clock.now });
    w.dispatch({ type: "PLAY" });
    clock.set(2500);
    w.dispatch({ type: "TICK" });
    clock.set(2600);
    w.dispatch({ type: "PLAY" }); // no-op
    clock.set(3000);
    w.dispatch({ type: "SCRUB_TO", index: 4 });
    expect(w.getJournal()).toEqual([
      { atMs: 500, event: { type: "PLAY" }, from: "IDLE", to: "PLAYING", index: 0 },
      { atMs: 2500, event: { type: "TICK" }, from: "PLAYING", to: "PLAYING", index: 3 },
      { atMs: 2600, event: { type: "PLAY" }, from: "PLAYING", to: "PLAYING", index: 3 },
      { atMs: 3000, event: { type: "SCRUB_TO", index: 4 }, from: "PLAYING", to: "PAUSED_UNAVAILABLE", index: 4 },
    ]);
  });

  it("emissions of one dispatch share the clock reading", () => {
    const clock = fixedClock(42);
    const w = createTemporalWatch(STEPS, { now: clock.now });
    w.dispatch({ type: "PLAY" });
    clock.set(77);
    const out = w.dispatch({ type: "TICK" });
    expect(out.every((e) => e.atMs === 77)).toBe(true);
  });

  it("defaults to a logical clock (dispatch sequence number) — no wall clock in core-sim", () => {
    const w = createTemporalWatch(STEPS);
    w.dispatch({ type: "PLAY" });
    w.dispatch({ type: "TICK" });
    w.dispatch({ type: "PAUSE" });
    expect(w.getJournal().map((j) => j.atMs)).toEqual([0, 1, 2]);
  });

  it("journal entries are frozen copies (caller mutation cannot rewrite history)", () => {
    const w = createTemporalWatch(STEPS, { now: () => 1 });
    const e = { type: "SCRUB_TO", index: 3 } as { type: "SCRUB_TO"; index: number };
    w.dispatch(e);
    e.index = 0;
    expect(w.getJournal()[0]?.event).toEqual({ type: "SCRUB_TO", index: 3 });
    expect(Object.isFrozen(w.getJournal()[0])).toBe(true);
  });

  it("journalLimit keeps the newest entries", () => {
    const w = createTemporalWatch(STEPS, { now: () => 1, journalLimit: 3 });
    for (let i = 0; i < 10; i++) w.dispatch({ type: "SCRUB_TO", index: i % 6 });
    const j = w.getJournal();
    expect(j).toHaveLength(3);
    expect(j.map((x) => (x.event as { index: number }).index)).toEqual([1, 2, 3]);
  });

  it("subscribers hear changes only; snapshot identity is stable across no-ops; unsubscribe works", () => {
    const w = createTemporalWatch(STEPS, { now: () => 1 });
    const calls: Array<{ state: WatchState; n: number }> = [];
    const off = w.subscribe((s, em) => calls.push({ state: s.state, n: em.length }));
    const before = w.getSnapshot();
    w.dispatch({ type: "PAUSE" }); // no-op
    expect(w.getSnapshot()).toBe(before);
    expect(calls).toEqual([]);
    w.dispatch({ type: "PLAY" });
    expect(calls).toEqual([{ state: "PLAYING", n: 1 }]);
    expect(w.getSnapshot()).not.toBe(before);
    expect(Object.isFrozen(w.getSnapshot())).toBe(true);
    off();
    w.dispatch({ type: "PAUSE" });
    expect(calls).toHaveLength(1);
  });

  it("a throwing subscriber does not starve the others; the error is rethrown", () => {
    const w = createTemporalWatch(STEPS, { now: () => 1 });
    let heard = 0;
    w.subscribe(() => {
      throw new Error("boom");
    });
    w.subscribe(() => {
      heard++;
    });
    expect(() => w.dispatch({ type: "PLAY" })).toThrow("boom");
    expect(heard).toBe(1);
    expect(w.getSnapshot().state).toBe("PLAYING");
  });

  it("is deterministic: the same event script gives identical emissions and journals", () => {
    const script: WatchEvent[] = [
      { type: "PLAY" },
      { type: "TICK" },
      { type: "SCRUB_START" },
      { type: "SCRUB_TO", index: 1 },
      { type: "SCRUB_TO", index: 5 },
      { type: "SCRUB_END" },
      { type: "PLAY" },
      { type: "TICK" },
      { type: "STEP_BACK" },
      { type: "RESET" },
    ];
    const run = () => {
      let t = 0;
      const w = createTemporalWatch(STEPS, { now: () => (t += 16) });
      const em = script.map((e) => w.dispatch(e));
      return { em, journal: w.getJournal(), snap: w.getSnapshot() };
    };
    expect(run()).toEqual(run());
  });
});
