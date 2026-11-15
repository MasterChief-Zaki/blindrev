/** Outpost Signal motif: the open hexagonal instrument ring, a faint survey grid and orbit arcs. Static SVG, no glow. */
export function SignalMotif({ className }: { className?: string }) {
  const hex = (r: number, cx: number, cy: number, gapDeg = 0) => {
    const pts: string[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = ((60 * i - 90 + gapDeg) * Math.PI) / 180;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const grid = [];
  for (let i = 0; i <= 24; i++) {
    grid.push(<line key={`v${i}`} x1={i * 80} y1={0} x2={i * 80} y2={1080} />);
  }
  for (let j = 0; j <= 14; j++) {
    grid.push(<line key={`h${j}`} x1={0} y1={j * 80} x2={1920} y2={j * 80} />);
  }
  return (
    <svg className={className} viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g stroke="rgba(243,245,247,0.05)" strokeWidth={1}>
        {grid}
      </g>
      <g fill="none" strokeLinecap="round">
        <ellipse
          cx={1340}
          cy={560}
          rx={620}
          ry={210}
          stroke="rgba(108,92,231,0.35)"
          strokeWidth={1.5}
          transform="rotate(-18 1340 560)"
        />
        <ellipse
          cx={1340}
          cy={560}
          rx={480}
          ry={150}
          stroke="rgba(61,224,208,0.22)"
          strokeWidth={1}
          strokeDasharray="4 10"
          transform="rotate(-18 1340 560)"
        />
        <polyline
          points={hex(300, 1340, 560)}
          stroke="rgba(224,72,155,0.55)"
          strokeWidth={14}
          strokeDasharray="1500 260"
          strokeLinejoin="round"
        />
        <polyline points={hex(220, 1340, 560)} stroke="rgba(243,245,247,0.10)" strokeWidth={2} strokeLinejoin="round" />
        <circle cx={1340} cy={560} r={14} fill="#3DE0D0" stroke="none" />
        <circle cx={1340} cy={560} r={40} stroke="rgba(61,224,208,0.4)" strokeWidth={2} />
        <path d="M1700 220 l14 0 M1707 213 l0 14" stroke="#F2B441" strokeWidth={2} />
        <path d="M980 860 l14 0 M987 853 l0 14" stroke="#F2B441" strokeWidth={2} />
      </g>
    </svg>
  );
}
