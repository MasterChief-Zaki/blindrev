import { daysBetween, pointInRings } from "@blindrev/core-sim";
import {
  Badge,
  Button,
  Icon,
  Legend,
  Panel,
  ReturnButton,
  Slider,
  Stat,
  Tabs,
  TemporalTimeline,
  Toggle,
  type ToolDef,
  ToolRail,
} from "@blindrev/ui-hud";
import { useEffect, useRef, useState } from "react";
import { fetchF32, fetchMask, loadPrefabs } from "../data/loaders";
import {
  anomalyUnlocked,
  clearAnomalies,
  fmtDate,
  getGlobe,
  getMission,
  runAnomalyDetector,
  setRadarVision,
  handleMapKey,
  pairStatus,
  roiActions,
  setPair,
  stepById,
  validateMission,
  validateStatus,
  watchActions,
} from "../mission/controller";
import { env } from "../env";
import { navigate } from "../scene/navigation";
import { announce } from "@blindrev/ui-hud";
import { type LayerKey, useApp, useReducedMotion } from "../store";
import type { MaskGrid, TemporalStep } from "../types";

type Stage = "watch" | "pair" | "mark" | "validate" | "done";

function useStage(): Stage {
  const m = useApp((s) => s.mission);
  const p = pairStatus();
  if (m.outcome) return "done";
  if (!m.watched && !m.pair.a && !m.pair.b && m.vertices.length === 0) return "watch";
  if (!p.ok) return "pair";
  if (!m.closed || !m.validation?.ok) return "mark";
  return "validate";
}

const NEXT_STEP: Record<Stage, string> = {
  watch: "Press Play and watch the ground between passes.",
  pair: "Choose two dates (A and B) at least 24 days apart on the timeline.",
  mark: "Outline the area that changed: press Mark on globe, then click its corners.",
  validate: "Your region is ready. Validate it against the case file.",
  done: "Review the verdict, then save it to your Case Journal.",
};

