/* Thin facade over the ui-hud sound module (settings-gated). Swapped to the real module once U lands. */
import { useApp } from "../store";

export type Cue = "tick" | "confirm" | "alert" | "wipe" | "select";

type Player = (cue: Cue, volume: number) => void;
let player: Player | null = null;

export function setSoundPlayer(p: Player | null): void {
  player = p;
}

export function playCue(cue: Cue): void {
  const { sound, volume } = useApp.getState().settings;
  if (!sound || !player) return;
  try {
    player(cue, volume);
  } catch {
    /* audio is optional */
  }
}
