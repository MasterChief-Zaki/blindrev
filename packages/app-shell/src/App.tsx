import { LiveRegion, WipeOverlay } from "@blindrev/ui-hud";
import { useEffect, useRef } from "react";
import { loadPrefabs } from "./data/loaders";
import { assetUrl, env } from "./env";

const plateUrl = assetUrl("art/outpost-plate.jpg");
import { HarnessDrawer } from "./harness/HarnessDrawer";
import { setSceneRoot } from "./scene/sceneManager";
import { HubScreen } from "./screens/Hub";
import { MenuScreen } from "./screens/Menu";
import { MissionScreen } from "./screens/Mission";
import {
  BriefingModal,
  CreditsModal,
  JournalModal,
  ResultsModal,
  RoiEditorModal,
  SettingsModal,
} from "./screens/Overlays";
import { SrSummary } from "./screens/SrSummary";
import { DataTunnel } from "./screens/Transit";
import { skipTunnel } from "./scene/navigation";
import { useApp, useReducedMotion } from "./store";

export function App() {
  const route = useApp((s) => s.route);
  const overlay = useApp((s) => s.overlay);
  const wipe = useApp((s) => s.wipe);
  const bootError = useApp((s) => s.bootError);
  const rm = useReducedMotion();
  const sceneRef = useRef<HTMLDivElement>(null);
  const durationMs = loadPrefabs().constants.wipe.durationMs;

  useEffect(() => {
    setSceneRoot(sceneRef.current);
    return () => setSceneRoot(null);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("br-reduced-motion", rm);
  }, [rm]);

  return (
    <div className={`app app--${route}`} data-route={route}>
      <div ref={sceneRef} className="scene-root" data-testid="scene-root" />
      <div className="hud-root">
        {route === "menu" && <MenuScreen />}
        {route === "hub" && <HubScreen />}
        {route === "mission" && <MissionScreen />}
      </div>
      {overlay === "briefing" && <BriefingModal />}
      {overlay === "results" && <ResultsModal />}
      {overlay === "roi-editor" && <RoiEditorModal />}
      {overlay === "journal" && <JournalModal />}
      {overlay === "settings" && <SettingsModal />}
      {overlay === "credits" && <CreditsModal />}
      <SrSummary />
      <WipeOverlay
        phase={wipe.phase}
        progress={wipe.progress}
        label={wipe.slow ? "Still fetching imagery. Hang on" : wipe.label}
        reducedMotion={rm}
        durationMs={durationMs}
        backgroundUrl={plateUrl}
        showWordmark
      />
      {wipe.phase === "covered" && wipe.mode === "tunnel" && <DataTunnel onSkip={skipTunnel} />}
      {bootError && (
        <div className="boot-error" role="alert">
          <strong>That screen didn't load. Dismiss this and try again.</strong>{" "}
          <span className="br-mono">{bootError}</span>
          <button type="button" onClick={() => useApp.setState({ bootError: null })}>
            Dismiss
          </button>
        </div>
      )}
      {env.harness && <HarnessDrawer />}
      <LiveRegion />
    </div>
  );
}
