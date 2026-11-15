import { type CSSProperties, type KeyboardEvent, useId, useRef } from "react";
import { playSound } from "../sound/sound";

// ------------------------------------------------------------------ Slider

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(v: number): void;
  unit?: string;
  /** Override the visible readout (e.g. "60%"). */
  format?(v: number): string;
  "data-testid"?: string;
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

export function Slider({ label, value, min, max, step = 1, onChange, unit, format, ...rest }: SliderProps) {
  const id = useId();
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const shown = format
    ? format(value)
    : `${value.toFixed(decimalsOf(step))}${unit ? `${unit === "%" ? "" : " "}${unit}` : ""}`;
  return (
    <div className="br-slider" style={{ "--br-pct": `${Math.min(100, Math.max(0, pct))}%` } as CSSProperties}>
      <div className="br-slider__head">
        <label htmlFor={id} className="br-label br-slider__label">
          {label}
        </label>
        <output htmlFor={id} className="br-mono br-slider__value">
          {shown}
        </output>
      </div>
      <input
        id={id}
        className="br-slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={shown}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        data-testid={rest["data-testid"]}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Toggle

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
  "data-testid"?: string;
}

/** Switch with a visible ON/OFF word (never colour alone). */
export function Toggle({ label, checked, onChange, disabled = false, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`br-toggle${checked ? " is-on" : ""}`}
      onClick={() => {
        playSound("press");
        onChange(!checked);
      }}
      data-testid={rest["data-testid"]}
    >
      <span className="br-toggle__label">{label}</span>
      <span className="br-toggle__state br-mono" aria-hidden="true">
        {checked ? "ON" : "OFF"}
      </span>
      <span className="br-toggle__track" aria-hidden="true">
        <span className="br-toggle__thumb" />
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ Tabs

export interface TabsProps {
  tabs: { id: string; label: string }[];
  value: string;
  onChange(id: string): void;
  /** Accessible name for the tab list. */
  label?: string;
  /** Prefix for `aria-controls` → `${idPrefix}-panel-${id}` (the caller renders the tabpanels). */
  idPrefix?: string;
}

/** Tab list with roving tabindex; arrows/Home/End move focus and select (automatic activation). */
export function Tabs({ tabs, value, onChange, label = "Views", idPrefix }: TabsProps) {
  const fallback = useId();
  const prefix = idPrefix ?? `br-tabs${fallback.replace(/:/g, "")}`;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(
    0,
    tabs.findIndex((t) => t.id === value),
  );
  const go = (i: number) => {
    const n = tabs.length;
    if (n === 0) return;
    const next = ((i % n) + n) % n;
    refs.current[next]?.focus();
    const t = tabs[next];
    if (t && t.id !== value) {
      playSound("press");
      onChange(t.id);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        go(current + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        go(current - 1);
        break;
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(tabs.length - 1);
        break;
    }
  };
  return (
    <div className="br-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => {
        const selected = i === current;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${prefix}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            className={`br-tab${selected ? " is-selected" : ""}`}
            onClick={() => go(i)}
            data-testid={`tab-${t.id}`}
          >
            <span className="br-tab__label">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
