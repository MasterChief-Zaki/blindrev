import { daysBetween } from "@blindrev/core-sim";
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useId, useRef } from "react";
import type { TemporalStep, WatchState } from "../coreTypes";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { playSound } from "../sound/sound";

export interface TimelinePair {
  a: string | null;
  b: string | null;
}

export interface TemporalTimelineProps {
  steps: TemporalStep[];
  index: number;
  state: WatchState;
  pair: TimelinePair;
  onScrubStart(): void;
  onScrubTo(i: number): void;
  onScrubEnd(): void;
  onPlay(): void;
  onPause(): void;
  onStep(dir: -1 | 1): void;
  onPairChange(pair: TimelinePair): void;
  reducedMotion: boolean;
  dtMinDays: number;
}

/** Whole days between two step dates (B − A; negative when A is later). NaN when unparsable. */
export function daysApart(isoA: string, isoB: string): number {
  const d = daysBetween(isoA, isoB);
  return Number.isNaN(d) ? d : Math.round(d);
}

const dateOf = (s: TemporalStep) => s.date.slice(0, 10);
const sensorOf = (s: TemporalStep) => [s.platform, s.instrument].filter(Boolean).join(" ");

/** Screen-reader value text: "Step 4 of 9, 2026-03-14, NISAR L-SAR, available". */
export function timelineValueText(steps: TemporalStep[], index: number, pair?: TimelinePair): string {
  const s = steps[index];
  if (!s) return "No acquisitions loaded";
  const parts = [
    `Step ${index + 1} of ${steps.length}`,
    dateOf(s),
    sensorOf(s),
    s.isAvailable ? "available" : "no acquisition",
  ];
  if (pair?.a === s.stepId) parts.push("marked A, baseline");
  if (pair?.b === s.stepId) parts.push("marked B, comparison");
  return parts.join(", ");
}

const STATE_META: Record<WatchState, { word: string; icon: IconName; tone: "cyan" | "amber" | "pearl" }> = {
  IDLE: { word: "Ready", icon: "timeLens", tone: "pearl" },
  PLAYING: { word: "Playing", icon: "play", tone: "cyan" },
  PAUSED_UNAVAILABLE: { word: "Paused: no acquisition", icon: "alert", tone: "amber" },
  SCRUBBING: { word: "Scrubbing", icon: "move", tone: "cyan" },
};

