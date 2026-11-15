import type { CSSProperties } from "react";
import { HexSpinner } from "./HexSpinner";
import { Logo } from "./Logo";

export type WipePhase = "idle" | "covering" | "covered" | "revealing";

export interface WipeOverlayProps {
  phase: WipePhase;
  /** 0..1 while holding (scene/tiles loading); null = indeterminate. */
  progress: number | null;
  /** Status line, e.g. "Preparing your expedition". */
  label: string;
  reducedMotion: boolean;
  durationMs: number;
  /** Optional background plate (mockup §10: art/outpost-plate.jpg), always under an Ink scrim. */
  backgroundUrl?: string | null;
  /** Footer tagline. Default "Look closer. Every change tells a story." Pass "" to hide. */
  tagline?: string;
  /** Show the BlindRev wordmark in the hold state. Default true. */
  showWordmark?: boolean;
}

/** Full-screen travel wipe to Ink (500 ms, cubic-bezier(0.2,0,0,1)); its hold state is the loading screen
 *  (wordmark, hex spinner, label, thin progress bar + mono %, tagline). Immediate cut under reduced motion.
 *  The caller drives phases: idle → covering → covered (hold until ready) → revealing → idle. */
export function WipeOverlay({
  phase,
  progress,
  label,
  reducedMotion,
  durationMs,
  backgroundUrl = null,
  tagline = "Look closer. Every change tells a story.",
  showWordmark = true,
}: WipeOverlayProps) {
  const pct = progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const cls = ["br-wipe", `br-wipe--${phase}`, reducedMotion ? "br-wipe--cut" : ""].filter(Boolean).join(" ");
  const visible = phase !== "idle" && !(reducedMotion && phase === "revealing");
  const showHud = phase === "covered" || (reducedMotion && phase === "covering");
  return (
    <div
      className={cls}
      data-testid="wipe"
      data-phase={phase}
      aria-hidden={visible ? undefined : true}
      style={{ "--br-wipe-ms": `${Math.max(0, durationMs)}ms` } as CSSProperties}
    >
      <div className="br-wipe__panel">
        {backgroundUrl ? (
          <div className="br-wipe__plate" style={{ backgroundImage: `url("${backgroundUrl}")` }} aria-hidden="true" />
        ) : null}
        {showHud ? (
          <div className="br-wipe__hud" data-testid="wipe-hud">
            {showWordmark ? <Logo variant="wordmark" size={56} className="br-wipe__logo" /> : null}
            <HexSpinner size={56} label={label} />
            <p className="br-wipe__label">{label}</p>
            <div className="br-wipe__progress">
              <div className="br-wipe__line" aria-hidden="true">
                <span
                  className={`br-wipe__line-fill${pct === null ? " is-indeterminate" : ""}`}
                  style={pct === null ? undefined : { width: `${pct}%` }}
                />
              </div>
              <p className="br-mono br-wipe__pct">{pct === null ? "…" : `${pct}%`}</p>
            </div>
            {tagline ? <p className="br-wipe__tagline">{tagline}</p> : null}
          </div>
        ) : null}
      </div>
      <span className="br-wipe__edge" aria-hidden="true" />
    </div>
  );
}
