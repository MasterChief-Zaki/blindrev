import { nudgeVertex } from "@blindrev/core-sim";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Bounds, LonLat, RoiValidation } from "../coreTypes";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { announce } from "../components/LiveRegion";
import { playSound } from "../sound/sound";
import {
  clampToBounds,
  editorSizeForBounds,
  editorToLonLat,
  formatLat,
  formatLon,
  graticuleLines,
  lonLatToEditor,
  niceStep,
  roundDeg,
} from "./mapping";

export interface RoiEditor2DProps {
  bounds: Bounds;
  vertices: LonLat[];
  closed: boolean;
  selectedIndex: number | null;
  validation: RoiValidation | null;
  backdropUrl: string | null;
  overlayUrls?: { url: string; opacity: number }[];
  nudgeDeg: number;
  coarseFactor: number;
  /** Tallest the map may be (any CSS length). Default "68vh". A dialog passes what its viewport leaves free. */
  canvasMaxHeight?: string;
  onChange(vertices: LonLat[], closed: boolean): void;
  onSelect(index: number | null): void;
}

interface Snapshot {
  vertices: LonLat[];
  closed: boolean;
}

const EDITOR_WIDTH = 1000;
const DRAG_THRESHOLD_PX = 4;
const HISTORY_MAX = 100;
const pad2 = (i: number) => String(i + 1).padStart(2, "0");
const where = (p: LonLat) => `${formatLat(p.lat)} ${formatLon(p.lon)}`;
/** Position an axis label at fraction f along x/y, anchoring it inward near the edges so it never clips. */
function edgeAnchor(f: number, axis: "x" | "y"): CSSProperties {
  const pct = `${(f * 100).toFixed(3)}%`;
  const shift = f < 0.12 ? "0%" : f > 0.88 ? "-100%" : "-50%";
  return axis === "x"
    ? { left: pct, transform: `translateX(${shift})` }
    : { top: pct, transform: `translateY(${shift})` };
}

// ---------------------------------------------------------------- coordinate input