export function TemporalTimeline({
  steps,
  index,
  state,
  pair,
  onScrubStart,
  onScrubTo,
  onScrubEnd,
  onPlay,
  onPause,
  onStep,
  onPairChange,
  reducedMotion,
  dtMinDays,
}: TemporalTimelineProps) {
  const helpId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; last: number } | null>(null);
  const n = steps.length;
  const cur = n > 0 ? Math.min(n - 1, Math.max(0, index)) : -1;
  const current = cur >= 0 ? steps[cur] : undefined;
  const playing = state === "PLAYING";
  const meta = STATE_META[state];

  const indexAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el || n === 0) return 0;
    const r = el.getBoundingClientRect();
    const f = (clientX - r.left) / Math.max(1, r.width);
    return Math.min(n - 1, Math.max(0, Math.floor(f * n)));
  };

  const scrubJump = (i: number) => {
    if (n === 0) return;
    onScrubStart();
    onScrubTo(i);
    onScrubEnd();
  };

  // ------------------------------------------------------------ pointer scrub
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (n === 0 || e.button !== 0) return;
    e.preventDefault();
    trackRef.current?.focus({ preventScroll: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    const i = indexAt(e.clientX);
    dragRef.current = { pointerId: e.pointerId, last: i };
    onScrubStart();
    onScrubTo(i);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const i = indexAt(e.clientX);
    if (i !== d.last) {
      d.last = i;
      onScrubTo(i);
    }
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    onScrubEnd();
  };

  // ------------------------------------------------------------ keyboard
  const togglePlay = () => {
    if (reducedMotion) return;
    if (playing) onPause();
    else onPlay();
  };
  const markCurrent = (which: "a" | "b") => {
    if (current) setPair(which, current);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        onStep(-1);
        break;
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        onStep(1);
        break;
      case "Home":
        e.preventDefault();
        scrubJump(0);
        break;
      case "End":
        e.preventDefault();
        scrubJump(n - 1);
        break;
      case " ":
      case "Spacebar":
        e.preventDefault();
        togglePlay();
        break;
      case "a":
      case "A":
        e.preventDefault();
        markCurrent("a");
        break;
      case "b":
      case "B":
        e.preventDefault();
        markCurrent("b");
        break;
    }
  };

  // ------------------------------------------------------------ pair
  function setPair(which: "a" | "b", step: TemporalStep) {
    if (!step.isAvailable) return;
    playSound("press");
    const id = step.stepId;
    if (which === "a") {
      if (pair.a === id) onPairChange({ a: null, b: pair.b });
      else onPairChange({ a: id, b: pair.b === id ? null : pair.b });
    } else if (pair.b === id) onPairChange({ a: pair.a, b: null });
    else onPairChange({ a: pair.a === id ? null : pair.a, b: id });
  }
  const stepA = pair.a ? steps.find((s) => s.stepId === pair.a) : undefined;
  const stepB = pair.b ? steps.find((s) => s.stepId === pair.b) : undefined;
  const dt = stepA && stepB ? daysApart(stepA.date, stepB.date) : null;
  const dtAbs = dt === null || Number.isNaN(dt) ? null : Math.abs(dt);
  const tooShort = dtAbs !== null && dtAbs < dtMinDays;
  const reversed = dt !== null && dt < 0;
  const pairUnavailable = Boolean((stepA && !stepA.isAvailable) || (stepB && !stepB.isAvailable));

  const cols = { "--br-steps": String(Math.max(1, n)) } as CSSProperties;

  return (
    <section className="br-timeline" data-testid="timeline" aria-label="Temporal watch" data-state={state}>
      <div className="br-timeline__bar">
        <div className="br-timeline__transport" role="group" aria-label="Playback">
          <Button
            variant="secondary"
            icon="stepBack"
            aria-label="Step back"
            title="Step back"
            disabled={n === 0 || cur <= 0}
            onClick={() => onStep(-1)}
            data-testid="timeline-back"
          />
          {reducedMotion ? (
            <button
              type="button"
              className="br-btn br-btn--secondary br-btn--md is-disabled br-timeline__noplay"
              aria-disabled="true"
              data-testid="timeline-play"
              data-reduced-motion="true"
              onClick={(e) => e.preventDefault()}
            >
              <Icon name="info" size={16} />
              <span className="br-btn__label">Auto-play is off (reduced motion)</span>
            </button>
          ) : (
            <Button
              variant="primary"
              icon={playing ? "pause" : "play"}
              onClick={togglePlay}
              disabled={n === 0}
              aria-pressed={playing}
              data-testid="timeline-play"
              className="br-timeline__play"
            >
              {playing ? "Pause" : "Play"}
            </Button>
          )}
          <Button
            variant="secondary"
            icon="stepForward"
            aria-label="Step forward"
            title="Step forward"
            disabled={n === 0 || cur >= n - 1}
            onClick={() => onStep(1)}
            data-testid="timeline-forward"
          />
        </div>

        <div className="br-timeline__readout">
          <p className="br-kicker br-timeline__counter">
            STEP {String(cur + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
          </p>
          {current ? (
            <p className="br-timeline__now">
              <span className="br-mono br-timeline__now-date">{dateOf(current)}</span>
              <span className="br-timeline__now-sensor">{sensorOf(current) || "Unknown sensor"}</span>
              {current.isAvailable ? (
                <span className="br-timeline__avail is-ok">
                  <Icon name="check" size={16} /> Acquisition
                </span>
              ) : (
                <span className="br-timeline__avail is-none">
                  <Icon name="alert" size={16} /> No acquisition
                </span>
              )}
            </p>
          ) : (
            <p className="br-timeline__now">No acquisitions loaded</p>
          )}
        </div>

        <p className={`br-timeline__state br-timeline__state--${meta.tone}`} data-testid="timeline-state">
          <Icon name={meta.icon} size={16} />
          <span className="br-label">Watch</span>
          <span className="br-mono">{meta.word}</span>
        </p>
      </div>

      <div className="br-timeline__scroller">
        <div className="br-timeline__grid" style={cols}>
          <div
            ref={trackRef}
            className="br-timeline__track"
            role="slider"
            tabIndex={n === 0 ? -1 : 0}
            aria-label="Acquisition timeline"
            aria-valuemin={1}
            aria-valuemax={Math.max(1, n)}
            aria-valuenow={cur + 1}
            aria-valuetext={timelineValueText(steps, cur, pair)}
            aria-describedby={helpId}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            data-testid="timeline-track"
          >
            <span className="br-timeline__rail" aria-hidden="true" />
            {steps.map((s, i) => {
              const isA = pair.a === s.stepId;
              const isB = pair.b === s.stepId;
              const cls = [
                "br-timeline__step",
                s.isAvailable ? "" : "is-unavailable",
                i === cur ? "is-current" : "",
                isA ? "is-a" : "",
                isB ? "is-b" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const tip = s.isAvailable
                ? `${dateOf(s)} · ${sensorOf(s)} · ${s.processingVersion}${s.acquisition ? ` · ${s.acquisition.orbitDirection.toLowerCase()} track ${s.acquisition.track ?? "—"}` : ""}`
                : `${dateOf(s)} · No acquisition (${sensorOf(s)})`;
              return (
                <div
                  key={s.stepId}
                  className={cls}
                  data-testid={`timeline-step-${i}`}
                  data-available={s.isAvailable}
                  title={tip}
                  aria-hidden="true"
                >
                  <span className="br-timeline__flags">
                    {isA ? (
                      <span className="br-timeline__flag br-timeline__flag--a">
                        <b>A</b>
                        <span>Base</span>
                      </span>
                    ) : null}
                    {isB ? (
                      <span className="br-timeline__flag br-timeline__flag--b">
                        <b>B</b>
                        <span>Compare</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="br-timeline__tick" />
                  <span className="br-mono br-timeline__date">{dateOf(s)}</span>
                  {s.isAvailable ? (
                    <span className="br-timeline__sensor">{s.instrument || s.platform}</span>
                  ) : (
                    <span className="br-timeline__none">No acquisition</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="br-timeline__pairs" role="group" aria-label="Date pair: mark A (baseline) and B (comparison)">
            {steps.map((s, i) => {
              const isA = pair.a === s.stepId;
              const isB = pair.b === s.stepId;
              const off = !s.isAvailable;
              const date = dateOf(s);
              return (
                <div key={s.stepId} className="br-timeline__paircell">
                  <button
                    type="button"
                    className={`br-pairbtn br-pairbtn--a${isA ? " is-on" : ""}`}
                    aria-pressed={isA}
                    aria-disabled={off ? true : undefined}
                    aria-label={off ? `${date}: no acquisition, cannot be baseline` : `Mark ${date} as A, baseline`}
                    title={off ? "No acquisition, can't compare" : "Mark as A (baseline)"}
                    onClick={() => setPair("a", s)}
                    data-testid={`timeline-pair-a-${i}`}
                  >
                    A
                  </button>
                  <button
                    type="button"
                    className={`br-pairbtn br-pairbtn--b${isB ? " is-on" : ""}`}
                    aria-pressed={isB}
                    aria-disabled={off ? true : undefined}
                    aria-label={off ? `${date}: no acquisition, cannot be comparison` : `Mark ${date} as B, comparison`}
                    title={off ? "No acquisition, can't compare" : "Mark as B (comparison)"}
                    onClick={() => setPair("b", s)}
                    data-testid={`timeline-pair-b-${i}`}
                  >
                    B
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="br-timeline__pairbar" data-testid="timeline-pair-summary">
        <p className="br-timeline__pairslot">
          <span className="br-timeline__flag br-timeline__flag--a">
            <b>A</b>
            <span>Baseline</span>
          </span>
          <span className="br-mono">{stepA ? dateOf(stepA) : "— not set"}</span>
        </p>
        <p className="br-timeline__pairslot">
          <span className="br-timeline__flag br-timeline__flag--b">
            <b>B</b>
            <span>Compare</span>
          </span>
          <span className="br-mono">{stepB ? dateOf(stepB) : "— not set"}</span>
        </p>
        <p
          className={`br-timeline__dt${tooShort ? " is-warn" : dtAbs !== null ? " is-ok" : ""}`}
          data-testid="timeline-dt"
        >
          <span className="br-label">Δt</span>
          <span className="br-mono">{dtAbs === null ? "—" : `${dtAbs} days`}</span>
          {dtAbs !== null && !tooShort ? <Icon name="check" size={16} title="Far enough apart" /> : null}
        </p>
        <div className="br-timeline__pairactions">
          {reversed ? (
            <Button
              variant="ghost"
              icon="undo"
              onClick={() => onPairChange({ a: pair.b, b: pair.a })}
              data-testid="timeline-pair-swap"
            >
              Swap A and B
            </Button>
          ) : null}
          {pair.a || pair.b ? (
            <Button
              variant="ghost"
              icon="close"
              onClick={() => onPairChange({ a: null, b: null })}
              data-testid="timeline-pair-clear"
            >
              Clear pair
            </Button>
          ) : null}
        </div>
        {tooShort || reversed || pairUnavailable ? (
          <div className="br-timeline__warn" role="note" data-testid="timeline-pair-warning">
            <Icon name="alert" size={16} />
            <span>
              {pairUnavailable
                ? "One of the marked dates has no acquisition. Pick two dates that have a pass."
                : tooShort
                  ? `A and B are only ${dtAbs} days apart. Pick dates at least ${dtMinDays} days apart.`
                  : "A (baseline) is later than B. Swap them so the baseline comes first."}
            </span>
          </div>
        ) : null}
      </div>

      <p id={helpId} className="br-visually-hidden">
        Left and right arrows step between acquisitions. Home and End jump to the first and last. Space plays or pauses.
        A and B mark the current step as baseline or comparison.
      </p>
    </section>
  );
}
