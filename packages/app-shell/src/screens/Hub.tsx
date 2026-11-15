import { Badge, Button, Icon } from "@blindrev/ui-hud";
import { useEffect, useState } from "react";
import { loadMission } from "../data/loaders";
import { nowDate } from "../env";
import { navigate } from "../scene/navigation";
import { currentScene, hubMissions, onSceneChange } from "../scene/sceneManager";
import { useApp, useReducedMotion } from "../store";
import type { HubRenderer } from "../types";
import { SignalMotif } from "./SignalMotif";
import "./ux-strike-1.css";

function useHubRenderer(): HubRenderer | null {
  const get = () => {
    const s = currentScene();
    return s?.kind === "hub" ? s.renderer : null;
  };
  const [r, setR] = useState<HubRenderer | null>(get);
  useEffect(() => onSceneChange(() => setR(get())), []);
  return r;
}

export function openBriefing(): void {
  void navigate("mission").then(() => useApp.setState({ overlay: "briefing" }));
}

function useClock(): string {
  const [t, setT] = useState(() => nowDate());
  useEffect(() => {
    const id = setInterval(() => setT(nowDate()), 1000);
    return () => clearInterval(id);
  }, []);
  return `${t.toISOString().slice(11, 19)} / ${t.toISOString().slice(0, 10)} UTC`;
}

