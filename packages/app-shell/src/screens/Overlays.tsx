import { Badge, Button, Icon, Modal, RoiEditor2D, Slider, Stat, Toggle, toast } from "@blindrev/ui-hud";
import { useState } from "react";
import { loadPrefabs } from "../data/loaders";
import { env } from "../env";
import {
  fmtDate,
  getGlobe,
  getMission,
  roiActions,
  saveOutcomeToJournal,
  stepById,
  watchActions,
} from "../mission/controller";
import assetCredits from "virtual:blindrev-credits";
import { CELESTRAK_URL } from "../mission/nisar";
import { navigate } from "../scene/navigation";
import { AoiLocator, coachLines, dropJournalNote, JournalNote, OverlapDiagram, RegionThumb } from "./OverlayParts";
import { type JournalEntry, type QualityId, useApp, useReducedMotion } from "../store";
import type { DataLabel, ScoreOutcome } from "../types";

const LABEL_EXPLAINED: Record<DataLabel, string> = {
  SIMULATED:
    "The ground-motion values are a seeded simulation laid over the real place and real pass dates. Real NISAR interferograms (radar maps of ground motion) need an Earthdata login and heavy processing, so this case uses a stand-in. Treat it as training, not a finding.",
  PLACEHOLDER: "Some imagery is a placeholder until real tiles are bundled.",
  TEST_FIXTURE: "The case area is a test fixture, not a chosen real-world site.",
  STALE_EPHEMERIS:
    "The satellite orbit was predicted from an orbit file older than 72 hours, so its position may be off.",
  OFFLINE: "You are offline: the globe uses bundled low-detail imagery and smooth terrain.",
};

/** Human-readable label for a resource-pack path (the raw path stays in the title attribute). */
export function friendlySource(src: string): string {
  const parts: string[] = [];
  const add = (t: string) => {
    if (!parts.includes(t)) parts.push(t);
  };
  if (/07_NISAR_StoryMaps\/Land_Subsidence/.test(src)) add("NASA NISAR StoryMap — Land Subsidence");
  if (/08_NISAR_White_Papers/.test(src)) add("NISAR applications white paper — Drought and groundwater withdrawal");
  if (/09_UAVSAR_Postcards/.test(src)) add("NASA UAVSAR postcard — California drought");
  if (/03_NISAR_Data_User_Guide/.test(src)) add("NISAR Data User Guide");
  if (/CMR|C\d{6,}-ASF/.test(src)) add("NASA CMR / ASF catalogue");
  const cite = /([A-Z][a-z]+ et al\. \d{4}[^;)]*)/.exec(src);
  if (cite?.[1]) add(cite[1]);
  if (!parts.length) return /\.\.\/sars\//.test(src) ? "Challenge resource pack" : src;
  return parts.join(" · ");
}

const close = () => useApp.setState((s) => ({ overlay: s.overlayReturn, overlayReturn: null }));

