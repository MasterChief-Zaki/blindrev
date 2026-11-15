/* Wires the ui-hud sound module into the settings-gated cue facade (mission/sound.ts). */
import { initSound, playSound, setAmbient, setSoundEnabled, setVolume } from "@blindrev/ui-hud";
import { assetUrl } from "../env";
import { useApp } from "../store";
import { type Cue, setSoundPlayer } from "./sound";

const MAP: Record<Cue, "press" | "confirm" | "alert" | "scan" | "travel"> = {
  tick: "scan",
  confirm: "confirm",
  alert: "alert",
  wipe: "travel",
  select: "press",
};

export function installSound(): void {
  try {
    initSound({ baseUrl: assetUrl("audio/") });
    const apply = () => {
      const { sound, volume } = useApp.getState().settings;
      setSoundEnabled(sound);
      setVolume(volume);
    };
    apply();
    setSoundPlayer((cue) => playSound(MAP[cue]));
    useApp.subscribe((s, p) => {
      if (s.settings !== p.settings) apply();
      if (s.route !== p.route) setAmbient(s.route === "hub");
    });
  } catch (e) {
    console.warn("[sound] unavailable", e);
    setSoundPlayer(null);
  }
}
