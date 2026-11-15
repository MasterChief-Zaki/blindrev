// Outpost Signal sound — "soft analog beeps, low hum, warm clicks".
// WebAudio, lazy-unlocked on the first user gesture, silent no-op when disabled or unsupported.
// Files live in packages/app-shell/public/audio (see docs/decisions/U.md for the analysis + mapping).

export type SoundName = "press" | "confirm" | "alert" | "scan" | "travel";

export interface SoundOptions {
  /** URL of the folder holding the audio files, e.g. `new URL("audio/", document.baseURI).href`. */
  baseUrl: string;
}

/** Role → file (relative to baseUrl). `null` = synthesised (no supplied clip fits the role). */
export const SOUND_FILES: Record<SoundName, string | null> = {
  press: "ui-press.mp3",
  confirm: "ui-confirm.mp3",
  alert: null,
  scan: "scan-ping.mp3",
  travel: "travel-shutter.mp3",
};
export const AMBIENT_LOOP_FILE = "ambient-beacon-loop.mp3";

/** Per-role trim so every role sits at a comparable perceived loudness. */
const ROLE_GAIN: Record<SoundName, number> = {
  press: 0.55,
  confirm: 0.8,
  alert: 0.7,
  scan: 0.7,
  travel: 0.75,
};
const MIN_GAP_MS: Record<SoundName, number> = { press: 40, confirm: 150, alert: 250, scan: 120, travel: 300 };

type Ctx = AudioContext;

interface SoundState {
  baseUrl: string | null;
  enabled: boolean;
  volume: number;
  ctx: Ctx | null;
  master: GainNode | null;
  buffers: Map<string, AudioBuffer | "failed" | "loading">;
  ambientWanted: boolean;
  ambient: { stop: () => void } | null;
  lastPlayed: Map<SoundName, number>;
  unlockBound: boolean;
}

const state: SoundState = {
  baseUrl: null,
  enabled: true,
  volume: 0.6,
  ctx: null,
  master: null,
  buffers: new Map(),
  ambientWanted: false,
  ambient: null,
  lastPlayed: new Map(),
  unlockBound: false,
};

function audioCtor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;

function onGesture(): void {
  unlock();
}

function bindUnlock(): void {
  if (state.unlockBound || typeof window === "undefined") return;
  state.unlockBound = true;
  for (const g of GESTURES) window.addEventListener(g, onGesture, { capture: true, passive: true });
}

function unbindUnlock(): void {
  if (!state.unlockBound || typeof window === "undefined") return;
  state.unlockBound = false;
  for (const g of GESTURES) window.removeEventListener(g, onGesture, { capture: true });
}

/** Creates/resumes the AudioContext. Only ever called from a user gesture. */
function unlock(): void {
  const Ctor = audioCtor();
  if (!Ctor) {
    unbindUnlock();
    return;
  }
  try {
    if (!state.ctx) {
      state.ctx = new Ctor();
      state.master = state.ctx.createGain();
      state.master.gain.value = state.enabled ? state.volume : 0;
      state.master.connect(state.ctx.destination);
      preload();
    }
    if (state.ctx.state === "suspended") void state.ctx.resume().catch(() => undefined);
    if (state.ctx.state !== "closed") unbindUnlock();
    if (state.ambientWanted && !state.ambient) startAmbient();
  } catch {
    state.ctx = null;
    state.master = null;
  }
}

function preload(): void {
  for (const file of Object.values(SOUND_FILES)) if (file) void load(file);
  void load(AMBIENT_LOOP_FILE);
}

async function load(file: string): Promise<AudioBuffer | null> {
  const ctx = state.ctx;
  if (!ctx || !state.baseUrl) return null;
  const cached = state.buffers.get(file);
  if (cached && cached !== "loading" && cached !== "failed") return cached;
  if (cached === "failed" || cached === "loading") return null;
  state.buffers.set(file, "loading");
  try {
    const res = await fetch(new URL(file, state.baseUrl).href);
    if (!res.ok) throw new Error(String(res.status));
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    state.buffers.set(file, buf);
    if (file === AMBIENT_LOOP_FILE && state.ambientWanted && state.ambient) {
      // Re-start so the loaded beacon layer joins the hum.
      stopAmbient();
      startAmbient();
    }
    return buf;
  } catch {
    state.buffers.set(file, "failed");
    return null;
  }
}

function ready(): { ctx: Ctx; master: GainNode } | null {
  if (!state.enabled || !state.ctx || !state.master || state.ctx.state === "closed") return null;
  return { ctx: state.ctx, master: state.master };
}

// ---------------------------------------------------------------- synthesis (fallbacks + alert)

function env(ctx: Ctx, out: AudioNode, t0: number, attack: number, peak: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(out);
  return g;
}