export function MissionScreen() {
  const mission = getMission();
  const m = useApp((s) => s.mission);
  const globeStatus = useApp((s) => s.globeStatus);
  const globeMode = useApp((s) => s.globeMode);
  const globeFallback = useApp((s) => s.globeFallbackReason);
  const stale = useApp((s) => s.tleStale);
  const set = useApp((s) => s.set);
  const rm = useReducedMotion();
  const step = mission.steps[m.index] ?? mission.steps[0];
  const stage = useStage();
  const prefabs = loadPrefabs();
  const vs = validateStatus();
  const panels = useApp((s) => s.settings.panels);
  const wide = typeof innerWidth === "number" ? innerWidth >= 1600 : true;
  const leftOpen = panels?.left ?? wide;
  const rightOpen = panels?.right ?? wide;
  const togglePanel = (k: "left" | "right") =>
    useApp
      .getState()
      .setSettings({ panels: { left: leftOpen, right: rightOpen, [k]: k === "left" ? !leftOpen : !rightOpen } });

  if (!step) return null;
  return (
    <div
      className={`mission${leftOpen ? "" : " mission--left-closed"}${rightOpen ? "" : " mission--right-closed"}`}
      data-testid="mission"
    >
      {/* Map focus target for keyboard ROI editing: arrows nudge the selected corner. */}
      <div
        className="mission__mapFocus"
        tabIndex={0}
        role="application"
        aria-label="Mission map. With a corner selected, arrow keys move it by 0.001 degrees, Shift for 0.01. Brackets select the next corner."
        onKeyDown={(e) => {
          if (handleMapKey(e)) e.preventDefault();
        }}
        data-testid="map-focus"
      />
      <header className="mission__top">
        <div className="mission__id">
          <ReturnButton label="Return to command board" onClick={() => void navigate("hub")} />
          <div className="mission__idText">
            <h1 className="mission__title">{mission.title}</h1>
            <span className="br-mono mission__stepLine" data-testid="step-readout">
              {mission.caseId} · <b>{fmtDate(step.date)}</b> · {step.platform} {step.instrument}
              {step.isAvailable ? "" : " · "}
              {step.isAvailable ? null : <span className="is-alert">No acquisition</span>}
            </span>
          </div>
        </div>
        <ToolRailHud />
        <div className="mission__topRight">
          <div className="mission__topActions">
            <Button
              variant="ghost"
              icon="journal"
              onClick={() => useApp.setState({ overlay: "journal", overlayReturn: null })}
              data-testid="mission-journal"
            >
              Journal
            </Button>
            <Button
              variant="ghost"
              icon="settings"
              onClick={() => useApp.setState({ overlay: "settings", overlayReturn: null })}
              data-testid="mission-settings"
            >
              Settings
            </Button>
          </div>
          <div className="badge-row mission__badges">
            {mission.labels.map((l) => (
              <Badge key={l} kind={l} />
            ))}
            {globeStatus?.offline && <Badge kind="OFFLINE" detail="Bundled imagery" />}
            {globeStatus?.terrain === "ELLIPSOID" &&
              (env.ionToken && !env.offline ? (
                <Badge
                  kind="OFFLINE"
                  detail={`Ellipsoid terrain — World Terrain failed${globeStatus.message ? `: ${globeStatus.message}` : ""}`}
                />
              ) : (
                <Badge kind="INFO" detail="Ellipsoid terrain — no ion token" />
              ))}
            {globeMode === "stub" && (
              <Badge kind="TEST_FIXTURE" detail={globeFallback ? "2D map fallback" : "2D fixture map"} />
            )}
            {globeStatus?.contextLost && <Badge kind="ALERT" detail="Graphics reset. Recovering the globe…" />}
            {stale && <Badge kind="STALE_EPHEMERIS" />}
          </div>
        </div>
      </header>

      {!leftOpen && (
        <div className="mission__leftMini">
          <button
            type="button"
            className="panel-chev"
            aria-expanded={false}
            aria-controls="mission-left"
            onClick={() => togglePanel("left")}
            data-testid="toggle-left"
          >
            <span aria-hidden="true">▸</span> Objective
          </button>
          <p className="next-step" data-testid="next-step-mini">
            <Icon name="target" size={16} /> <span>{NEXT_STEP[stage]}</span>
          </p>
          <div className="roi-bar__actions">
            <Button
              variant={m.drawMode ? "primary" : "secondary"}
              icon="target"
              aria-pressed={m.drawMode}
              onClick={() => roiActions.toggleDraw()}
              data-testid="mark-on-globe"
            >
              {m.drawMode ? "Marking…" : "Mark"}
            </Button>
            <Button
              variant="secondary"
              icon="map"
              onClick={() => set({ overlay: "roi-editor" })}
              data-testid="open-2d-editor"
            >
              2D editor
            </Button>
          </div>
          <ValidateRow vs={vs} />
        </div>
      )}
      {leftOpen && (
        <aside className="mission__left" id="mission-left">
          <button
            type="button"
            className="panel-chev panel-chev--in"
            aria-expanded={true}
            aria-controls="mission-left"
            onClick={() => togglePanel("left")}
            data-testid="toggle-left-close"
          >
            <span aria-hidden="true">◂</span> Hide
          </button>
          <Panel chamfer tone="scrim" kicker="Objective" title={mission.briefing.question} as="section">
            <ol className="checklist" aria-label="Investigation steps">
              <CheckItem
                n={1}
                label="Watch"
                done={stage !== "watch"}
                active={stage === "watch"}
                detail="Play the passes. Look for ground that keeps changing."
              />
              <CheckItem
                n={2}
                label="Pick two dates"
                done={pairStatus().ok}
                active={stage === "pair"}
                detail={
                  pairStatus().ok
                    ? `${fmtDate(stepById(m.pair.a)?.date ?? "")} → ${fmtDate(stepById(m.pair.b)?.date ?? "")}`
                    : `A and B, ≥ ${prefabs.constants.scoring.dtMinDays} days apart.`
                }
              />
              <CheckItem
                n={3}
                label="Mark"
                done={!!m.closed && !!m.validation?.ok}
                active={stage === "mark"}
                detail={
                  m.vertices.length
                    ? `${m.vertices.length} corners${m.validation ? ` · ${m.validation.areaKm2.toFixed(1)} km²` : ""}`
                    : "Outline the area that changed."
                }
              />
              <CheckItem
                n={4}
                label="Validate"
                done={!!m.outcome}
                active={stage === "validate"}
                detail="Score your region against the case file."
              />
            </ol>
            <p className="next-step" data-testid="next-step">
              <Icon name="target" size={16} /> <span>{NEXT_STEP[stage]}</span>
            </p>
            {stage === "watch" && (
              <Button variant="primary" icon="play" onClick={() => watchActions.play()}>
                {rm ? "Step forward" : "Play the passes"}
              </Button>
            )}
            {stage === "pair" && <PairSuggest />}
          </Panel>
          <RoiToolbar />
          <ValidateRow vs={vs} />
        </aside>
      )}

      {!rightOpen && (
        <button
          type="button"
          className="panel-chev mission__rightMini"
          aria-expanded={false}
          aria-controls="mission-right"
          onClick={() => togglePanel("right")}
          data-testid="toggle-right"
        >
          Layers &amp; data <span aria-hidden="true">◂</span>
        </button>
      )}
      {rightOpen && (
        <aside className="mission__right" id="mission-right">
          <button
            type="button"
            className="panel-chev panel-chev--in panel-chev--right"
            aria-expanded={true}
            aria-controls="mission-right"
            onClick={() => togglePanel("right")}
            data-testid="toggle-right-close"
          >
            Hide <span aria-hidden="true">▸</span>
          </button>
          <Panel tone="scrim" as="section">
            <Tabs
              tabs={[
                { id: "layers", label: "Layers" },
                { id: "provenance", label: "Provenance" },
                { id: "diagnostics", label: "Diagnostics" },
                ...(m.anomalies ? [{ id: "anomalies", label: `Anomalies (${m.anomalies.length})` }] : []),
              ]}
              value={m.rightTab}
              onChange={(id) => useApp.getState().setMission({ rightTab: id as typeof m.rightTab })}
            />
            <div className="tabpanel">
              {m.rightTab === "layers" && <LayersTab />}
              {m.rightTab === "provenance" && <ProvenanceTab step={step} />}
              {m.rightTab === "diagnostics" && <DiagnosticsTab step={step} />}
              {m.rightTab === "anomalies" && <AnomaliesTab />}
            </div>
          </Panel>
        </aside>
      )}

      {m.noAcquisition && (
        <div
          className={`state-card${m.noAcquisition.skipped ? " state-card--chip" : ""}`}
          role="status"
          data-testid="no-acquisition"
        >
          <Icon name="alert" size={24} />
          <div>
            <strong>No acquisition</strong>
            <span className="br-mono">{fmtDate(m.noAcquisition.date)}</span>
            {!m.noAcquisition.skipped && (
              <p className="br-caption">
                The satellite did not image this area on this pass. Nothing is shown — dates are never filled in.
              </p>
            )}
          </div>
        </div>
      )}

      <MapHud step={step} />
      <ProbeChip step={step} />

      <footer className="mission__bottom">
        <MapNav />
        <TemporalTimeline
          steps={mission.steps}
          index={m.index}
          state={m.watchState}
          pair={m.pair}
          onScrubStart={() => watchActions.scrubStart()}
          onScrubTo={(i) => watchActions.scrubTo(i)}
          onScrubEnd={() => watchActions.scrubEnd()}
          onPlay={() => watchActions.play()}
          onPause={() => watchActions.pause()}
          onStep={(d) => watchActions.step(d)}
          onPairChange={(p) => setPair(p)}
          reducedMotion={rm}
          dtMinDays={prefabs.constants.scoring.dtMinDays}
        />
      </footer>
      <button type="button" className="br-visually-hidden" onClick={() => set({ overlay: "briefing" })}>
        Reopen the briefing
      </button>
    </div>
  );
}

