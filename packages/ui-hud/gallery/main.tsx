import "@blindrev/ui-hud/styles.css";
import "./gallery.css";
import { createTemporalWatch, type LonLat, type WatchSnapshot, validateRoi } from "@blindrev/core-sim";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  announce,
  Badge,
  type BadgeKind,
  Button,
  getAnnouncements,
  HexSpinner,
  ICON_NAMES,
  Icon,
  initSound,
  KeyHint,
  Legend,
  LiveRegion,
  Logo,
  MenuList,
  Modal,
  Panel,
  playSound,
  ProgressBar,
  ReturnButton,
  RoiEditor2D,
  type SoundName,
  Slider,
  Stat,
  setAmbient,
  setSoundEnabled,
  setVolume,
  Tabs,
  TemporalTimeline,
  type TimelinePair,
  Toggle,
  type ToolDef,
  ToolRail,
  WipeOverlay,
  type WipePhase,
} from "../src/index";
import { fakeSteps, GALLERY_BOUNDS, makeBackdrop } from "./fixtures";

const params = new URLSearchParams(location.search);
const PLATE = new URL("./assets/outpost-plate.jpg", import.meta.url).href;
initSound({ baseUrl: new URL("audio/", document.baseURI).href });

const BADGES: BadgeKind[] = [
  "SIMULATED",
  "PLACEHOLDER",
  "TEST_FIXTURE",
  "STALE_EPHEMERIS",
  "OFFLINE",
  "INFO",
  "OK",
  "ALERT",
];
const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
const STATES = ["default", "hover", "pressed", "focus", "disabled", "locked"] as const;

const TOOLS: ToolDef[] = [
  { id: "time-lens", label: "Time Lens", icon: "timeLens", status: "active", shortcut: "T" },
  { id: "radar-vision", label: "Radar Vision", icon: "waves", status: "available", shortcut: "R" },
  {
    id: "anomaly",
    label: "Anomaly Detector",
    icon: "target",
    status: "locked",
    reason: "View every available date first",
  },
  {
    id: "connector",
    label: "Evidence Connector",
    icon: "journal",
    status: "locked",
    reason: "Unlocks with your first verdict",
  },
  { id: "frequency", label: "Frequency Switch", icon: "comms", status: "locked", reason: "Unlocks in a later case" },
  { id: "terrain", label: "Terrain Scanner", icon: "scanner", status: "locked", reason: "Unlocks in a later case" },
];

function Section({
  id,
  title,
  kicker,
  children,
}: {
  id: string;
  title: string;
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <section className="g-section" id={id} aria-labelledby={`${id}-h`}>
      <header className="g-section__head">
        <p className="br-kicker">{kicker}</p>
        <h2 id={`${id}-h`} className="br-h2">
          {title}
        </h2>
      </header>
      {children}
    </section>
  );
}