export function BriefingModal() {
  const mission = getMission();
  const b = mission.briefing;
  const rm = useReducedMotion();
  const avail = mission.steps.filter((s) => s.isAvailable);
  const missing = mission.steps.length - avail.length;
  const first = avail[0];
  const last = avail[avail.length - 1];
  const platforms = [...new Set(avail.map((s) => `${s.platform} ${s.instrument}`))].join(", ");
  const evidence = [
    `${avail.length} radar acquisitions${first && last ? ` from ${fmtDate(first.date)} to ${fmtDate(last.date)}` : ""} (${platforms})`,
    ...(missing
      ? [`${missing} scheduled date${missing === 1 ? "" : "s"} with no acquisition — shown as gaps, never filled in`]
      : []),
    "A coherence (QA) mask for every acquisition: where the radar signal can be trusted",
    ...Object.entries(
      mission.contextLayers.reduce<Record<string, number>>((acc, l) => {
        const k = l.title.split(" · ")[0] ?? l.title;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([k, n]) => `Context imagery: ${k} (${n} date${n === 1 ? "" : "s"})`),
    "NISAR position and ground track, propagated from its published orbit elements",
  ];
  const start = () => {
    useApp.setState({ overlay: null });
    getGlobe()?.flyTo("aoi");
    // Lead with the investigation: the watch starts as soon as the briefing closes.
    if (!rm) setTimeout(() => watchActions.play(), 400);
  };
  return (
    <Modal
      open
      title={b.question}
      kicker={`CASE #${mission.caseId.replace(/\D/g, "").padStart(3, "0")} · ${mission.title}`}
      onClose={start}
      size="lg"
      footer={
        <Button variant="primary" size="lg" icon="play" onClick={start} data-testid="start-investigation">
          Start investigation
        </Button>
      }
    >
      <div className="briefing casefile" data-testid="briefing">
        <div className="casefile__top">
          <AoiLocator bounds={mission.effectiveBounds} />
          <div className="casefile__where">
            <span className="br-mono br-caption casefile__kicker">{mission.kicker}</span>
            <div className="briefing__meta">
              <Stat label="Location" value={b.location} />
              <Stat label="Dates" value={b.dates} mono />
              <Stat label="Source" value={b.source} />
            </div>
          </div>
        </div>
        <section aria-labelledby="report-h">
          <h3 id="report-h" className="br-label">
            Initial report
          </h3>
          <p className="br-body-l">{b.summary}</p>
          {b.body.map((p) => (
            <p key={p.slice(0, 40)} className="br-body" style={{ marginTop: 8 }}>
              {p}
            </p>
          ))}
        </section>
        <section aria-labelledby="evidence-h">
          <h3 id="evidence-h" className="br-label">
            Evidence available
          </h3>
          <ul className="evidence-list br-body-s">
            {evidence.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
        {b.facts.length > 0 && (
          <section aria-labelledby="facts-h">
            <h3 id="facts-h" className="br-label">
              What we know
            </h3>
            <ul className="facts">
              {b.facts.map((f) => (
                <li key={f.text.slice(0, 40)}>
                  <span>{f.text}</span>
                  <span className="br-caption facts__src" title={f.source}>
                    Source: {friendlySource(f.source)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="labels-h" className="briefing__labels">
          <h3 id="labels-h" className="br-label">
            Read this first
          </h3>
          {mission.labels.map((l) => (
            <div key={l} className="label-explain">
              <Badge kind={l} />
              <p className="br-body-s">{LABEL_EXPLAINED[l]}</p>
            </div>
          ))}
        </section>
        <p className="casefile__mission">Mission: Discover what is happening and explain the evidence.</p>
        <p className="br-caption">
          Watch the passes with the Time Lens, pick two dates at least {loadPrefabs().constants.scoring.dtMinDays} days
          apart, outline the area that changed, then validate it.
        </p>
      </div>
    </Modal>
  );
}

export function outcomeHeadline(o: ScoreOutcome): {
  tier: string;
  icon: "check" | "alert" | "target";
  word: string;
  tone: string;
} {
  if (o.kind === "SCORE") {
    if (o.tier === "PASS") return { tier: "PASS", icon: "check", word: "Evidence found", tone: "pass" };
    if (o.tier === "PARTIAL")
      return { tier: "PARTIAL", icon: "target", word: "Close, but adjust your region", tone: "partial" };
    return { tier: "FAIL", icon: "alert", word: "Not this area", tone: "fail" };
  }
  if (o.kind === "QA_DIAGNOSTIC")
    return { tier: "NO SCORE", icon: "alert", word: "Signal too weak to judge", tone: "qa" };
  return { tier: "NOT SCORED", icon: "alert", word: "Check your setup", tone: "qa" };
}

const pctStr = (v: number) => `${(v * 100).toFixed(1)} %`;

export function ResultsModal() {
  const m = useApp((s) => s.mission);
  const setLayer = useApp((s) => s.setLayer);
  const o = m.outcome;
  if (!o) return null;
  const h = outcomeHeadline(o);
  const a = stepById(m.pair.a);
  const b = stepById(m.pair.b);
  const saved = m.savedOutcomeDigest !== null;
  const coach = coachLines(o);
  const save = () => {
    if (saveOutcomeToJournal()) toast({ title: "Evidence saved", body: "Added to your case journal." });
  };
  const tryAgain = () => {
    useApp.setState({ overlay: null });
    useApp.getState().setMission({ outcome: null });
    roiActions.toggleDraw(false);
  };
  return (
    <Modal
      open
      title="Verdict"
      onClose={tryAgain}
      size="lg"
      footer={
        <div className="modal-actions">
          <Button variant="primary" icon="journal" onClick={save} disabled={saved} data-testid="save-journal">
            {saved ? "Saved to Case Journal" : "Save to Case Journal"}
          </Button>
          <Button variant="secondary" icon="target" onClick={tryAgain} data-testid="try-again">
            Try again
          </Button>
          <Button variant="ghost" icon="back" onClick={() => void navigate("hub")}>
            Back to command board
          </Button>
        </div>
      }
    >
      <div className="results" data-testid="results">
        <div className={`verdict verdict--${h.tone}`}>
          <Icon name={h.icon} size={48} />
          <div>
            <span className="verdict__tier" data-testid="verdict-tier">
              {h.tier}
            </span>
            <span className="verdict__word">{h.word}</span>
          </div>
        </div>
        {o.kind === "SCORE" && (
          <>
            <div className="results__compare">
              <OverlapDiagram mine={m.vertices} reference={getMission().referencePolygons} />
              {coach.length > 0 && (
                <div className="results__coach" data-testid="verdict-coach">
                  <span className="br-label">{o.tier === "PASS" ? "What you found" : "For your next attempt"}</span>
                  {coach.map((t) => (
                    <p key={t} className="br-body">
                      {t}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="results__stats">
              <Stat label="Overlap (IoU)" value={o.iou.toFixed(3)} mono />
              <Stat label="Precision" value={o.precision.toFixed(3)} mono />
              <Stat label="Recall" value={o.recall.toFixed(3)} mono />
              <Stat label="QA coverage" value={pctStr(o.coverage)} mono />
            </div>
            <p className="br-body-s">
              Precision: how much of your region really changed. Recall: how much of the change you caught. PASS needs
              an overlap of at least {loadPrefabs().constants.scoring.iouPass.toFixed(2)}.
            </p>
            {o.advisory.length > 0 && (
              <ul className="advisories">
                {o.advisory.map((t) => (
                  <li key={t}>
                    <Icon name="alert" size={16} /> {t}
                  </li>
                ))}
              </ul>
            )}
            <details className="results__details">
              <summary>Details</summary>
              <p className="br-mono br-caption">
                {o.roiPixels} px in region · {o.validPixels} valid · TP {o.tp} · FP {o.fp} · FN {o.fn} · digest{" "}
                {o.digest.slice(0, 16)}
              </p>
            </details>
          </>
        )}
        {o.kind === "QA_DIAGNOSTIC" && (
          <div className="diag-msg" data-testid="qa-diagnostic">
            <Badge kind="ALERT" detail={o.code.replace(/_/g, " ").toLowerCase()} />
            <p className="br-body">{o.message}</p>
            <div className="qa-meter" role="img" aria-label={`QA coverage ${pctStr(o.coverage)}`}>
              <span className="qa-meter__fill" style={{ width: `${Math.max(0, Math.min(1, o.coverage)) * 100}%` }} />
            </div>
            <p className="br-mono br-caption">
              QA coverage {pctStr(o.coverage)} · {o.validPixels} valid of {o.roiPixels} px in region. Turn on the QA
              mask layer and outline an area where the signal holds.
            </p>
          </div>
        )}
        {o.kind === "REJECTED" && (
          <div className="diag-msg">
            <Badge kind="ALERT" detail={o.code.replace(/_/g, " ").toLowerCase()} />
            <p className="br-body">{o.message}</p>
          </div>
        )}
        <p className="br-caption">
          {a && b ? `Pair ${fmtDate(a.date)} → ${fmtDate(b.date)} · ` : ""}
          {m.vertices.length} corners · {m.validation?.areaKm2.toFixed(1) ?? "—"} km²
        </p>
        <p className="results__disclaimer">
          Mission scoring against an authored reference mask — not a scientific measurement.
        </p>
        <Toggle
          label="Show the case file's reference area on the globe"
          checked={m.layers.referenceMask.visible}
          onChange={(v) => setLayer("referenceMask", { visible: v })}
        />
      </div>
    </Modal>
  );
}

export function RoiEditorModal() {
  const mission = getMission();
  const m = useApp((s) => s.mission);
  const c = loadPrefabs().constants;
  const step = mission.steps[m.index];
  const qa = step?.qaMaskId ? mission.masks[step.qaMaskId] : undefined;
  const overlays = [] as { url: string; opacity: number }[];
  if (qa && m.layers.qa.visible)
    overlays.push({ url: new URL(qa.pngUrl, document.baseURI).href, opacity: m.layers.qa.opacity });
  if (m.layers.referenceMask.visible) {
    const ref = mission.masks[mission.referenceMaskId];
    if (ref)
      overlays.push({ url: new URL(ref.pngUrl, document.baseURI).href, opacity: m.layers.referenceMask.opacity });
  }
  if (m.anomalies?.length) {
    // Anomaly Detector flags drawn into the editor as an SVG overlay stretched over the editor bounds.
    const [w, so, e, n] = mission.effectiveBounds;
    const toX = (lon: number) => (((lon - w) / (e - w)) * 1000).toFixed(1);
    const toY = (lat: number) => (((n - lat) / (n - so)) * 1000).toFixed(1);
    const shapes = m.anomalies
      .map((a) => {
        const pts = a.ring.map((p) => `${toX(p.lon)},${toY(p.lat)}`).join(" ");
        const lx = toX(Math.min(...a.ring.map((p) => p.lon)));
        const ly = toY(Math.max(...a.ring.map((p) => p.lat)));
        return `<polygon points="${pts}" fill="none" stroke="#F2B441" stroke-width="3" stroke-dasharray="10 6"/><text x="${lx}" y="${Number(ly) - 6}" fill="#F2B441" font-family="monospace" font-size="26" font-weight="700">${a.label}</text>`;
      })
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">${shapes}</svg>`;
    overlays.push({ url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, opacity: 1 });
  }
  const backdrop =
    step?.isAvailable && step.tileUrlTemplate ? new URL(step.tileUrlTemplate, document.baseURI).href : null;
  return (
    <Modal
      open
      title="2D region editor"
      onClose={() => useApp.setState({ overlay: null })}
      size="xl"
      footer={
        <div className="modal-actions">
          <Button variant="primary" icon="check" onClick={() => useApp.setState({ overlay: null })}>
            Done
          </Button>
          <Button variant="ghost" onClick={() => roiActions.clear()}>
            Clear region
          </Button>
        </div>
      }
    >
      <p className="br-body-s">
        Click to add corners, click the first corner to close. Select a corner and use the arrow keys to nudge it (
        {c.roiNudgeDeg}°, Shift ×{c.roiNudgeCoarseFactor}). The map shows{" "}
        {step?.isAvailable ? `the ${fmtDate(step.date)} pass` : "no acquisition for this date"}.
      </p>
      <RoiEditor2D
        bounds={mission.effectiveBounds}
        vertices={m.vertices}
        closed={m.closed}
        selectedIndex={m.selectedIndex}
        validation={m.validation}
        backdropUrl={backdrop}
        overlayUrls={overlays}
        nudgeDeg={c.roiNudgeDeg}
        coarseFactor={c.roiNudgeCoarseFactor}
        canvasMaxHeight="max(15rem, min(68vh, calc(100dvh - 23rem)))"
        onChange={(v, closed) => roiActions.set(v, closed)}
        onSelect={(i) => roiActions.select(i)}
      />
    </Modal>
  );
}

function JournalRow({ e }: { e: JournalEntry }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const remove = useApp((s) => s.removeJournal);
  const h = outcomeHeadline(e.outcome);
  return (
    <li className={`jrow jrow--${h.tone}`}>
      <button type="button" className="jrow__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <RegionThumb vertices={e.vertices} tone={h.tone} />
        <span className="jrow__main">
          <span className="jrow__title">
            {e.caseId} · {e.title}
          </span>
          <span className="br-mono jrow__meta">
            {fmtDate(e.pair.aDate)} → {fmtDate(e.pair.bDate)} · {e.areaKm2.toFixed(1)} km²
          </span>
          <span className="br-mono jrow__meta">{new Date(e.savedAt).toISOString().slice(0, 16).replace("T", " ")}</span>
        </span>
        <span className="jrow__tier jrow__stamp">
          <Icon name={h.icon} size={16} /> {h.tier}
        </span>
      </button>
      {open && (
        <div className="jrow__body">
          <JournalNote id={e.id} />
          <div className="results__stats">
            {e.outcome.kind === "SCORE" ? (
              <>
                <Stat label="IoU" value={e.outcome.iou.toFixed(3)} mono />
                <Stat label="Precision" value={e.outcome.precision.toFixed(3)} mono />
                <Stat label="Recall" value={e.outcome.recall.toFixed(3)} mono />
              </>
            ) : (
              <Stat label="Result" value={e.outcome.kind === "QA_DIAGNOSTIC" ? e.outcome.code : e.outcome.code} mono />
            )}
            <Stat label="Area" value={e.areaKm2.toFixed(1)} unit="km²" mono />
          </div>
          <p className="br-caption br-mono">
            Corners: {e.vertices.map((v) => `${v.lat.toFixed(4)},${v.lon.toFixed(4)}`).join(" · ")}
          </p>
          <p className="br-caption br-mono">Digest: {e.digest ?? "— (no score)"}</p>
          <div className="badge-row">
            {e.labels.map((l) => (
              <Badge key={l} kind={l} />
            ))}
          </div>
          <p className="br-caption">
            Mission scoring against an authored reference mask — not a scientific measurement.
          </p>
          {confirm ? (
            <div className="modal-actions">
              <span className="br-body-s">Delete this entry for good?</span>
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  dropJournalNote(e.id);
                  remove(e.id);
                }}
              >
                Delete entry
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              Delete…
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function JournalModal() {
  const journal = useApp((s) => s.journal);
  const exportJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { schema: "blindrev.journal.v1", exportedAt: new Date().toISOString(), entries: journal },
          null,
          2,
        ),
      ],
      {
        type: "application/json",
      },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "blindrev-case-journal.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <Modal
      open
      title="Case Journal"
      onClose={close}
      size="lg"
      footer={
        <div className="modal-actions">
          <Button variant="secondary" icon="journal" onClick={exportJson} disabled={!journal.length}>
            Export JSON
          </Button>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        </div>
      }
    >
      <div data-testid="journal">
        {journal.length === 0 ? (
          <div className="jempty">
            <svg
              viewBox="0 0 96 96"
              width="96"
              height="96"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M24 12h40l12 12v60H24z" />
              <path d="M64 12v12h12" />
              <path d="M34 12v72" strokeDasharray="3 5" />
              <path d="M44 40h22M44 50h22M44 60h12" />
              <path d="m58 70 6 4 8-12" />
            </svg>
            <div>
              <strong className="jempty__title">Your notebook is empty</strong>
              <p className="br-body">No entries yet. Validate a region in a case and save the verdict here.</p>
            </div>
          </div>
        ) : (
          <ul className="journal">
            {journal.map((e) => (
              <JournalRow key={e.id} e={e} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export function SettingsModal() {
  const s = useApp((st) => st.settings);
  const setSettings = useApp((st) => st.setSettings);
  const route = useApp((st) => st.route);
  const globeStatus = useApp((st) => st.globeStatus);
  const q = loadPrefabs().quality;
  const mission = getMission();
  return (
    <Modal
      open
      title="Settings"
      onClose={close}
      footer={
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      }
    >
      <div className="settings" data-testid="settings">
        <fieldset>
          <legend className="br-label">Quality</legend>
          <div className="seg" role="radiogroup" aria-label="Quality preset">
            {(["low", "medium", "high"] as QualityId[]).map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={s.quality === id}
                className={`seg__btn${s.quality === id ? " is-on" : ""}`}
                onClick={() => setSettings({ quality: id })}
              >
                {id[0]?.toUpperCase()}
                {id.slice(1)}
              </button>
            ))}
          </div>
          <p className="br-caption br-mono">
            tile cache {q[s.quality].tileCacheSize} · max SSE {q[s.quality].maximumScreenSpaceError} · render scale{" "}
            {q[s.quality].renderScale}
            {q[s.quality].allow4k ? " · 4K allowed" : ""}
          </p>
          <p className="br-caption">
            {route === "menu"
              ? "Applies when the next scene loads."
              : "Takes effect when the next scene loads, never mid-flight."}
          </p>
        </fieldset>
        <fieldset>
          <legend className="br-label">Reduced motion</legend>
          <div className="seg" role="radiogroup" aria-label="Reduced motion">
            {(
              [
                ["system", "System"],
                ["on", "On"],
                ["off", "Off"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={s.motion === id}
                className={`seg__btn${s.motion === id ? " is-on" : ""}`}
                onClick={() => setSettings({ motion: id })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="br-caption">
            Turns off screen wipes, camera flights and auto-play. You still get the same information.
          </p>
        </fieldset>
        <fieldset>
          <legend className="br-label">Sound</legend>
          <Toggle label="Sound cues" checked={s.sound} onChange={(v) => setSettings({ sound: v })} />
          <Slider
            label="Volume"
            value={Math.round(s.volume * 100)}
            min={0}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => setSettings({ volume: v / 100 })}
          />
        </fieldset>
        <fieldset>
          <legend className="br-label">Globe camera</legend>
          <Toggle
            label="Custom camera (WASD to pan, Z/X to zoom)"
            checked={s.customCamera}
            onChange={(v) => setSettings({ customCamera: v })}
          />
          <p className="br-caption">
            When off, the globe uses Cesium's standard mouse controls. Takes effect next time the globe loads.
          </p>
        </fieldset>
        <fieldset>
          <legend className="br-label">Terrain service</legend>
          <p className="br-body-s">
            {env.ionToken ? (
              <>
                <Badge kind="OK" detail="Cesium ion token configured" /> World Terrain streams when online.
              </>
            ) : (
              <>
                <Badge kind="INFO" detail="No ion token" /> Terrain is smooth, with no hills or valleys. Imagery comes
                from bundled NASA GIBS tiles.
              </>
            )}
          </p>
          {globeStatus?.message && <p className="br-caption">{globeStatus.message}</p>}
        </fieldset>
        <fieldset>
          <legend className="br-label">Attributions</legend>
          <ul className="attrib">
            {mission.attributions.map((a) => (
              <li key={a} className="br-caption">
                {a}
              </li>
            ))}
          </ul>
        </fieldset>
      </div>
    </Modal>
  );
}

export function CreditsModal() {
  const mission = getMission();
  const layers = mission.contextLayers;
  return (
    <Modal
      open
      title="Credits & data sources"
      onClose={close}
      size="lg"
      footer={
        <Button variant="primary" onClick={close}>
          Close
        </Button>
      }
    >
      <div className="credits">
        <p className="br-body">
          BlindRev is a fictional investigation bureau built for the NASA Space Apps SAR challenge. It is not affiliated
          with NASA; NASA and partner data are credited below.
        </p>
        <h3 className="br-label">Mission data</h3>
        <ul className="attrib">
          {mission.attributions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <h3 className="br-label">Context imagery</h3>
        <ul className="attrib">
          {[...new Map(layers.map((l) => [`${l.attribution}|${l.license}`, l])).values()].map((l) => (
            <li key={l.layerId}>
              {l.title.split(" · ")[0]} — {l.attribution} ({l.license})
            </li>
          ))}
        </ul>
        <h3 className="br-label">Bundled assets (from data/assets.manifest.json)</h3>
        <ul className="attrib" data-testid="asset-credits">
          {assetCredits.map((c) => (
            <li key={`${c.license}|${c.attribution}`}>
              {c.attribution} — <span className="br-caption">{c.license}</span>{" "}
              <span className="br-caption br-mono">[{c.folders.join(", ")}]</span>
            </li>
          ))}
        </ul>
        <h3 className="br-label">Orbit</h3>
        <p className="br-body-s">
          NISAR (NORAD 65053) two-line elements from CelesTrak GP ({CELESTRAK_URL.replace(/\?.*/, "")}); propagated with
          satellite.js (SGP4). Propagated position — not live telemetry.
        </p>
        <h3 className="br-label">Software</h3>
        <p className="br-body-s">
          CesiumJS and Cesium ion (Apache-2.0; globe engine, ion logo and data attribution shown on the globe), three.js
          (MIT), pmndrs/postprocessing (Zlib), React (MIT), Zod (MIT), satellite.js (MIT). Fonts: Outfit, IBM Plex Sans,
          IBM Plex Mono (SIL Open Font License 1.1, via @fontsource).
        </p>
        <h3 className="br-label">Honesty labels</h3>
        <div className="badge-row">
          {(["SIMULATED", "PLACEHOLDER", "TEST_FIXTURE", "STALE_EPHEMERIS", "OFFLINE"] as DataLabel[]).map((l) => (
            <Badge key={l} kind={l} />
          ))}
        </div>
        <p className="br-caption">
          These labels appear wherever data is simulated, a placeholder, a fixture, out of date or offline.
        </p>
      </div>
    </Modal>
  );
}
