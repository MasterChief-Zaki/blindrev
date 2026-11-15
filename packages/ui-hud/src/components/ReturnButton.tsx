import { playSound } from "../sound/sound";

export interface ReturnButtonProps {
  onClick(): void;
  /** Visible label and accessible name, e.g. "Return to hub". */
  label: string;
  "data-testid"?: string;
}

/** 24 px chamfered glyph inside a ≥ 44×44 target, with a visible label. */
export function ReturnButton({ onClick, label, ...rest }: ReturnButtonProps) {
  return (
    <button
      type="button"
      className="br-return"
      aria-label={label}
      onClick={() => {
        playSound("press");
        onClick();
      }}
      data-testid={rest["data-testid"] ?? "return-button"}
    >
      <svg className="br-return__glyph" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 1h17v17l-5 5H1V6Z" fill="currentColor" />
        <path
          d="M17 12H7.5M11.5 8l-4 4 4 4"
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="br-return__label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