function ButtonMatrix() {
  return (
    <div className="g-matrix">
      <div className="g-matrix__row g-matrix__row--head">
        <span />
        {STATES.map((s) => (
          <span key={s} className="br-label g-dim">
            {s}
          </span>
        ))}
      </div>
      {VARIANTS.map((v) => (
        <div className="g-matrix__row" key={v}>
          <span className="br-label g-dim">{v}</span>
          {STATES.map((s) => (
            <span key={s}>
              <Button
                variant={v}
                className={
                  s === "hover" ? "g-hover" : s === "pressed" ? "g-pressed" : s === "focus" ? "g-focus" : undefined
                }
                disabled={s === "disabled"}
                locked={s === "locked"}
                icon={v === "danger" ? "trash" : v === "primary" ? "check" : undefined}
              >
                {s === "disabled" ? "Unavailable" : s === "locked" ? "Locked" : v === "danger" ? "Delete" : "Continue"}
              </Button>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Kit({ onImagery }: { onImagery: boolean }) {
  const [opacity, setOpacity] = useState(60);
  const [radar, setRadar] = useState(true);
  const [tab, setTab] = useState("radar");
  const tone = onImagery ? "scrim" : "graphite";
  return (
    <div className="g-kit">
      <Panel
        title="The Sinking City"
        kicker="CASE_001 / READY"
        chamfer
        tone={tone}
        actions={<Badge kind="SIMULATED" />}
      >
        <p className="g-copy">Investigate a reported change. Gather observations and connect evidence.</p>
        <div className="g-row">
          <Button icon="research">Open briefing</Button>
          <Button variant="secondary" icon="map">
            Map
          </Button>
          <Button variant="ghost">Stay at hub</Button>
        </div>
      </Panel>
      <Panel title="Layer controls" kicker="OBS 03 / LAYER TERRAIN" tone={tone}>
        <div className="g-stack">
          <Toggle label="Radar vision" checked={radar} onChange={setRadar} />
          <Slider label="Layer opacity" value={opacity} min={0} max={100} step={5} unit="%" onChange={setOpacity} />
          <Tabs
            tabs={[
              { id: "terrain", label: "Terrain" },
              { id: "radar", label: "Radar" },
              { id: "context", label: "Context" },
            ]}
            value={tab}
            onChange={setTab}
            label="Layer"
          />
          <p className="br-caption g-copy">Compare observations of one place.</p>
        </div>
      </Panel>
      <Panel title="Data labels" tone={tone}>
        <div className="g-wrap">
          {BADGES.map((b) => (
            <Badge key={b} kind={b} detail={b === "STALE_EPHEMERIS" ? "epoch 81 h old" : undefined} />
          ))}
        </div>
      </Panel>
      <Panel title="Readouts" tone={tone}>
        <div className="g-stats">
          <Stat label="Samples" value="03" />
          <Stat label="Area" value="412.6" unit="km²" mono />
          <Stat label="IoU" value="0.58" mono />
          <Stat label="Δt" value="36" unit="days" mono />
        </div>
        <ProgressBar value={0.6} label="Scan progress" />
      </Panel>
    </div>
  );
}

function TimelineDemo({ reducedMotion }: { reducedMotion: boolean }) {
  const steps = useMemo(() => fakeSteps(), []);
  const watch = useMemo(() => createTemporalWatch(steps, { initialIndex: 3 }), [steps]);
  const [snap, setSnap] = useState<WatchSnapshot>(() => watch.getSnapshot());
  const [pair, setPair] = useState<TimelinePair>({ a: "s01", b: "s02" });
  useEffect(
    () =>
      watch.subscribe((s, emissions) => {
        setSnap(s);
        for (const e of emissions) {
          if (e.type === "NoAcquisition") announce(`No acquisition on ${e.date}.`, "assertive");
          if (e.type === "StateChanged") announce(`Watch ${e.to.toLowerCase().replace("_", " ")}.`);
          if (e.type === "StepChanged") playSound("scan");
        }
      }),
    [watch],
  );
  useEffect(() => {
    if (snap.state !== "PLAYING" || reducedMotion) return;
    const t = setInterval(() => watch.dispatch({ type: "TICK" }), 900);
    return () => clearInterval(t);
  }, [snap.state, watch, reducedMotion]);
  return (
    <TemporalTimeline
      steps={steps}
      index={snap.index}
      state={snap.state}
      pair={pair}
      onScrubStart={() => watch.dispatch({ type: "SCRUB_START" })}
      onScrubTo={(i) => watch.dispatch({ type: "SCRUB_TO", index: i })}
      onScrubEnd={() => watch.dispatch({ type: "SCRUB_END" })}
      onPlay={() => watch.dispatch({ type: "PLAY" })}
      onPause={() => watch.dispatch({ type: "PAUSE" })}
      onStep={(d) => watch.dispatch({ type: d < 0 ? "STEP_BACK" : "STEP_FORWARD" })}
      onPairChange={setPair}
      reducedMotion={reducedMotion}
      dtMinDays={24}
    />
  );
}

const START_ROI: LonLat[] = [
  { lon: -120.08, lat: 36.16 },
  { lon: -119.9, lat: 36.17 },
  { lon: -119.86, lat: 36.03 },
  { lon: -119.97, lat: 35.95 },
  { lon: -120.1, lat: 36.02 },
];
const BOWTIE: LonLat[] = [
  { lon: -120.1, lat: 36.15 },
  { lon: -119.85, lat: 35.95 },
  { lon: -119.85, lat: 36.15 },
  { lon: -120.1, lat: 35.95 },
];

function RoiDemo() {
  const backdrop = useMemo(() => makeBackdrop(), []);
  const [vertices, setVertices] = useState<LonLat[]>(START_ROI);
  const [closed, setClosed] = useState(true);
  const [sel, setSel] = useState<number | null>(1);
  const validation = useMemo(
    () => (vertices.length >= 3 ? validateRoi(vertices, { roiAreaMinKm2: 25, roiAreaMaxKm2: 2500 }) : null),
    [vertices],
  );
  return (
    <div className="g-stack">
      <div className="g-row">
        <Button variant="ghost" icon="alert" onClick={() => (setVertices(BOWTIE), setClosed(true), setSel(null))}>
          Load self-intersecting shape
        </Button>
        <Button variant="ghost" icon="target" onClick={() => (setVertices(START_ROI), setClosed(true), setSel(1))}>
          Load valid shape
        </Button>
        <Badge kind="SIMULATED" detail="gallery backdrop" />
      </div>
      <RoiEditor2D
        bounds={GALLERY_BOUNDS}
        vertices={vertices}
        closed={closed}
        selectedIndex={sel}
        validation={validation}
        backdropUrl={backdrop}
        nudgeDeg={0.001}
        coarseFactor={10}
        onChange={(v, c) => {
          setVertices(v);
          setClosed(c);
        }}
        onSelect={setSel}
      />
    </div>
  );
}

function MenuMock() {
  const [value, setValue] = useState("new");
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="g-screen" style={{ backgroundImage: `url("${PLATE}")` }}>
      <div className="g-screen__inner">
        <Logo size={88} />
        <MenuList
          items={[
            { id: "new", label: "New Expedition" },
            { id: "continue", label: "Continue", disabled: true },
            { id: "settings", label: "Settings" },
            { id: "credits", label: "Credits" },
            { id: "quit", label: "Quit" },
          ]}
          value={value}
          onChange={setValue}
          onSelect={setPicked}
        />
        <KeyHint
          hints={[
            { key: "Enter", action: "Select" },
            { key: "Esc", action: "Back" },
          ]}
        />
        {picked ? <p className="br-mono g-dim">selected: {picked}</p> : null}
      </div>
    </div>
  );
}

function LoadingMock({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="g-screen g-screen--contain">
      <WipeOverlay
        phase="covered"
        progress={0.64}
        label="Preparing your expedition"
        reducedMotion={reducedMotion}
        durationMs={500}
        backgroundUrl={PLATE}
      />
    </div>
  );
}

function App() {
  const [reducedMotion, setReducedMotion] = useState(params.get("rm") === "1");
  const [sound, setSound] = useState(true);
  const [ambient, setAmb] = useState(false);
  const [volume, setVol] = useState(60);
  const [modal, setModal] = useState(params.get("modal") === "1");
  const [wipe, setWipe] = useState<WipePhase>("idle");
  const [wipeProgress, setWipeProgress] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle("br-reduced-motion", reducedMotion);
  }, [reducedMotion]);
  useEffect(() => {
    const t = setInterval(
      () =>
        setLog(
          getAnnouncements()
            .slice(-6)
            .map((a) => `${a.politeness === "assertive" ? "!" : "·"} ${a.message}`),
        ),
      500,
    );
    return () => clearInterval(t);
  }, []);

  const runWipe = () => {
    playSound("travel");
    setWipe("covering");
    setWipeProgress(0);
    const dur = reducedMotion ? 0 : 500;
    setTimeout(() => {
      setWipe("covered");
      let p = 0;
      const t = setInterval(() => {
        p += 0.2;
        setWipeProgress(Math.min(1, p));
        if (p >= 1) {
          clearInterval(t);
          setWipe("revealing");
          setTimeout(() => setWipe("idle"), dur);
        }
      }, 300);
    }, dur);
  };

  return (
    <main className="g-page">
      <header className="g-top">
        <div className="g-top__brand">
          <Logo variant="lockup" size={40} />
          <div>
            <p className="br-kicker">EARTH.exe / OUTPOST SIGNAL</p>
            <h1 className="br-h3">ui-hud gallery</h1>
          </div>
        </div>
        <div className="g-top__controls">
          <Toggle label="Reduced motion" checked={reducedMotion} onChange={setReducedMotion} data-testid="g-rm" />
          <Toggle
            label="Sound"
            checked={sound}
            onChange={(v) => {
              setSound(v);
              setSoundEnabled(v);
            }}
          />
          <Toggle
            label="Ambient"
            checked={ambient}
            onChange={(v) => {
              setAmb(v);
              setAmbient(v);
            }}
          />
          <div className="g-vol">
            <Slider
              label="Volume"
              value={volume}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={(v) => {
                setVol(v);
                setVolume(v / 100);
              }}
            />
          </div>
          <ReturnButton label="Return to hub" onClick={() => announce("Returning to hub.")} />
        </div>
      </header>

      <Section id="screens" kicker="§10 MOCKUPS" title="Menu and loading hold">
        <div className="g-screens">
          <MenuMock />
          <LoadingMock reducedMotion={reducedMotion} />
        </div>
      </Section>

      <Section id="kit" kicker="COMPONENTS / INK + IMAGERY" title="Every component, on Ink and on imagery">
        <div className="g-two">
          <div className="g-surface g-surface--ink">
            <p className="br-kicker g-surface__tag">ON INK</p>
            <Kit onImagery={false} />
          </div>
          <div className="g-surface g-surface--busy">
            <p className="br-kicker g-surface__tag br-scrim">ON IMAGERY (SCRIMS)</p>
            <Kit onImagery />
          </div>
        </div>
      </Section>

      <Section id="buttons" kicker="STATES" title="Every action shows its state">
        <ButtonMatrix />
      </Section>

      <Section id="tools" kicker="INVESTIGATOR TOOLS" title="Tool rail, spinner, legend, icons">
        <div className="g-three">
          <ToolRail tools={TOOLS} onSelect={(id) => announce(`${id} selected.`)} />
          <div className="g-stack">
            <div className="g-row">
              <HexSpinner size={64} label="Loading demo" />
              <div className="g-grow">
                <ProgressBar value={0.64} label="Preparing your expedition" variant="loading" />
              </div>
            </div>
            <Legend
              title="Subsidence"
              ramp={["#8F5236", "#C9784A", "#E2B08A"]}
              labels={["0", "−8", "−16"]}
              unit="cm / yr"
            />
            <Legend
              title="Forest"
              ramp={["#2F6B4C", "#4F8F6A", "#8DBF8A"]}
              labels={["sparse", "mixed", "dense"]}
              unit="cover"
            />
            <Legend
              title="Glacier"
              ramp={["#8FB8D4", "#BFE3F2", "#EAF6FB"]}
              labels={["thin", "mid", "thick"]}
              unit="m"
            />
            <Legend
              title="Wetland"
              ramp={["#2A7471", "#3E9C9A", "#8CCFC8"]}
              labels={["dry", "wet", "open"]}
              unit="index"
            />
          </div>
          <div className="g-icons">
            {ICON_NAMES.map((n) => (
              <span key={n} className="g-icon">
                <Icon name={n} />
                <span className="br-mono">{n}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="g-row g-mt">
          <Logo variant="ring" size={48} />
          <Logo variant="ring" size={24} />
          <Logo variant="lockup" size={48} />
          <KeyHint
            hints={[
              { key: "Enter", action: "Select" },
              { key: "Esc", action: "Back" },
            ]}
          />
        </div>
      </Section>

      <Section id="timeline" kicker="TIME LENS" title="Temporal watch">
        <TimelineDemo reducedMotion={reducedMotion} />
      </Section>

      <Section id="roi" kicker="SCANNER" title="Mark the region">
        <RoiDemo />
      </Section>

      <Section id="overlays" kicker="MODAL / WIPE / SOUND" title="Overlays and feedback">
        <div className="g-row">
          <Button icon="research" onClick={() => setModal(true)} data-testid="g-open-modal">
            Open mission modal
          </Button>
          <Button variant="secondary" icon="map" onClick={runWipe}>
            Run travel wipe
          </Button>
          {(["press", "confirm", "alert", "scan", "travel"] as SoundName[]).map((s) => (
            <Button key={s} variant="ghost" icon="sound" sound={false} onClick={() => playSound(s)}>
              {s}
            </Button>
          ))}
        </div>
        <Panel title="Announcements" kicker="LIVE REGION LOG" tone="ink">
          <ul className="g-log br-mono">
            {log.length === 0 ? (
              <li className="g-dim">— nothing announced yet</li>
            ) : (
              log.map((l, i) => <li key={`${i}${l}`}>{l}</li>)
            )}
          </ul>
        </Panel>
      </Section>

      <Modal
        open={modal}
        title="Ready for the field?"
        kicker="CASE_001 / BRIEFING"
        onClose={() => setModal(false)}
        footer={
          <>
            <Button icon="research" onClick={() => setModal(false)}>
              Review briefing
            </Button>
            <Button variant="secondary" onClick={() => setModal(false)}>
              Stay at hub
            </Button>
          </>
        }
      >
        <p>Your tools are prepared. Review the briefing before leaving the outpost.</p>
        <div className="g-row">
          <Badge kind="SIMULATED" />
          <Badge kind="OK" detail="TLE fresh" />
        </div>
      </Modal>
      <WipeOverlay
        phase={wipe}
        progress={wipeProgress}
        label="Preparing your expedition"
        reducedMotion={reducedMotion}
        durationMs={500}
        backgroundUrl={PLATE}
      />
      <LiveRegion />
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
