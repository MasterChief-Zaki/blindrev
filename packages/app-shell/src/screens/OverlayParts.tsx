/** Small SVG pieces for the overlays (case file, verdict, Case Journal). SVG/CSS only — no canvas, no WebGL. */
import { useId, useState } from "react";
import type { ScoreOutcome } from "../types";

interface LL {
  lon: number;
  lat: number;
}
type Bounds = readonly [number, number, number, number]; // west, south, east, north

const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;

/** Locator for the case file: the area of interest drawn from the manifest bounds on a plain graticule. */
export function AoiLocator({ bounds, caption }: { bounds: Bounds; caption?: string }) {
  const [w, s, e, n] = bounds;
  const midLat = (s + n) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const widthKm = (e - w) * 111.32 * kx;
  const heightKm = (n - s) * 110.57;
  // View: the AOI with one AOI-width of context on each side, aspect-true at this latitude.
  const W = 200;
  const H = 132;
  const spanLon = (e - w) * 2.6;
  const spanLat = (spanLon * kx * H) / W;
  const lon0 = (w + e) / 2 - spanLon / 2;
  const lat1 = midLat + spanLat / 2;
  const x = (lon: number) => ((lon - lon0) / spanLon) * W;
  const y = (lat: number) => ((lat1 - lat) / spanLat) * H;
  const stepDeg = spanLon > 4 ? 1 : spanLon > 1.6 ? 0.5 : 0.25;
  const lons: number[] = [];
  for (let v = Math.ceil(lon0 / stepDeg) * stepDeg; v < lon0 + spanLon; v += stepDeg) lons.push(v);
  const lats: number[] = [];
  for (let v = Math.ceil((lat1 - spanLat) / stepDeg) * stepDeg; v < lat1; v += stepDeg) lats.push(v);
  const ax = x(w);
  const ay = y(n);
  const aw = x(e) - ax;
  const ah = y(s) - ay;
  return (
    <figure className="locator">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Area of interest: ${fmtLat(s)} to ${fmtLat(n)}, ${fmtLon(w)} to ${fmtLon(e)}`}
      >
        <rect x="0" y="0" width={W} height={H} fill="#0E1020" />
        {lons.map((v) => (
          <line key={`x${v}`} x1={x(v)} x2={x(v)} y1="0" y2={H} stroke="rgba(243,245,247,0.14)" strokeWidth="1" />
        ))}
        {lats.map((v) => (
          <line key={`y${v}`} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="rgba(243,245,247,0.14)" strokeWidth="1" />
        ))}
        {lons.slice(0, 4).map((v) => (
          <text key={`tx${v}`} x={x(v) + 3} y={H - 4} className="locator__tick">
            {fmtLon(v)}
          </text>
        ))}
        {lats.slice(-3).map((v) => (
          <text key={`ty${v}`} x="3" y={y(v) - 3} className="locator__tick">
            {fmtLat(v)}
          </text>
        ))}
        <rect x={ax} y={ay} width={aw} height={ah} fill="rgba(61,224,208,0.14)" stroke="#3DE0D0" strokeWidth="2" />
        <path
          d={`M${ax + aw / 2} ${ay + ah / 2 - 7}v14M${ax + aw / 2 - 7} ${ay + ah / 2}h14`}
          stroke="#3DE0D0"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <text x={ax} y={ay - 5} className="locator__aoi">
          AOI
        </text>
      </svg>
      <figcaption className="br-mono">
        <span>
          {fmtLat(midLat)} {fmtLon((w + e) / 2)}
        </span>
        <span>
          {widthKm.toFixed(0)} × {heightKm.toFixed(0)} km frame
        </span>
        {caption ? <span>{caption}</span> : null}
      </figcaption>
    </figure>
  );
}

function ringPath(ring: readonly LL[], x: (lon: number) => number, y: (lat: number) => number): string {
  if (ring.length < 2) return "";
  return `${ring.map((p, i) => `${i ? "L" : "M"}${x(p.lon).toFixed(1)} ${y(p.lat).toFixed(1)}`).join("")}Z`;
}

/** Your region against the case file's outline: hit / missed / extra, each a colour + a pattern + a word. */
export function OverlapDiagram({ mine, reference }: { mine: readonly LL[]; reference: readonly (readonly LL[])[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const all = [...mine, ...reference.flat()];
  if (mine.length < 3 || reference.length === 0 || all.length === 0) return null;
  const W = 260;
  const H = 180;
  const pad = 14;
  const w = Math.min(...all.map((p) => p.lon));
  const e = Math.max(...all.map((p) => p.lon));
  const s = Math.min(...all.map((p) => p.lat));
  const n = Math.max(...all.map((p) => p.lat));
  const kx = Math.cos((((s + n) / 2) * Math.PI) / 180);
  // Fit both shapes, aspect-true.
  const sx = (W - 2 * pad) / Math.max((e - w) * kx, 1e-9);
  const sy = (H - 2 * pad) / Math.max(n - s, 1e-9);
  const k = Math.min(sx, sy);
  const ox = (W - (e - w) * kx * k) / 2;
  const oy = (H - (n - s) * k) / 2;
  const x = (lon: number) => ox + (lon - w) * kx * k;
  const y = (lat: number) => oy + (n - lat) * k;
  const minePath = ringPath(mine, x, y);
  const refPath = reference.map((r) => ringPath(r, x, y)).join("");
  return (
    <figure className="overlap" data-testid="overlap-diagram">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Sketch: your region drawn over the case file's outline. Hit, missed and extra areas are marked."
      >
        <defs>
          <pattern id={`${uid}miss`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="rgba(242,180,65,0.16)" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="#F2B441" strokeWidth="2.5" />
          </pattern>
          <pattern id={`${uid}extra`} width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="rgba(224,72,155,0.16)" />
            <circle cx="4" cy="4" r="1.6" fill="#E66DAF" />
          </pattern>
          <clipPath id={`${uid}ref`}>
            <path d={refPath} />
          </clipPath>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="#0E1020" />
        <path d={refPath} fill={`url(#${uid}miss)`} />
        <path d={minePath} fill={`url(#${uid}extra)`} />
        <g clipPath={`url(#${uid}ref)`}>
          <path d={minePath} fill="#0E1020" />
          <path d={minePath} fill="rgba(61,224,208,0.55)" />
        </g>
        <path d={refPath} fill="none" stroke="#F2B441" strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" />
        <path d={minePath} fill="none" stroke="#3DE0D0" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <figcaption>
        <ul className="overlap__key">
          <li>
            <i className="overlap__sw overlap__sw--hit" aria-hidden="true" />
            <span>
              <strong>Hit</strong> — inside both
            </span>
          </li>
          <li>
            <i className="overlap__sw overlap__sw--miss" aria-hidden="true" />
            <span>
              <strong>Missed</strong> — case file only
            </span>
          </li>
          <li>
            <i className="overlap__sw overlap__sw--extra" aria-hidden="true" />
            <span>
              <strong>Extra</strong> — your region only
            </span>
          </li>
        </ul>
        <p className="br-caption">
          Solid line: your region. Dashed line: the case file's outline. A sketch — the score is counted on the mask.
        </p>
      </figcaption>
    </figure>
  );
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** One or two plain sentences for the next attempt. Says only what precision, recall and overlap support. */
export function coachLines(o: ScoreOutcome): string[] {
  if (o.kind !== "SCORE") return [];
  const { precision: p, recall: r } = o;
  if (o.tier === "PASS") {
    const out = ["Your region lines up with the case file's changed area."];
    if (r < 0.9) out.push(`About ${pct(1 - r)} of the changed area sits outside your outline.`);
    else if (p < 0.9) out.push(`About ${pct(1 - p)} of your region did not change.`);
    return out;
  }
  if (p + r < 0.05)
    return [
      "Your region does not touch the changed area.",
      "Play the passes again and look for ground that keeps moving.",
    ];
  if (p >= 0.75 && r < 0.75)
    return [
      `What you outlined did change — ${pct(p)} of it is inside the case file's area.`,
      `You caught ${pct(r)} of the change. Widen your region to take in the rest.`,
    ];
  if (r >= 0.75 && p < 0.75)
    return [
      `You caught ${pct(r)} of the change.`,
      `But ${pct(1 - p)} of your region did not change. Pull the corners in.`,
    ];
  if (p < 0.4 && r < 0.4)
    return [
      `Only ${pct(p)} of your region changed, and it covers ${pct(r)} of the change.`,
      "Most of the motion is somewhere else. Watch the passes again before you redraw.",
    ];
  return [
    `${pct(p)} of your region changed and you caught ${pct(r)} of the change.`,
    "The edges are off on both sides. Move the corners toward the ground that keeps moving.",
  ];
}

/** Region thumbnail for a journal card. */
export function RegionThumb({ vertices, tone }: { vertices: readonly LL[]; tone: string }) {
  const S = 72;
  const pad = 10;
  if (vertices.length < 3) {
    return (
      <svg className="jthumb" viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
        <rect width={S} height={S} fill="#0E1020" />
        <path
          d={`M${pad} ${S / 2}h${S - 2 * pad}`}
          stroke="rgba(243,245,247,0.28)"
          strokeWidth="2"
          strokeDasharray="4 4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const w = Math.min(...vertices.map((p) => p.lon));
  const e = Math.max(...vertices.map((p) => p.lon));
  const s = Math.min(...vertices.map((p) => p.lat));
  const n = Math.max(...vertices.map((p) => p.lat));
  const kx = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const k = Math.min((S - 2 * pad) / Math.max((e - w) * kx, 1e-9), (S - 2 * pad) / Math.max(n - s, 1e-9));
  const ox = (S - (e - w) * kx * k) / 2;
  const oy = (S - (n - s) * k) / 2;
  const d = ringPath(
    vertices,
    (lon) => ox + (lon - w) * kx * k,
    (lat) => oy + (n - lat) * k,
  );
  const stroke = tone === "pass" ? "#3DE0D0" : tone === "fail" ? "#E66DAF" : "#F2B441";
  return (
    <svg className="jthumb" viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
      <rect width={S} height={S} fill="#0E1020" />
      <path
        d={`M0 ${S / 3}H${S}M0 ${(2 * S) / 3}H${S}M${S / 3} 0V${S}M${(2 * S) / 3} 0V${S}`}
        stroke="rgba(243,245,247,0.1)"
        strokeWidth="1"
      />
      <path d={d} fill="rgba(243,245,247,0.08)" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ journal notes (own storage key) */
const NOTES_KEY = "blindrev.journal.notes.v1";

function readNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getJournalNotes(): Record<string, string> {
  return readNotes();
}

export function dropJournalNote(id: string): void {
  try {
    const all = readNotes();
    delete all[id];
    localStorage.setItem(NOTES_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: nothing to drop */
  }
}

/** One-line note on a journal entry — "explain the evidence". Saved as you type. */
export function JournalNote({ id }: { id: string }) {
  const [value, setValue] = useState(() => readNotes()[id] ?? "");
  const fieldId = useId();
  const save = (v: string) => {
    setValue(v);
    try {
      const all = readNotes();
      if (v.trim()) all[id] = v;
      else delete all[id];
      localStorage.setItem(NOTES_KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable: the note lives for this session only */
    }
  };
  return (
    <div className="jnote">
      <label htmlFor={fieldId} className="br-label">
        Your note
      </label>
      <input
        id={fieldId}
        className="jnote__input"
        type="text"
        maxLength={160}
        value={value}
        placeholder="What does this evidence show?"
        onChange={(ev) => save(ev.target.value)}
        data-testid="journal-note"
      />
    </div>
  );
}
