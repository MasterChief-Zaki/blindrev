import { useId } from "react";

// ------------------------------------------------------------------ Legend

export interface LegendProps {
  ramp: [string, string, string];
  labels: [string, string, string];
  unit: string;
  title: string;
}

/** 3-step matte ramp. Swatches carry no text; each step has a word underneath (LOW / MID / HIGH). */
export function Legend({ ramp, labels, unit, title }: LegendProps) {
  const id = useId();
  const steps = ["LOW", "MID", "HIGH"] as const;
  return (
    <figure className="br-legend" aria-labelledby={id}>
      <figcaption id={id} className="br-legend__head">
        <span className="br-label br-legend__title">{title}</span>
        <span className="br-mono br-legend__unit">{unit}</span>
      </figcaption>
      <ol className="br-legend__ramp">
        {ramp.map((color, i) => (
          <li key={steps[i]} className="br-legend__step">
            <span className="br-legend__swatch" style={{ background: color }} aria-hidden="true" />
            <span className="br-legend__word br-label">{steps[i]}</span>
            <span className="br-legend__value br-mono">{labels[i]}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

// ------------------------------------------------------------------ Stat

export interface StatProps {
  label: string;
  value: string;
  unit?: string;
  /** Render the value in Plex Mono (telemetry). Default: Outfit display numerals. */
  mono?: boolean;
  "data-testid"?: string;
}

export function Stat({ label, value, unit, mono = false, ...rest }: StatProps) {
  return (
    <div className="br-stat" data-testid={rest["data-testid"]}>
      <span className="br-label br-stat__label">{label}</span>
      <span className={`br-stat__value${mono ? " br-stat__value--mono" : ""}`}>
        <span className="br-stat__num">{value}</span>
        {unit ? <span className="br-stat__unit">{unit}</span> : null}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ ProgressBar

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  label: string;
  /** "hud" (default): caps label above the bar. "loading" (mockup §10): label visually hidden,
   *  thin bar with the percentage centred in mono beneath. Both: thin cyan bar on a muted track. */
  variant?: "hud" | "loading";
  "data-testid"?: string;
}

export function ProgressBar({ value, label, variant = "hud", ...rest }: ProgressBarProps) {
  const id = useId();
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const pct = Math.round(v * 100);
  return (
    <div className={`br-progress br-progress--${variant}`} data-testid={rest["data-testid"]}>
      <div className="br-progress__head">
        <span id={id} className={variant === "loading" ? "br-visually-hidden" : "br-label br-progress__label"}>
          {label}
        </span>
      </div>
      <div
        className="br-progress__track"
        role="progressbar"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
      >
        <span className="br-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="br-mono br-progress__value" aria-hidden="true">
        {pct}%
      </span>
    </div>
  );
}