function CoordInput({
  value,
  label,
  testId,
  step,
  min,
  max,
  onBegin,
  onCommit,
}: {
  value: number;
  label: string;
  testId: string;
  step: number;
  min: number;
  max: number;
  onBegin(): void;
  onCommit(v: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const begun = useRef(false);
  return (
    <input
      className="br-roi__coord br-mono"
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      aria-label={label}
      data-testid={testId}
      value={draft ?? value.toFixed(4)}
      onFocus={() => {
        begun.current = false;
      }}
      onChange={(e) => {
        const s = e.currentTarget.value;
        setDraft(s);
        const v = Number(s);
        if (s.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) {
          if (!begun.current) {
            begun.current = true;
            onBegin();
          }
          onCommit(v);
        }
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") setDraft(null);
      }}
    />
  );
}

// ---------------------------------------------------------------- editor

export function RoiEditor2D({
  bounds,
  vertices,
  closed,
  selectedIndex,
  validation,
  backdropUrl,
  overlayUrls,
  nudgeDeg,
  coarseFactor,
  canvasMaxHeight = "68vh",
  onChange,
  onSelect,
}: RoiEditor2DProps) {
  const helpId = useId();
  const statusId = useId();
  const hatchId = `br-roi-hatch${useId().replace(/:/g, "")}`;
  const size = useMemo(() => editorSizeForBounds(bounds, EDITOR_WIDTH), [bounds]);
  const { width: W, height: H } = size;
  const [west, south, east, north] = bounds;

  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [unitsPerPx, setUnitsPerPx] = useState(1.6);
  const [labelRoom, setLabelRoom] = useState({ widthPx: 600, heightPx: 500, remPx: 16 });
  const [hover, setHover] = useState<LonLat | null>(null);
  const [cursor, setCursor] = useState<LonLat>(() => ({
    lon: roundDeg((west + east) / 2),
    lat: roundDeg((south + north) / 2),
  }));
  const [focused, setFocused] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [historyLen, setHistoryLen] = useState(0);
  const history = useRef<Snapshot[]>([]);
  const drag = useRef<{
    pointerId: number;
    index: number | null; // null = background press
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const n = vertices.length;
  const sel = selectedIndex !== null && selectedIndex >= 0 && selectedIndex < n ? selectedIndex : null;

  // Keep the keyboard cursor inside new bounds.
  useEffect(() => {
    setCursor((c) => clampToBounds(c, bounds));
  }, [bounds]);
  useEffect(() => {
    if (sel === null) setMoveMode(false);
  }, [sel]);

  // Track rendered scale so hit targets stay ≥ 44 px whatever the canvas size.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const r = svg.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setUnitsPerPx(1 / Math.min(r.width / W, r.height / H));
        const remPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        setLabelRoom({ widthPx: r.width, heightPx: r.height, remPx });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [W, H]);

  // ------------------------------------------------------------ history + commit
  const record = useCallback(() => {
    history.current.push({ vertices: vertices.map((v) => ({ ...v })), closed });
    if (history.current.length > HISTORY_MAX) history.current.shift();
    setHistoryLen(history.current.length);
  }, [vertices, closed]);

  const commit = (next: LonLat[], nextClosed: boolean, withHistory = true) => {
    if (withHistory) record();
    onChange(next, nextClosed && next.length >= 3);
  };

  const undo = () => {
    const prev = history.current.pop();
    setHistoryLen(history.current.length);
    if (!prev) return;
    onChange(prev.vertices, prev.closed);
    if (sel !== null && sel >= prev.vertices.length) onSelect(null);
    announce(`Undone. ${prev.vertices.length} corners${prev.closed ? ", region closed" : ""}.`);
  };

  // ------------------------------------------------------------ actions
  const addVertex = (p: LonLat) => {
    if (closed) {
      announce("The region is closed. Undo or clear it to add corners.");
      return;
    }
    const q = { lon: roundDeg(p.lon), lat: roundDeg(p.lat) };
    commit([...vertices, q], false);
    playSound("press");
    announce(`Corner ${n + 1} added at ${where(q)}.`);
  };
  const closeShape = () => {
    if (closed || n < 3) return;
    commit(vertices, true);
    playSound("confirm");
    announce(`Region closed with ${n} corners.`);
  };
  const moveVertex = (i: number, p: LonLat, withHistory: boolean) => {
    const next = vertices.map((v, k) => (k === i ? { lon: roundDeg(p.lon), lat: roundDeg(p.lat) } : v));
    commit(next, closed, withHistory);
  };
  const deleteVertex = (i: number) => {
    if (i < 0 || i >= n) return;
    const next = vertices.filter((_, k) => k !== i);
    commit(next, closed && next.length >= 3);
    onSelect(next.length === 0 ? null : Math.min(i, next.length - 1));
    announce(`Corner ${i + 1} deleted. ${next.length} corners left.`);
  };
  const clearAll = () => {
    commit([], false);
    onSelect(null);
    setConfirmClear(false);
    announce("Region cleared.");
  };
  const select = (i: number | null) => {
    onSelect(i);
    if (i !== null && vertices[i]) announce(`Corner ${i + 1} selected, ${where(vertices[i])}.`);
  };

  // ------------------------------------------------------------ pointer
  const toLonLat = (clientX: number, clientY: number): LonLat => {
    const svg = svgRef.current;
    let x = 0;
    let y = 0;
    const ctm = svg?.getScreenCTM();
    if (svg && ctm) {
      const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      x = pt.x;
      y = pt.y;
    } else if (svg) {
      const r = svg.getBoundingClientRect();
      x = ((clientX - r.left) / Math.max(1, r.width)) * W;
      y = ((clientY - r.top) / Math.max(1, r.height)) * H;
    }
    const p = clampToBounds(editorToLonLat({ x, y }, bounds, size), bounds);
    return { lon: roundDeg(p.lon), lat: roundDeg(p.lat) };
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const vEl = target.closest("[data-vertex]");
    const index = vEl ? Number(vEl.getAttribute("data-vertex")) : null;
    canvasRef.current?.focus({ preventScroll: true });
    drag.current = { pointerId: e.pointerId, index, startX: e.clientX, startY: e.clientY, moved: false };
    if (index !== null) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic */
      }
    }
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = toLonLat(e.clientX, e.clientY);
    setHover(p);
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || d.index === null) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
    if (!d.moved) {
      d.moved = true;
      record();
      if (sel !== d.index) onSelect(d.index);
    }
    moveVertex(d.index, p, false);
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = toLonLat(e.clientX, e.clientY);
    if (d.index !== null) {
      if (d.moved) {
        announce(`Corner ${d.index + 1} moved to ${where(p)}.`);
        return;
      }
      // Click on a vertex: first vertex closes an open shape, otherwise select.
      if (!closed && d.index === 0 && n >= 3) closeShape();
      else select(sel === d.index ? null : d.index);
      return;
    }
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) >= DRAG_THRESHOLD_PX) return;
    if (moveMode && sel !== null) {
      moveVertex(sel, p, true);
      setMoveMode(false);
      playSound("press");
      announce(`Corner ${sel + 1} moved to ${where(p)}.`);
      return;
    }
    setCursor(p);
    if (!closed) addVertex(p);
    else if (sel !== null) onSelect(null);
  };

  // ------------------------------------------------------------ keyboard
  const lonSpan = east - west;
  const latSpan = north - south;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir =
      e.key === "ArrowUp"
        ? "N"
        : e.key === "ArrowDown"
          ? "S"
          : e.key === "ArrowLeft"
            ? "W"
            : e.key === "ArrowRight"
              ? "E"
              : null;
    if (dir) {
      e.preventDefault();
      if (sel !== null && !moveMode) {
        record();
        const next = nudgeVertex(vertices, sel, dir, e.shiftKey, nudgeDeg, coarseFactor);
        onChange(next, closed);
        const v = next[sel];
        if (v) announce(`Corner ${sel + 1}: ${where(v)}.`);
      } else {
        const k = e.shiftKey ? 5 : 1;
        const dLon = (lonSpan / 50) * k;
        const dLat = (latSpan / 50) * k;
        const c = clampToBounds(
          {
            lon: cursor.lon + (dir === "E" ? dLon : dir === "W" ? -dLon : 0),
            lat: cursor.lat + (dir === "N" ? dLat : dir === "S" ? -dLat : 0),
          },
          bounds,
        );
        const q = { lon: roundDeg(c.lon), lat: roundDeg(c.lat) };
        setCursor(q);
        announce(`Cursor ${where(q)}.`);
      }
      return;
    }
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (moveMode && sel !== null) {
          moveVertex(sel, cursor, true);
          setMoveMode(false);
          announce(`Corner ${sel + 1} moved to ${where(cursor)}.`);
        } else addVertex(cursor);
        break;
      case "c":
      case "C":
        e.preventDefault();
        closeShape();
        break;
      case "Delete":
      case "Backspace":
        if (sel !== null) {
          e.preventDefault();
          deleteVertex(sel);
        }
        break;
      case "[":
      case "]": {
        e.preventDefault();
        if (n === 0) return;
        const next = e.key === "]" ? (sel === null ? 0 : (sel + 1) % n) : sel === null ? n - 1 : (sel - 1 + n) % n;
        select(next);
        break;
      }
      case "Escape":
        if (moveMode) {
          e.preventDefault();
          setMoveMode(false);
          announce("Move cancelled.");
        } else if (sel !== null) {
          e.preventDefault();
          onSelect(null);
          announce("Selection cleared. Arrows move the cursor.");
        }
        break;
      case "z":
      case "Z":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          undo();
        }
        break;
    }
  };

  // ------------------------------------------------------------ geometry for render
  const pts = vertices.map((v) => lonLatToEditor(v, bounds, size));
  const ptsAttr = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const lonStep = niceStep(lonSpan, 5);
  const latStep = niceStep(latSpan, 4);
  const lonLines = graticuleLines(west, east, lonStep);
  const latLines = graticuleLines(south, north, latStep);
  // Thin the HTML axis labels so they never collide (text scales with rem; the map does not).
  const lonLabelPx = 0.75 * labelRoom.remPx * 0.62 * 10 + 16;
  const lonEvery = Math.max(1, Math.ceil(((lonLines.length + 1) * lonLabelPx) / Math.max(1, labelRoom.widthPx)));
  const latLabelPx = 0.75 * labelRoom.remPx * 1.3 + 10;
  const latEvery = Math.max(1, Math.ceil(((latLines.length + 1) * latLabelPx * 1.6) / Math.max(1, labelRoom.heightPx)));
  const dpLon = Math.max(0, Math.min(4, -Math.floor(Math.log10(lonStep) - 1e-9)));
  const dpLat = Math.max(0, Math.min(4, -Math.floor(Math.log10(latStep) - 1e-9)));
  const cur = lonLatToEditor(cursor, bounds, size);
  const hoverPt = hover ? lonLatToEditor(hover, bounds, size) : null;
  const u = unitsPerPx;
  const status: "valid" | "invalid" | "open" | "empty" =
    n === 0 ? "empty" : !closed ? "open" : validation ? (validation.ok ? "valid" : "invalid") : "open";
  const shapeCls = `br-roi__shape br-roi__shape--${status === "empty" ? "open" : status}`;
  const mode = moveMode ? "Move here" : closed ? "Region closed" : "Add corners";

  const canvasStyle = {
    aspectRatio: `${W} / ${H}`,
    maxWidth: `min(100%, calc(68vh * ${(W / H).toFixed(4)}))`,
  } as CSSProperties;

  return (
    <section
      className="br-roi"
      data-testid="roi-editor"
      aria-label="Region of Interest editor"
      data-closed={closed}
      data-status={status}
    >
      <div className="br-roi__toolbar" role="toolbar" aria-label="Region tools">
        <p className="br-roi__mode">
          <span className="br-label">Mode</span>
          <span className="br-mono" data-testid="roi-mode">
            {mode}
          </span>
        </p>
        <div className="br-roi__tools">
          <Button
            variant="secondary"
            icon="check"
            onClick={closeShape}
            disabled={closed || n < 3}
            data-testid="roi-close"
            sound={false}
          >
            Close region
          </Button>
          <Button
            variant={moveMode ? "primary" : "secondary"}
            icon="move"
            onClick={() => {
              setMoveMode((m) => !m);
              announce(
                moveMode
                  ? "Move cancelled."
                  : `Move here: click the map, or press Enter, to move corner ${(sel ?? 0) + 1}.`,
              );
            }}
            disabled={sel === null}
            aria-pressed={moveMode}
            data-testid="roi-move"
          >
            Move here
          </Button>
          <Button variant="ghost" icon="undo" onClick={undo} disabled={historyLen === 0} data-testid="roi-undo">
            Undo
          </Button>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => setConfirmClear(true)}
            disabled={n === 0}
            data-testid="roi-clear"
          >
            Clear
          </Button>
        </div>
        {confirmClear ? (
          <div
            className="br-roi__confirm"
            role="alertdialog"
            aria-label="Clear the region?"
            data-testid="roi-clear-dialog"
          >
            <Icon name="alert" size={16} />
            <span>Clear all {n} corners? You can undo this.</span>
            <Button variant="danger" size="md" onClick={clearAll} data-testid="roi-clear-confirm" autoFocus>
              Clear region
            </Button>
            <Button variant="secondary" onClick={() => setConfirmClear(false)} data-testid="roi-clear-cancel">
              Keep
            </Button>
          </div>
        ) : null}
      </div>

      <div
        className="br-roi__main"
        style={{ "--br-roi-cap": `calc(${canvasMaxHeight} * ${(W / H).toFixed(4)})` } as CSSProperties}
      >
        <div className="br-roi__stage">
          <div
            ref={canvasRef}
            className={`br-roi__canvas${focused ? " is-focused" : ""}${moveMode ? " is-moving" : ""}`}
            style={canvasStyle}
            tabIndex={0}
            role="application"
            aria-roledescription="map editor"
            aria-label={`Region map, ${n} corners${closed ? ", closed" : ""}. Cursor ${where(cursor)}.`}
            aria-describedby={`${helpId} ${statusId}`}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            data-testid="roi-canvas"
          >
            <svg
              ref={svgRef}
              className="br-roi__svg"
              viewBox={`0 0 ${W.toFixed(3)} ${H.toFixed(3)}`}
              preserveAspectRatio="xMidYMid meet"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onPointerLeave={() => setHover(null)}
              aria-hidden="true"
            >
              <defs>
                <pattern
                  id={hatchId}
                  width={12 * u}
                  height={12 * u}
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width={12 * u} height={12 * u} fill="var(--color-ink)" />
                  <line x1="0" y1="0" x2="0" y2={12 * u} stroke="var(--color-graphite)" strokeWidth={6 * u} />
                </pattern>
              </defs>
              <rect x="0" y="0" width={W} height={H} fill={backdropUrl ? "var(--color-ink)" : `url(#${hatchId})`} />
              {backdropUrl ? (
                <image href={backdropUrl} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />
              ) : null}
              {overlayUrls?.map((o) => (
                <image
                  key={o.url}
                  href={o.url}
                  x="0"
                  y="0"
                  width={W}
                  height={H}
                  preserveAspectRatio="none"
                  opacity={o.opacity}
                />
              ))}

              <g className="br-roi__graticule">
                {lonLines.map((lon) => {
                  const x = lonLatToEditor({ lon, lat: north }, bounds, size).x;
                  return <line key={`x${lon}`} x1={x} y1={0} x2={x} y2={H} strokeWidth={u} />;
                })}
                {latLines.map((lat) => {
                  const y = lonLatToEditor({ lon: west, lat }, bounds, size).y;
                  return <line key={`y${lat}`} x1={0} y1={y} x2={W} y2={y} strokeWidth={u} />;
                })}
              </g>

              {n > 0 && closed ? (
                <polygon
                  className={shapeCls}
                  points={ptsAttr}
                  strokeWidth={2.5 * u}
                  strokeDasharray={status === "invalid" ? `${10 * u} ${6 * u}` : undefined}
                />
              ) : null}
              {n > 0 && !closed ? (
                <polyline
                  className={shapeCls}
                  points={ptsAttr}
                  strokeWidth={2.5 * u}
                  strokeDasharray={`${8 * u} ${6 * u}`}
                />
              ) : null}
              {!closed && n > 0 && hoverPt && !moveMode ? (
                <line
                  className="br-roi__rubber"
                  x1={pts[n - 1]!.x}
                  y1={pts[n - 1]!.y}
                  x2={hoverPt.x}
                  y2={hoverPt.y}
                  strokeWidth={1.5 * u}
                  strokeDasharray={`${4 * u} ${5 * u}`}
                />
              ) : null}

              {/* keyboard cursor */}
              <g className={`br-roi__cursor${focused ? " is-active" : ""}`} transform={`translate(${cur.x} ${cur.y})`}>
                <circle r={9 * u} strokeWidth={2 * u} fill="none" />
                <path
                  d={`M${-18 * u} 0H${-12 * u}M${12 * u} 0H${18 * u}M0 ${-18 * u}V${-12 * u}M0 ${12 * u}V${18 * u}`}
                  strokeWidth={2 * u}
                />
              </g>

              {pts.map((p, i) => {
                const isSel = i === sel;
                const isFirst = i === 0 && !closed && n >= 3;
                const r = (isSel ? 8 : 6.5) * u;
                return (
                  <g
                    key={i}
                    className={`br-roi__vertex${isSel ? " is-selected" : ""}${isFirst ? " is-closer" : ""}`}
                    transform={`translate(${p.x} ${p.y})`}
                    data-vertex={i}
                    data-testid={`roi-vertex-${i}`}
                  >
                    <circle className="br-roi__hit" r={22 * u} />
                    {isFirst ? <circle className="br-roi__closer-ring" r={14 * u} strokeWidth={2 * u} /> : null}
                    {isSel ? <circle className="br-roi__sel-ring" r={13 * u} strokeWidth={2 * u} /> : null}
                    <rect
                      className="br-roi__mark"
                      x={-r}
                      y={-r}
                      width={2 * r}
                      height={2 * r}
                      transform="rotate(45)"
                      strokeWidth={2 * u}
                    />
                  </g>
                );
              })}
            </svg>

            {/* HTML overlays: rem-sized text on scrims, positioned in % of the canvas */}
            <div className="br-roi__labels" aria-hidden="true">
              {lonLines
                .filter((_, k) => k % lonEvery === 0)
                .map((lon) => (
                  <span
                    key={`lx${lon}`}
                    className="br-roi__tick br-roi__tick--lon br-mono"
                    style={edgeAnchor((lon - west) / lonSpan, "x")}
                  >
                    {formatLon(lon, dpLon)}
                  </span>
                ))}
              {latLines
                .filter((_, k) => k % latEvery === 0)
                .map((lat) => (
                  <span
                    key={`ly${lat}`}
                    className="br-roi__tick br-roi__tick--lat br-mono"
                    style={edgeAnchor((north - lat) / latSpan, "y")}
                  >
                    {formatLat(lat, dpLat)}
                  </span>
                ))}
              {pts.map((p, i) => (
                <span
                  key={`vl${i}`}
                  className={`br-roi__vlabel br-mono${i === sel ? " is-selected" : ""}`}
                  style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
                >
                  {pad2(i)}
                </span>
              ))}
            </div>
          </div>
          <p className="br-roi__readout br-mono" data-testid="roi-readout">
            <span>
              <span className="br-roi__readout-key">CURSOR</span> {where(cursor)}
            </span>
            <span>
              <span className="br-roi__readout-key">POINTER</span> {hover ? where(hover) : "—"}
            </span>
          </p>
          <p id={helpId} className="br-roi__help br-caption">
            Click to add corners. Click corner 01 or Close region to finish. Drag a corner to move it, or select it and
            use Move here. Keyboard: arrows move the cursor (Shift = faster), Enter adds a corner, C closes, [ and ]
            select corners, arrows nudge the selected corner by {nudgeDeg}° (Shift ×{coarseFactor}), Delete removes, Esc
            deselects, Ctrl+Z undoes.
          </p>
        </div>

        <aside className="br-roi__side" aria-label="Region details">
          <div className={`br-roi__status br-roi__status--${status}`} id={statusId} data-testid="roi-status">
            <p className="br-roi__verdict">
              <Icon name={status === "valid" ? "check" : status === "invalid" ? "alert" : "target"} size={16} />
              <span className="br-label">
                {status === "valid"
                  ? "Valid region"
                  : status === "invalid"
                    ? "Needs fixing"
                    : status === "empty"
                      ? "No corners yet"
                      : n < 3
                        ? `Add ${3 - n} more corner${3 - n === 1 ? "" : "s"}`
                        : "Not closed yet. Close it to check"}
              </span>
            </p>
            <p className="br-roi__area">
              <span className="br-label">Area</span>
              <span className="br-mono" data-testid="roi-area">
                {validation && n >= 3 ? `${validation.areaKm2.toFixed(1)} km²` : "NOT MEASURED"}
              </span>
            </p>
            {validation && validation.errors.length > 0 ? (
              <ul className="br-roi__errors" data-testid="roi-errors">
                {validation.errors.map((err) => (
                  <li key={err.code + err.message}>
                    <Icon name="alert" size={16} />
                    <span>{err.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="br-roi__tablewrap">
            <table className="br-roi__table" data-testid="roi-points-table">
              <caption className="br-label">Corners ({n})</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Lon °</th>
                  <th scope="col">Lat °</th>
                  <th scope="col">
                    <span className="br-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {vertices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="br-roi__empty">
                      No corners yet. Click the map or press Enter on it.
                    </td>
                  </tr>
                ) : (
                  vertices.map((v, i) => (
                    <tr key={i} className={i === sel ? "is-selected" : undefined}>
                      <th scope="row" className="br-mono">
                        {pad2(i)}
                      </th>
                      <td>
                        <CoordInput
                          value={v.lon}
                          label={`Corner ${i + 1} longitude`}
                          testId={`roi-lon-${i}`}
                          step={nudgeDeg}
                          min={-180}
                          max={180}
                          onBegin={record}
                          onCommit={(lon) => {
                            const next = vertices.map((w, k) => (k === i ? { lon, lat: w.lat } : w));
                            onChange(next, closed);
                          }}
                        />
                      </td>
                      <td>
                        <CoordInput
                          value={v.lat}
                          label={`Corner ${i + 1} latitude`}
                          testId={`roi-lat-${i}`}
                          step={nudgeDeg}
                          min={-89.9}
                          max={89.9}
                          onBegin={record}
                          onCommit={(lat) => {
                            const next = vertices.map((w, k) => (k === i ? { lon: w.lon, lat } : w));
                            onChange(next, closed);
                          }}
                        />
                      </td>
                      <td className="br-roi__rowactions">
                        <button
                          type="button"
                          className={`br-roi__iconbtn${i === sel ? " is-on" : ""}`}
                          aria-pressed={i === sel}
                          aria-label={`Select corner ${i + 1}`}
                          title="Select"
                          onClick={() => select(i === sel ? null : i)}
                          data-testid={`roi-select-${i}`}
                        >
                          <Icon name="target" size={16} />
                        </button>
                        <button
                          type="button"
                          className="br-roi__iconbtn br-roi__iconbtn--danger"
                          aria-label={`Delete corner ${i + 1}`}
                          title="Delete"
                          onClick={() => deleteVertex(i)}
                          data-testid={`roi-delete-${i}`}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Button
            variant="secondary"
            icon="plus"
            onClick={() => addVertex(cursor)}
            disabled={closed}
            data-testid="roi-add"
            className="br-roi__addbtn"
          >
            Add corner at cursor
          </Button>
        </aside>
      </div>
    </section>
  );
}
