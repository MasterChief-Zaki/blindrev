export interface HexSpinnerProps {
  /** Symbol size in px (default 64). */
  size?: number;
  /** Accessible status text, e.g. "Preparing your expedition". Default "Loading". */
  label?: string;
}

// Pointy-top hexagon on a 64 grid. Perimeter = 6 × side.
const SIDE = 26;
const CX = 32;
const CY = 32;
const PTS = Array.from({ length: 6 }, (_, i) => {
  const a = ((-90 + i * 60) * Math.PI) / 180;
  return `${(CX + SIDE * Math.cos(a)).toFixed(3)},${(CY + SIDE * Math.sin(a)).toFixed(3)}`;
}).join(" ");
const PERIMETER = 6 * SIDE;

/** Thin outlined hexagon with one cyan segment travelling round it (static segment under reduced motion). */
export function HexSpinner({ size = 64, label = "Loading" }: HexSpinnerProps) {
  return (
    <span className="br-hexspin" role="status" data-testid="hex-spinner" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <polygon className="br-hexspin__frame" points={PTS} />
        <polygon
          className="br-hexspin__seg"
          points={PTS}
          pathLength={PERIMETER}
          strokeDasharray={`${SIDE} ${PERIMETER - SIDE}`}
        />
      </svg>
      <span className="br-visually-hidden">{label}</span>
    </span>
  );
}
