export type LogoVariant = "wordmark" | "ring" | "lockup";

export interface LogoProps {
  /** Height in px: wordmark cap-to-baseline font size, or the ring symbol size (min 24). */
  size?: number;
  /** Back-compat with ARCHITECTURE §6: true → "lockup", false → "ring" (only when `variant` is not set). */
  withWordmark?: boolean;
  /** "wordmark" (default, mockups §10): Pearl Outfit 800 "BlindRev" with the cyan notch at the foot of the R.
   *  "ring": the compact hex-ring mark for small HUD use. "lockup": ring + wordmark. */
  variant?: LogoVariant;
  className?: string;
}

// Softened hexagonal instrument ring (pointy-top), opened at the upper-right edge — "the open signal" —
// around one clear observation point. Drawn on a 48 grid, matte cyan, never glowing.
const R = 17;
const C = 24;
const V = Array.from({ length: 6 }, (_, i) => {
  const a = ((-90 + i * 60) * Math.PI) / 180;
  return [C + R * Math.cos(a), C + R * Math.sin(a)] as const;
});
function ringPath(gap: number): string {
  const [x0, y0] = V[0]!;
  const [x1, y1] = V[1]!;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const dx = (x1 - x0) / len;
  const dy = (y1 - y0) / len;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const f = (n: number) => n.toFixed(2);
  const pts = [V[1]!, V[2]!, V[3]!, V[4]!, V[5]!, V[0]!];
  return `M${f(mx + dx * gap)} ${f(my + dy * gap)} ${pts.map(([x, y]) => `L${f(x)} ${f(y)}`).join(" ")} L${f(mx - dx * gap)} ${f(my - dy * gap)}`;
}
const RING = ringPath(3.2);

function Ring({ size }: { size: number }) {
  const s = Math.max(24, size);
  const simple = s < 32;
  return (
    <svg className="br-logo__mark" width={s} height={s} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        d={RING}
        fill="none"
        stroke="currentColor"
        strokeWidth={simple ? 6 : 5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {simple ? (
        <circle cx={C} cy={C} r={4.2} fill="currentColor" />
      ) : (
        <>
          <circle cx={C} cy={C} r={3.6} fill="currentColor" />
          <circle cx={C} cy={C} r={7.6} fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray="2.4 3.2" />
        </>
      )}
    </svg>
  );
}

/** Wordmark: the R's stem foot is cut and replaced by a small cyan parallelogram notch. */
function Wordmark({ size }: { size: number }) {
  return (
    <span className="br-wordmark" aria-hidden="true" style={{ fontSize: `${(size / 16).toFixed(3)}rem` }}>
      Blind
      <span className="br-wordmark__r">
        <span className="br-wordmark__rglyph">R</span>
        <span className="br-wordmark__notch" />
      </span>
      ev
    </span>
  );
}

export function Logo({ size, withWordmark, variant, className }: LogoProps) {
  const v: LogoVariant = variant ?? (withWordmark === undefined ? "wordmark" : withWordmark ? "lockup" : "ring");
  const s = size ?? (v === "wordmark" ? 72 : 48);
  return (
    <span
      className={["br-logo", `br-logo--${v}`, className ?? ""].filter(Boolean).join(" ")}
      role="img"
      aria-label="BlindRev"
      data-testid="logo"
    >
      {v !== "wordmark" ? <Ring size={v === "lockup" ? s : s} /> : null}
      {v !== "ring" ? <Wordmark size={v === "lockup" ? s * 0.62 : s} /> : null}
    </span>
  );
}