export function HubScreen() {
  const mission = loadMission();
  const missions = hubMissions();
  const hub = useHubRenderer();
  const hubMode = useApp((s) => s.hubMode);
  const fallback = useApp((s) => s.hubFallbackReason);
  const focus = useApp((s) => s.hubFocus);
  const journal = useApp((s) => s.journal);
  const set = useApp((s) => s.set);
  const nisar = useApp((s) => s.nisar);
  const clock = useClock();
  const still = useReducedMotion();

  useEffect(() => {
    if (!hub) return;
    const offs = [
      hub.on("missionFocus", (id) => useApp.setState({ hubFocus: id })),
      hub.on("missionSelect", (id) => {
        const m = missions.find((x) => x.id === id);
        if (m && !m.locked) openBriefing();
      }),
    ];
    return () => {
      for (const o of offs) o();
    };
  }, [hub, missions]);

  useEffect(() => {
    hub?.setNisar(nisar);
  }, [hub, nisar]);

  const solved = journal.filter(
    (j) => j.missionId === mission.missionId && j.outcome.kind === "SCORE" && j.outcome.tier === "PASS",
  ).length;

  const pitch = mission.briefing.summary.split(/(?<=\.)\s/)[0] ?? mission.briefing.summary;
  return (
    <div className={`hub${still ? " is-still" : ""}`} data-testid="hub">
      {hubMode === "2d" && <CommandBoard2D focus={focus} />}
      {/* H's HUD-safe areas (16:9): keep x 12–88 %, y 12–78 % clear — the 3D board is the hero. */}
      <header className="hub__top">
        <div className="hub__brand">
          <h1 className="hub__title">Command board</h1>
          <span className="br-mono hub__clock">{clock}</span>
        </div>
        <div className="hub__topActions">
          {hubMode !== "3d" && (
            <Badge
              kind="INFO"
              detail={hubMode === "2d" ? `2D board${fallback ? ` — ${fallback}` : ""}` : "Hub fixture (?stub=1)"}
            />
          )}
          <Button variant="secondary" icon="journal" onClick={() => set({ overlay: "journal", overlayReturn: null })}>
            Journal{journal.length ? ` (${journal.length})` : ""}
          </Button>
          <Button variant="ghost" icon="settings" onClick={() => set({ overlay: "settings", overlayReturn: null })}>
            Settings
          </Button>
          <Button variant="ghost" icon="back" onClick={() => void navigate("menu")}>
            Menu
          </Button>
        </div>
      </header>

      <div className="hub__band" data-testid="hub-band">
        {/* First-time prompt: rides just above the band at every viewport size; gone once a world is focused. */}
        {focus === null && hubMode !== "2d" && (
          <p className="hub__prompt" data-testid="hub-prompt">
            <Icon name="target" size={16} />
            Pick a world to open its case
            <span className="hub__promptKeys">CLICK A WORLD / TAB + ENTER</span>
          </p>
        )}
        <section className="hub__case" aria-labelledby="hub-case-title">
          <p className="hub__caseLine">
            <span className="br-mono hub__caseId">{mission.caseId}</span>
            <strong id="hub-case-title" className="hub__caseTitle">
              {mission.title}
            </strong>
            {mission.labels.map((l) => (
              <Badge key={l} kind={l} />
            ))}
            {solved > 0 && <Badge kind="OK" detail={`Solved ×${solved}`} />}
          </p>
          <p className="br-body-s hub__pitch">{pitch}</p>
          <Button variant="primary" icon="evidence" onClick={openBriefing} data-testid="open-briefing" autoFocus>
            Open briefing
          </Button>
        </section>

        <nav className="hub__list" aria-label="Cases on the board">
          <ul>
            {missions.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`case-chip${focus === m.id ? " is-focus" : ""}${m.locked ? " is-locked" : ""}${focus === null && !m.locked ? " is-rest" : ""}`}
                  aria-disabled={m.locked}
                  aria-label={`${m.caseId.replace("CASE_0", "Case ")}: ${m.title}, ${m.kicker}${m.locked ? ", locked" : ", open"}`}
                  onFocus={() => {
                    hub?.focusMission(m.id);
                    useApp.setState({ hubFocus: m.id });
                  }}
                  onMouseEnter={() => hub?.focusMission(m.id)}
                  onBlur={() => hub?.focusMission(null)}
                  onClick={() => {
                    if (!m.locked) openBriefing();
                  }}
                >
                  <span className="case-chip__id br-mono">{m.caseId.replace("CASE_0", "")}</span>
                  <span className="case-chip__title">{m.title}</span>
                  <span className={`case-chip__state${m.locked ? "" : " is-open"}`}>
                    <Icon name={m.locked ? "locked" : "target"} size={16} />
                    {m.locked ? "Locked" : "Open"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <NisarLine nisar={nisar} />
      </div>
    </div>
  );
}

function NisarLine({ nisar }: { nisar: ReturnType<typeof useApp.getState>["nisar"] }) {
  const stale = useApp((s) => s.tleStale);
  const age = useApp((s) => s.tleAgeHours);
  const ageTxt = Math.abs(age) < 48 ? `${Math.abs(age).toFixed(1)} h` : `${(Math.abs(age) / 24).toFixed(1)} d`;
  const pos = nisar
    ? `${Math.abs(nisar.latDeg).toFixed(2)}°${nisar.latDeg >= 0 ? "N" : "S"} ${Math.abs(nisar.lonDeg).toFixed(2)}°${nisar.lonDeg >= 0 ? "E" : "W"} ${(nisar.heightM / 1000).toFixed(0)} km`
    : "—";
  return (
    <section className="hub__nisar" aria-label="NISAR position" data-testid="nisar-panel">
      <p className="br-mono hub__nisarLine">
        <span className="hub__nisarTag">NISAR</span> {pos}
      </p>
      <p className="hub__nisarMeta">
        {stale ? (
          <Badge kind="STALE_EPHEMERIS" detail={`TLE ${ageTxt} old`} />
        ) : (
          <Badge kind="OK" detail={`TLE ${ageTxt}`} />
        )}
        <span className="br-caption">Propagated from TLE — not live telemetry.</span>
      </p>
    </section>
  );
}

/** A1 kill fallback: static 2D Outpost Signal command board (DOM/SVG, no WebGL). */
export function CommandBoard2D({ focus }: { focus: string | null }) {
  const missions = hubMissions();
  return (
    <div className="board2d" aria-hidden="true" data-testid="hub-2d">
      <SignalMotif className="board2d__motif" />
      <div className="board2d__wall">
        {missions.map((m, i) => (
          <div
            key={m.id}
            className={`board2d__pin${m.locked ? " is-locked" : ""}${focus === m.id ? " is-focus" : ""}`}
            style={{ left: `${18 + i * 20}%`, top: `${i % 2 ? 58 : 40}%` }}
          >
            <span className="br-mono">{m.caseId}</span>
            <strong>{m.title}</strong>
            <span>{m.locked ? "Locked" : m.kicker}</span>
          </div>
        ))}
        <svg className="board2d__strings" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points="22,46 42,64 62,46 82,64" fill="none" stroke="rgba(242,180,65,0.6)" strokeWidth="0.25" />
        </svg>
      </div>
    </div>
  );
}