function tone(
  ctx: Ctx,
  out: AudioNode,
  freq: number,
  t0: number,
  dur: number,
  peak: number,
  type: OscillatorType = "sine",
): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2400; // warm, analog-ish
  o.connect(lp);
  lp.connect(env(ctx, out, t0, 0.008, peak, dur));
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function synth(name: SoundName, ctx: Ctx, out: AudioNode): void {
  const t = ctx.currentTime + 0.005;
  switch (name) {
    case "press": // warm click
      tone(ctx, out, 1150, t, 0.035, 0.25, "triangle");
      break;
    case "confirm": // two rising soft beeps
      tone(ctx, out, 523.25, t, 0.16, 0.3, "triangle");
      tone(ctx, out, 783.99, t + 0.11, 0.28, 0.3, "triangle");
      break;
    case "alert": // soft descending two-tone — attention, never threatening
      tone(ctx, out, 659.25, t, 0.18, 0.32, "triangle");
      tone(ctx, out, 440, t + 0.17, 0.32, 0.32, "triangle");
      break;
    case "scan": // sonar-ish ping
      tone(ctx, out, 392, t, 0.9, 0.28, "sine");
      tone(ctx, out, 784, t, 0.5, 0.08, "sine");
      break;
    case "travel": {
      // filtered-noise shutter sweep, ~500 ms
      const len = Math.floor(ctx.sampleRate * 0.6);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let seed = 0x9e3779b9;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        d[i] = (seed / 0xffffffff) * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(2200, t + 0.5);
      src.connect(bp);
      bp.connect(env(ctx, out, t, 0.06, 0.35, 0.5));
      src.start(t);
      src.stop(t + 0.6);
      break;
    }
  }
}

// ---------------------------------------------------------------- ambient bed

function startAmbient(): void {
  const r = ready();
  if (!r || state.ambient) return;
  const { ctx, master } = r;
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, ctx.currentTime);
  bus.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.5);
  bus.connect(master);

  // Low hum: 55 Hz + 110 Hz through a slowly breathing low-pass.
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.09;
  lp.connect(humGain);
  humGain.connect(bus);
  const o1 = ctx.createOscillator();
  o1.type = "sine";
  o1.frequency.value = 55;
  const o2 = ctx.createOscillator();
  o2.type = "triangle";
  o2.frequency.value = 110.4; // slight detune → slow beating, analog feel
  const o2g = ctx.createGain();
  o2g.gain.value = 0.35;
  o1.connect(lp);
  o2.connect(o2g);
  o2g.connect(lp);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.03;
  lfo.connect(lfoDepth);
  lfoDepth.connect(humGain.gain);
  o1.start();
  o2.start();
  lfo.start();

  // Beacon layer: the supplied ping loop, very quiet (1.85 s period, seamless).
  let beacon: AudioBufferSourceNode | null = null;
  const buf = state.buffers.get(AMBIENT_LOOP_FILE);
  if (buf && buf !== "loading" && buf !== "failed") {
    beacon = ctx.createBufferSource();
    beacon.buffer = buf;
    beacon.loop = true;
    const bg = ctx.createGain();
    bg.gain.value = 0.35;
    beacon.connect(bg);
    bg.connect(bus);
    beacon.start();
  } else if (!buf) {
    void load(AMBIENT_LOOP_FILE);
  }

  state.ambient = {
    stop: () => {
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), now);
      bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      const end = now + 0.85;
      o1.stop(end);
      o2.stop(end);
      lfo.stop(end);
      beacon?.stop(end);
      setTimeout(() => bus.disconnect(), 1000);
    },
  };
}

function stopAmbient(): void {
  state.ambient?.stop();
  state.ambient = null;
}

// ---------------------------------------------------------------- public API

/** Configure the sound module. Safe to call more than once; never creates audio before a user gesture. */
export function initSound(opts: SoundOptions): void {
  state.baseUrl = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
  if (!audioCtor()) return; // unsupported → permanent silent no-op
  if (state.ctx) preload();
  else bindUnlock();
}

/** Plays one UI sound. Silent no-op before unlock, when disabled, unsupported or uninitialised. */
export function playSound(name: SoundName): void {
  const r = ready();
  if (!r) return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const last = state.lastPlayed.get(name) ?? -Infinity;
  if (now - last < MIN_GAP_MS[name]) return;
  state.lastPlayed.set(name, now);
  try {
    const { ctx, master } = r;
    const out = ctx.createGain();
    out.gain.value = ROLE_GAIN[name];
    out.connect(master);
    const file = SOUND_FILES[name];
    const buf = file ? state.buffers.get(file) : undefined;
    if (buf && buf !== "loading" && buf !== "failed") {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(out);
      src.onended = () => out.disconnect();
      src.start();
    } else {
      synth(name, ctx, out);
      setTimeout(() => out.disconnect(), 1500);
      if (file && !buf) void load(file);
    }
  } catch {
    /* never let sound break the UI */
  }
}

/** Low hum + quiet beacon loop. Remembers the wish; starts once audio is unlocked and enabled. */
export function setAmbient(on: boolean): void {
  state.ambientWanted = on;
  if (on) startAmbient();
  else stopAmbient();
}

export function setSoundEnabled(on: boolean): void {
  state.enabled = on;
  if (state.master && state.ctx) {
    state.master.gain.setTargetAtTime(on ? state.volume : 0, state.ctx.currentTime, 0.05);
  }
  if (!on) stopAmbient();
  else if (state.ambientWanted) startAmbient();
}

export function setVolume(v: number): void {
  state.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  if (state.master && state.ctx && state.enabled) {
    state.master.gain.setTargetAtTime(state.volume, state.ctx.currentTime, 0.05);
  }
}

/** Read-only snapshot for settings UIs and tests. */
export function getSoundStatus(): {
  supported: boolean;
  unlocked: boolean;
  enabled: boolean;
  volume: number;
  ambient: boolean;
} {
  return {
    supported: audioCtor() !== null,
    unlocked: state.ctx !== null && state.ctx.state === "running",
    enabled: state.enabled,
    volume: state.volume,
    ambient: state.ambient !== null,
  };
}