/** On-map HUD: current date burned in next to the map, a hint for each marking state, camera keys, reset view. */
function MapHud({ step }: { step: TemporalStep }) {
  return (
    <div className="maphud" data-testid="map-hud">
      <p className={`maphud__date${step.isAvailable ? "" : " is-none"}`} data-testid="map-date">
        <span className="br-mono maphud__dateValue">{fmtDate(step.date)}</span>
        {step.isAvailable ? (
          <span className="br-mono maphud__src">
            {step.platform} {step.instrument}
          </span>
        ) : (
          <span className="br-mono is-alert">
            <Icon name="alert" size={16} /> No acquisition
          </span>
        )}
      </p>
    </div>
  );
}

/** Strip just above the timeline: a hint for each marking state (left), camera keys and reset view (right). */
function MapNav() {
  const m = useApp((s) => s.mission);
  const hint = !m.drawMode
    ? null
    : m.closed
      ? "Region closed. Check it, then validate."
      : m.vertices.length === 0
        ? "Click the map to place the first corner."
        : m.vertices.length < 3
          ? "Keep clicking to add corners. Backspace removes the last one."
          : "Click the first corner or press Enter to close the region. Esc stops marking.";
  // The marking keys (Esc / Enter / Backspace) must work after a click on the globe, not only while the
  // hidden map-focus target holds keyboard focus (found by driving the real pointer path).
  useEffect(() => {
    if (!m.drawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter" && e.key !== "Backspace") return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable], [role=dialog], [data-testid=map-focus]")) return;
      if (e.key === "Enter" && t?.closest("button, a, [role=button], [role=tab]")) return;
      if (handleMapKey(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m.drawMode]);
  return (
    <div className="mapnav" data-testid="map-nav">
      <div className="maphud__nav">
        <p className="br-mono maphud__keys">
          <span>
            <b>WASD</b> move
          </span>
          <span>
            <b>Z X</b> zoom
          </span>
          <span>
            <b>Q E</b> turn
          </span>
          <span>
            <b>R F</b> tilt
          </span>
        </p>
        <button type="button" className="maphud__btn" onClick={() => getGlobe()?.flyTo("aoi")} data-testid="reset-view">
          <Icon name="target" size={16} /> Reset view
        </button>
      </div>
      {hint && (
        <p className="maphud__hint" role="status" data-testid="draw-hint">
          <span>
            <Icon name="target" size={16} /> {hint}
          </span>
        </p>
      )}
    </div>
  );
}

/** Cursor probe: lon/lat and the SIMULATED displacement value next to the pointer while it is over the map. */
function ProbeChip({ step }: { step: TemporalStep }) {
  const mission = getMission();
  const p = useApp((s) => s.mission.pointer);
  const ref = useRef<HTMLDivElement>(null);
  const [onMap, setOnMap] = useState(false);
  const [qa, setQa] = useState<MaskGrid | null>(null);
  const [f32, setF32] = useState<Float32Array | null>(null);
  const qaAsset = step.qaMaskId ? mission.masks[step.qaMaskId] : undefined;
  useEffect(() => {
    let live = true;
    setQa(null);
    setF32(null);
    if (qaAsset) {
      fetchMask(qaAsset).then(
        (g) => live && setQa(g),
        () => {},
      );
      if (step.isAvailable && step.tileUrlTemplate)
        fetchF32(step.tileUrlTemplate.replace(/\.png$/i, ".f32"), qaAsset.width * qaAsset.height).then(
          (a) => live && setF32(a),
          () => {},
        );
    }
    return () => {
      live = false;
    };
  }, [step, qaAsset]);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const over = e.target instanceof HTMLCanvasElement;
      setOnMap(over);
      const el = ref.current;
      if (el && over) {
        const x = Math.min(e.clientX + 18, innerWidth - 230);
        const y = Math.min(e.clientY + 20, innerHeight - 64);
        el.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
  let value = "—";
  if (!step.isAvailable) value = "No acquisition";
  else if (p && qa) {
    const q = maskValueAt(qa, p.lon, p.lat);
    if (q === null) value = "—";
    else if (!q) value = "masked (low coherence)";
    else if (f32) {
      const [w, s, e, n] = qa.bounds;
      const col = Math.min(qa.width - 1, Math.floor(((p.lon - w) / (e - w)) * qa.width));
      const row = Math.min(qa.height - 1, Math.floor(((n - p.lat) / (n - s)) * qa.height));
      const v = f32[row * qa.width + col];
      if (v !== undefined && Number.isFinite(v) && v !== step.noDataValue)
        value = `${v.toFixed(1)} ${step.displacement?.unit ?? ""} · SIMULATED`;
    }
  }
  return (
    <div ref={ref} className="probe-chip br-mono" hidden={!onMap || !p} aria-hidden="true" data-testid="probe-chip">
      <span>{p ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : ""}</span>
      <span className="probe-chip__val">{value}</span>
    </div>
  );
}

/** Investigator tools (§10) — named, unlocked progressively; locked tools say when they unlock. */
function ToolRailHud() {
  const m = useApp((s) => s.mission);
  const journal = useApp((s) => s.journal);
  const set = useApp((s) => s.set);
  const mission = getMission();
  const totalAvail = mission.steps.filter((s) => s.isAvailable).length;
  const seen = m.viewed.length;
  const anomalyOpen = anomalyUnlocked();
  const connectorOpen = journal.length > 0 || !!m.outcome;
  const radarOn = m.contextKind === "radar";
  const tools: ToolDef[] = [
    { id: "timeLens", label: "Time Lens", icon: "timeLens", status: "available" },
    { id: "radar", label: "Radar Vision", icon: "waves", status: radarOn ? "active" : "available" },
    {
      id: "anomaly",
      label: "Anomaly Detector",
      icon: "target",
      status: !anomalyOpen ? "locked" : m.anomalies ? "active" : "available",
      reason: `${seen}/${totalAvail} dates seen`,
    },
    {
      id: "connector",
      label: "Evidence Connector",
      icon: "journal",
      status: connectorOpen ? "available" : "locked",
      reason: "After first verdict",
    },
    { id: "frequency", label: "Frequency Switch", icon: "comms", status: "locked", reason: "Later case" },
    { id: "terrain", label: "Terrain Scanner", icon: "scanner", status: "locked", reason: "Later case" },
  ];
  const onSelect = (id: string) => {
    const t = tools.find((x) => x.id === id);
    if (!t) return;
    if (t.status === "locked") {
      announce(`${t.label} is locked. ${t.reason ?? ""}`);
      return;
    }
    if (id === "timeLens") document.querySelector<HTMLElement>("[data-testid=timeline] button")?.focus();
    else if (id === "radar") setRadarVision(!radarOn);
    else if (id === "anomaly") {
      if (m.anomalies && m.anomalyStepId === mission.steps[m.index]?.stepId) clearAnomalies();
      else void runAnomalyDetector().then(() => useApp.getState().setMission({ rightTab: "anomalies" }));
    } else if (id === "connector") set({ overlay: "journal", overlayReturn: null });
  };
  return (
    <div className="toolrail" data-testid="toolrail">
      <ToolRail tools={tools} onSelect={onSelect} label="Investigator tools" orientation="horizontal" />
    </div>
  );
}

function AnomaliesTab() {
  const m = useApp((s) => s.mission);
  const mission = getMission();
  const st = stepById(m.anomalyStepId);
  return (
    <div className="anoms" data-testid="anomalies">
      <p className="br-caption">{m.anomalyNote}</p>
      <p className="br-caption">
        <Badge kind="SIMULATED" /> Flags come from the simulated displacement grid{st ? ` for ${fmtDate(st.date)}` : ""}
        .
      </p>
      <ol className="anoms__list">
        {(m.anomalies ?? []).map((a) => (
          <li key={a.id}>
            <strong className="br-mono">{a.label}</strong>
            <span className="br-mono">
              {a.centre.lat.toFixed(4)}, {a.centre.lon.toFixed(4)}
            </span>
            <span className="br-mono">
              peak {a.peak.toFixed(1)} {a.unit} · {a.areaKm2.toFixed(1)} km²
            </span>
          </li>
        ))}
      </ol>
      <p className="br-caption">
        A flag is not proof. Compare dates and check the QA mask before you decide whether any of these is your
        evidence.
      </p>
      <Button variant="ghost" onClick={() => clearAnomalies()}>
        Clear flags
      </Button>
      {mission.steps[m.index]?.stepId !== m.anomalyStepId && (
        <Button variant="secondary" icon="scanner" onClick={() => void runAnomalyDetector()}>
          Scan this date instead
        </Button>
      )}
    </div>
  );
}

function ValidateRow({ vs }: { vs: { ok: boolean; reason: string | null } }) {
  const scoring = useApp((s) => s.mission.scoring);
  return (
    <div className="validate-row">
      <Button
        variant="primary"
        size="lg"
        icon="check"
        disabled={!vs.ok || scoring}
        aria-describedby="validate-reason"
        onClick={() => void validateMission()}
        data-testid="validate"
      >
        {scoring ? "Checking…" : "Validate"}
      </Button>
      <p id="validate-reason" className="br-caption validate-reason">
        {vs.ok ? "Ready. Scoring compares your region with the case file." : vs.reason}
      </p>
    </div>
  );
}

function CheckItem({
  n,
  label,
  done,
  active,
  detail,
}: {
  n: number;
  label: string;
  done: boolean;
  active: boolean;
  detail: string;
}) {
  return (
    <li
      className={`checklist__item${done ? " is-done" : ""}${active ? " is-active" : ""}`}
      aria-current={active ? "step" : undefined}
    >
      <span className="checklist__mark" aria-hidden="true">
        {done ? <Icon name="check" size={16} /> : n}
      </span>
      <span className="checklist__text">
        <strong>
          {label}
          <span className="br-visually-hidden">{done ? " — done" : active ? " — current step" : " — to do"}</span>
        </strong>
        <span className="br-caption">{detail}</span>
      </span>
    </li>
  );
}

/** Suggest a sensible default pair (first and last available steps) — one click to proceed. */
function PairSuggest() {
  const mission = getMission();
  const avail = mission.steps.filter((s) => s.isAvailable);
  const first = avail[0];
  const last = avail[avail.length - 1];
  if (!first || !last || first === last) return null;
  return (
    <Button variant="secondary" icon="timeLens" onClick={() => setPair({ a: first.stepId, b: last.stepId })}>
      Use first and last pass
    </Button>
  );
}

function RoiToolbar() {
  const m = useApp((s) => s.mission);
  const set = useApp((s) => s.set);
  const val = m.validation;
  const errors = m.closed ? (val?.errors ?? []) : (val?.errors ?? []).filter((e) => e.code !== "TOO_FEW_VERTICES");
  return (
    <Panel tone="scrim" kicker="Region of interest" as="section">
      <div className="roi-bar" data-testid="roi-toolbar">
        <div className="roi-bar__actions">
          <Button
            variant={m.drawMode ? "primary" : "secondary"}
            icon="target"
            aria-pressed={m.drawMode}
            onClick={() => roiActions.toggleDraw()}
            data-testid="mark-on-globe"
          >
            {m.drawMode ? "Marking… (Esc)" : "Mark on globe"}
          </Button>
          <Button
            variant="secondary"
            icon="map"
            onClick={() => set({ overlay: "roi-editor" })}
            data-testid="open-2d-editor"
          >
            2D editor
          </Button>
        </div>
        <div className="roi-bar__stats">
          <Stat label="Corners" value={String(m.vertices.length)} mono />
          <Stat label="Area" value={val ? val.areaKm2.toFixed(1) : "—"} unit="km²" mono />
          <Stat label="State" value={m.closed ? (val?.ok ? "Valid" : "Fix") : m.vertices.length ? "Open" : "Empty"} />
        </div>
        {m.drawMode && !m.closed && (
          <p className="br-caption roi-bar__hint">
            Click to add corners. Click the first corner (or press Enter) to close. Backspace removes the last one.
          </p>
        )}
        {errors.length > 0 && (
          <ul className="roi-bar__errors" aria-live="polite">
            {errors.map((e) => (
              <li key={e.code}>
                <Icon name="alert" size={16} /> {e.message}
              </li>
            ))}
          </ul>
        )}
        {m.vertices.length > 0 && (
          <div className="roi-bar__actions">
            {!m.closed && m.vertices.length >= 3 && (
              <Button variant="secondary" icon="check" onClick={() => roiActions.close()}>
                Close region
              </Button>
            )}
            <Button variant="ghost" onClick={() => roiActions.undo()} disabled={m.closed}>
              Undo corner
            </Button>
            <Button variant="ghost" onClick={() => roiActions.clear()}>
              Clear
            </Button>
          </div>
        )}
        {m.selectedIndex !== null && m.vertices[m.selectedIndex] && (
          <p className="br-caption br-mono roi-bar__sel">
            Corner {m.selectedIndex + 1}: {m.vertices[m.selectedIndex]?.lat.toFixed(4)},{" "}
            {m.vertices[m.selectedIndex]?.lon.toFixed(4)} — focus the map and use arrow keys to nudge.
          </p>
        )}
      </div>
    </Panel>
  );
}

const LAYER_ROWS: { key: LayerKey; label: string }[] = [
  { key: "evidence", label: "Ground motion (evidence)" },
  { key: "qa", label: "Coherence / QA mask" },
  { key: "context", label: "Context imagery" },
  { key: "groundTrack", label: "NISAR ground track" },
];

function LayersTab() {
  const mission = getMission();
  const m = useApp((s) => s.mission);
  const setLayer = useApp((s) => s.setLayer);
  return (
    <div className="layers">
      {LAYER_ROWS.map(({ key, label }) => (
        <div className="layer-row" key={key}>
          <Toggle label={label} checked={m.layers[key].visible} onChange={(v) => setLayer(key, { visible: v })} />
          {key !== "groundTrack" && (
            <Slider
              label={`${label} opacity`}
              value={Math.round(m.layers[key].opacity * 100)}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={(v) => setLayer(key, { opacity: v / 100 })}
            />
          )}
        </div>
      ))}
      {mission.contextLayers.length > 1 && (
        <label className="layer-select">
          <span className="br-label">Context layer</span>
          <select
            value={m.contextFollow ? "__follow" : (m.contextLayerId ?? "")}
            onChange={(e) =>
              e.target.value === "__follow"
                ? useApp.getState().setMission({ contextFollow: true })
                : useApp.getState().setMission({ contextLayerId: e.target.value || null, contextFollow: false })
            }
          >
            <option value="__follow">
              Follow the current date ({m.contextKind === "radar" ? "NISAR radar" : "optical"})
            </option>
            {mission.contextLayers.map((l) => (
              <option key={l.layerId} value={l.layerId}>
                {l.title}
                {l.date ? ` · ${fmtDate(l.date)}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <Legend
        ramp={mission.legend.ramp}
        labels={mission.legend.labels}
        unit={mission.legend.unit}
        title="Ground motion"
      />
      <p className="br-caption">
        <Badge kind="SIMULATED" /> Ground-motion values are a seeded simulation. Dates, track 042 / frame 070 and the
        context imagery (MODIS optical, NISAR GCOV radar via NASA GIBS) are real.
      </p>
    </div>
  );
}

function Row({ k, v, mono = false }: { k: string; v: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="kv">
      <dt className="br-label">{k}</dt>
      <dd className={mono ? "br-mono" : undefined}>{v === null || v === undefined || v === "" ? "—" : String(v)}</dd>
    </div>
  );
}

function ProvenanceTab({ step }: { step: TemporalStep }) {
  const d = step.displacement;
  const acq = step.acquisition;
  return (
    <dl className="kvs" data-testid="provenance">
      <Row k="Step" v={`${step.stepId} · ${fmtDate(step.date)}`} mono />
      <Row k="Availability" v={step.isAvailable ? "Acquired" : "No acquisition"} />
      <Row k="Platform / instrument" v={`${step.platform} / ${step.instrument}`} />
      <Row k="Source" v={step.sourceId} mono />
      <Row k="Processing version" v={step.processingVersion} mono />
      <Row
        k="Track / frame / direction"
        v={acq ? `${acq.track ?? "—"} / ${acq.frame ?? "—"} / ${acq.orbitDirection}` : null}
        mono
      />
      <Row
        k="Quantity"
        v={d ? `${d.quantity === "los" ? "Line-of-sight" : "Vertical"} displacement (${d.unit})` : null}
      />
      <Row k="Sign convention" v={d?.signConvention} />
      <Row k="Reference step" v={d?.referenceStepId} mono />
      <Row
        k="Reference point"
        v={
          d?.referencePoint
            ? `${d.referencePoint.lat.toFixed(4)}, ${d.referencePoint.lon.toFixed(4)}, ${d.referencePoint.heightM} m`
            : null
        }
        mono
      />
      <Row
        k="Incidence angle"
        v={d?.incidenceAngleDeg !== null && d?.incidenceAngleDeg !== undefined ? `${d.incidenceAngleDeg}°` : null}
        mono
      />
      <Row k="Resolution" v={`${step.resolutionMeters} m · ${step.crs}`} mono />
      <Row
        k="Uncertainty"
        v={step.uncertainty !== null ? `${step.uncertainty} (${step.uncertaintyType})` : "not stated"}
        mono
      />
      <Row k="License" v={step.license} />
      <Row k="Attribution" v={step.attribution} />
      <Row k="Citation" v={step.citation} />
      <ContextProvenance />
    </dl>
  );
}

function ContextProvenance() {
  const id = useApp((s) => s.mission.contextLayerId);
  const l = getMission().contextLayers.find((c) => c.layerId === id);
  if (!l) return null;
  return (
    <>
      <Row k="Context imagery" v={`${l.title}${l.date ? ` · ${fmtDate(l.date)}` : ""}`} />
      <Row k="Imagery attribution" v={l.attribution} />
      <Row k="Imagery license" v={l.license} />
      <Row k="Imagery citation" v={l.citation} />
    </>
  );
}

function maskValueAt(g: MaskGrid, lon: number, lat: number): number | null {
  const [w, s, e, n] = g.bounds;
  if (lon < w || lon > e || lat < s || lat > n) return null;
  const col = Math.min(g.width - 1, Math.floor(((lon - w) / (e - w)) * g.width));
  const row = Math.min(g.height - 1, Math.floor(((n - lat) / (n - s)) * g.height));
  return g.data[row * g.width + col] ?? null;
}

function DiagnosticsTab({ step }: { step: TemporalStep }) {
  const mission = getMission();
  const m = useApp((s) => s.mission);
  const [qa, setQa] = useState<MaskGrid | null>(null);
  const [f32, setF32] = useState<Float32Array | null>(null);
  const qaAsset = step.qaMaskId ? mission.masks[step.qaMaskId] : undefined;
  useEffect(() => {
    let live = true;
    setQa(null);
    if (qaAsset)
      fetchMask(qaAsset).then(
        (g) => live && setQa(g),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [qaAsset]);
  // Optional per-step displacement grid shipped next to the evidence PNG (`.f32`, same grid as the QA mask).
  useEffect(() => {
    let live = true;
    setF32(null);
    if (step.isAvailable && step.tileUrlTemplate && qaAsset) {
      const url = step.tileUrlTemplate.replace(/\.png$/i, ".f32");
      fetchF32(url, qaAsset.width * qaAsset.height).then((a) => live && setF32(a));
    }
    return () => {
      live = false;
    };
  }, [step, qaAsset]);

  let coverage: number | null = null;
  if (qa && m.validation?.ok && m.closed) {
    let roi = 0;
    let valid = 0;
    const [w, , e, n] = qa.bounds;
    const s = qa.bounds[1];
    for (let r = 0; r < qa.height; r++) {
      const lat = n - ((r + 0.5) * (n - s)) / qa.height;
      for (let c = 0; c < qa.width; c++) {
        const lon = w + ((c + 0.5) * (e - w)) / qa.width;
        if (pointInRings(lon, lat, m.validation.rings)) {
          roi++;
          if (qa.data[r * qa.width + c]) valid++;
        }
      }
    }
    coverage = roi ? valid / roi : null;
  }
  let fullCoverage: number | null = null;
  if (qa) {
    let v = 0;
    for (let i = 0; i < qa.data.length; i++) if (qa.data[i]) v++;
    fullCoverage = v / qa.data.length;
  }
  const p = m.pointer;
  const qaAt = p && qa ? maskValueAt(qa, p.lon, p.lat) : null;
  let disp: number | null = null;
  if (p && f32 && qa) {
    const [w, s, e, n] = qa.bounds;
    if (p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n) {
      const col = Math.min(qa.width - 1, Math.floor(((p.lon - w) / (e - w)) * qa.width));
      const row = Math.min(qa.height - 1, Math.floor(((n - p.lat) / (n - s)) * qa.height));
      const v = f32[row * qa.width + col];
      disp = v !== undefined && Number.isFinite(v) && v !== step.noDataValue ? v : null;
    }
  }
  const pair = pairStatus();
  const a = stepById(m.pair.a);
  const b = stepById(m.pair.b);
  return (
    <div className="diag" data-testid="diagnostics">
      <dl className="kvs">
        <Row
          k="QA valid pixels (scene)"
          v={
            fullCoverage !== null
              ? `${(fullCoverage * 100).toFixed(1)} %`
              : step.isAvailable
                ? "loading…"
                : "no acquisition"
          }
          mono
        />
        <Row
          k="QA coverage in your region"
          v={
            coverage !== null
              ? `${(coverage * 100).toFixed(1)} % (needs ≥ ${(loadPrefabs().constants.scoring.qaMinCoverage * 100).toFixed(0)} %)`
              : "close a valid region"
          }
          mono
        />
        <Row
          k="Date pair Δt"
          v={
            a && b
              ? `${Math.abs(daysBetween(a.date, b.date)).toFixed(0)} days${pair.ok ? "" : " (not usable yet)"}`
              : "choose A and B"
          }
          mono
        />
      </dl>
      <p className="br-caption">
        Low interferometric coherence (fields, water, fast change) leaves pixels unusable. Turn on the QA mask layer to
        see where the radar signal is trustworthy.
      </p>
      <h3 className="br-label">Cursor probe</h3>
      <dl className="kvs" aria-live="off">
        <Row k="Lon / lat" v={p ? `${p.lon.toFixed(4)}, ${p.lat.toFixed(4)}` : "move over the map"} mono />
        <Row k="QA at cursor" v={qaAt === null ? "—" : qaAt ? "valid" : "masked (low coherence)"} />
        <Row
          k="Displacement"
          v={
            !step.isAvailable
              ? "no acquisition"
              : f32
                ? disp !== null
                  ? `${disp.toFixed(1)} ${step.displacement?.unit ?? ""} · SIMULATED`
                  : "—"
                : "not shipped for this step"
          }
          mono
        />
      </dl>
    </div>
  );
}
