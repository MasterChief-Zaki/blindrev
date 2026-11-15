/**
 * Spike A2 adversarial camera suite. Drives the REAL input paths (window keydown/keyup, canvas
 * wheel and pointer events) of the custom ENU controller and records, every frame, the camera
 * height against (a) the clamp floor the controller applied and (b) the ground truth terrain.
 */
import type { OrbitCamState } from "@blindrev/core-sim";
import type { CameraFrameSample, GlobeRendererImpl } from "../src/globe";

export interface ScenarioResult {
  name: string;
  frames: number;
  minAboveTruthM: number; // min(camera height − true terrain under camera); < 0 = underground
  minAboveFloorM: number; // min(camera height − applied clamp floor); ≥ 0 by construction
  minAboveTruthPlusClearanceM: number; // min(camera height − (truth + minClearance))
  nanFrames: number;
  fps: number;
  frameP50Ms: number;
  frameP95Ms: number;
  notes: string;
}

const sleepFrames = (n: number): Promise<void> =>
  new Promise((res) => {
    let k = 0;
    const f = (): void => {
      if (++k >= n) res();
      else requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function key(code: string, down: boolean): void {
  window.dispatchEvent(
    new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code.replace("Key", "").toLowerCase(), bubbles: true }),
  );
}

async function hold(codes: string[], ms: number): Promise<void> {
  for (const c of codes) key(c, true);
  await sleep(ms);
  for (const c of codes) key(c, false);
}

function wheel(canvas: HTMLCanvasElement, deltaY: number): void {
  const r = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new WheelEvent("wheel", {
      deltaY,
      deltaMode: 0,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function drag(canvas: HTMLCanvasElement, dx: number, dy: number, steps: number, button = 0): Promise<void> {
  const r = canvas.getBoundingClientRect();
  let x = r.left + r.width / 2;
  let y = r.top + r.height / 2;
  const base = {
    pointerId: 7,
    pointerType: "mouse",
    bubbles: true,
    cancelable: true,
    button,
    buttons: button === 2 ? 2 : 1,
  };
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: x, clientY: y }));
  for (let i = 0; i < steps; i++) {
    x += dx / steps;
    y += dy / steps;
    canvas.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: x, clientY: y }));
    await sleepFrames(1);
  }
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: x, clientY: y }));
}

/** Seeded PRNG (mulberry32) so gap patterns are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Steep synthetic terrain: 3000 m plateaus separated by near-vertical walls every ~0.02°. */
function cliffTerrain(lonRad: number, latRad: number): number {
  const lon = (lonRad * 180) / Math.PI;
  const lat = (latRad * 180) / Math.PI;
  const a = Math.sin(lon * 157) + Math.sin(lat * 131);
  return a > 0.3 ? 3000 : a > -0.3 ? 3000 * ((a + 0.3) / 0.6) : 0;
}

/** Ramp terrain: a 45° slope (1 m up per metre east) capped at 6000 m. */
function rampTerrain(lonRad: number, latRad: number): number {
  const xM = ((lonRad * 180) / Math.PI + 120) * 111320 * Math.cos(latRad);
  return Math.max(0, Math.min(6000, xM));
}

async function scenario(
  g: GlobeRendererImpl,
  name: string,
  setup: {
    cam: OrbitCamState;
    sampler?: ((lon: number, lat: number) => number | undefined) | null;
    truth?: ((lon: number, lat: number) => number) | null;
  },
  drive: () => Promise<void>,
  notes: string,
  clearance: number,
): Promise<ScenarioResult> {
  g.debug.heightSampler = setup.sampler ?? null;
  g.debug.truthTerrain = setup.truth ?? null;
  g.resetTerrainMemory();
  g.setCamState(setup.cam);
  await sleepFrames(10);
  let minTruth = Infinity;
  let minFloor = Infinity;
  let minTC = Infinity;
  let nan = 0;
  let frames = 0;
  g.debug.onCameraFrame = (s: CameraFrameSample) => {
    frames++;
    if (s.nan || !Number.isFinite(s.heightM)) {
      nan++;
      return;
    }
    if (Number.isFinite(s.truthTerrainM)) {
      minTruth = Math.min(minTruth, s.heightM - s.truthTerrainM);
      minTC = Math.min(minTC, s.heightM - (s.truthTerrainM + clearance));
    }
    minFloor = Math.min(minFloor, s.heightM - s.clampFloorM);
  };
  const deltas: number[] = [];
  let last = performance.now();
  let running = true;
  const tick = (t: number): void => {
    deltas.push(t - last);
    last = t;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const t0 = performance.now();
  await drive();
  await sleepFrames(5);
  running = false;
  const elapsed = (performance.now() - t0) / 1000;
  g.debug.onCameraFrame = null;
  g.debug.heightSampler = null;
  g.debug.truthTerrain = null;
  const sorted = deltas.slice(2).sort((a, b) => a - b);
  const pct = (p: number): number =>
    sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number) : Number.NaN;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  return {
    name,
    frames,
    minAboveTruthM: r2(minTruth),
    minAboveFloorM: r2(minFloor),
    minAboveTruthPlusClearanceM: r2(minTC),
    nanFrames: nan,
    fps: r2(deltas.length / elapsed),
    frameP50Ms: r2(pct(0.5)),
    frameP95Ms: r2(pct(0.95)),
    notes,
  };
}

export async function runA2(
  g: GlobeRendererImpl,
  canvas: HTMLCanvasElement,
  clearance: number,
): Promise<{ results: ScenarioResult[]; pass: boolean }> {
  const results: ScenarioResult[] = [];
  const rnd = mulberry32(2026);

  // 1. North pole: drive forward/back/sideways at the latitude wall, rotate while there.
  results.push(
    await scenario(
      g,
      "pole-north",
      { cam: { lonDeg: 10, latDeg: 89.4, rangeM: 3000, headingDeg: 0, pitchDeg: -60 } },
      async () => {
        await hold(["KeyW"], 1500);
        await hold(["KeyW", "KeyD"], 800);
        await hold(["KeyE"], 600);
        await hold(["KeyW", "KeyA", "KeyX"], 800);
      },
      "|lat| walled at 89.5°; W/D/A/E/X keyboard-only",
      clearance,
    ),
  );
  // 2. South pole straight down, then zoom in hard with the wheel.
  results.push(
    await scenario(
      g,
      "pole-south",
      { cam: { lonDeg: -45, latDeg: -89.45, rangeM: 5000, headingDeg: 180, pitchDeg: -90 } },
      async () => {
        await hold(["KeyW"], 1200);
        for (let i = 0; i < 30; i++) {
          wheel(canvas, -240);
          await sleepFrames(1);
        }
        await hold(["KeyS", "KeyQ"], 800);
      },
      "pitch −90° at the wall + wheel zoom to rangeMin",
      clearance,
    ),
  );
  // 3. Antimeridian sweep east then west at low range.
  results.push(
    await scenario(
      g,
      "antimeridian",
      { cam: { lonDeg: 179.95, latDeg: -17, rangeM: 2000, headingDeg: 90, pitchDeg: -35 } },
      async () => {
        await hold(["KeyW"], 1500); // heading 90 → forward = east, crosses +180
        await hold(["KeyS"], 2000); // back west across −180/+180
        await hold(["KeyD", "KeyR"], 800);
      },
      "crosses ±180 both ways; heading 90",
      clearance,
    ),
  );
  // 4. Steep synthetic terrain (3000 m walls), low pitch, keyboard + wheel to rangeMin.
  results.push(
    await scenario(
      g,
      "steep-cliffs",
      {
        cam: { lonDeg: -119.9, latDeg: 36.0, rangeM: 4000, headingDeg: 45, pitchDeg: -15 },
        sampler: cliffTerrain,
        truth: cliffTerrain,
      },
      async () => {
        for (let i = 0; i < 20; i++) {
          wheel(canvas, -300);
          await sleepFrames(1);
        }
        await hold(["KeyW"], 1500);
        await hold(["KeyW", "KeyD", "KeyF"], 1000);
        await hold(["KeyA", "KeyZ"], 800);
      },
      "3000 m walls every ~0.02°, pitch −15°, sampler = truth",
      clearance,
    ),
  );
  // 5. 45° ramp up to 6000 m, flying uphill at minimum range.
  results.push(
    await scenario(
      g,
      "ramp-45deg",
      {
        cam: { lonDeg: -119.99, latDeg: 36.0, rangeM: 800, headingDeg: 90, pitchDeg: -20 },
        sampler: rampTerrain,
        truth: rampTerrain,
      },
      async () => {
        await hold(["KeyW"], 2500);
        await hold(["KeyZ", "KeyW"], 1000);
      },
      "uphill 1:1 slope, rangeMin, pitch −20°",
      clearance,
    ),
  );
  // 6. Forced terrain gaps: 50 % of samples undefined (seeded) over steep cliffs.
  results.push(
    await scenario(
      g,
      "terrain-gaps-50pct",
      {
        cam: { lonDeg: -119.9, latDeg: 36.0, rangeM: 3000, headingDeg: 300, pitchDeg: -25 },
        sampler: (lo, la) => (rnd() < 0.5 ? undefined : cliffTerrain(lo, la)),
        truth: cliffTerrain,
      },
      async () => {
        await hold(["KeyW"], 1500);
        for (let i = 0; i < 15; i++) {
          wheel(canvas, -300);
          await sleepFrames(1);
        }
        await hold(["KeyD", "KeyW"], 1200);
      },
      "getHeight stubbed → undefined for 50 % of samples (seeded), truth = cliffs",
      clearance,
    ),
  );
  // 7. Total gap: getHeight always undefined while terrain under the camera rises (worst case).
  results.push(
    await scenario(
      g,
      "terrain-gap-total-uphill",
      {
        cam: { lonDeg: -119.995, latDeg: 36.0, rangeM: 800, headingDeg: 90, pitchDeg: -20 },
        sampler: () => undefined,
        truth: rampTerrain,
      },
      async () => {
        await hold(["KeyW"], 2000);
      },
      "ALL samples undefined (no tile loaded) while flying up a 1:1 ramp — last-known + clearance only",
      clearance,
    ),
  );
  // 8. Pointer drag pan + right-drag rotate/tilt + keyboard on real (ellipsoid / world) terrain.
  results.push(
    await scenario(
      g,
      "pointer-and-keys-real-terrain",
      { cam: { lonDeg: -119.95, latDeg: 36.05, rangeM: 1500, headingDeg: 0, pitchDeg: -30 } },
      async () => {
        await drag(canvas, 400, 250, 30);
        await drag(canvas, -300, 120, 30, 2);
        await hold(["KeyF"], 1500);
        await hold(["KeyX"], 600);
        for (let i = 0; i < 20; i++) {
          wheel(canvas, -400);
          await sleepFrames(1);
        }
      },
      "drag pan, right-drag rotate/tilt, F to pitch −90, wheel to rangeMin; real globe heights",
      clearance,
    ),
  );
  // terrain-gap-total-* is informative: terrain that was never observed cannot be avoided by any clamp.
  const gated = results.filter((r) => !r.name.startsWith("terrain-gap-total"));
  const pass = gated.every((r) => r.nanFrames === 0 && r.minAboveFloorM >= -0.01 && r.minAboveTruthM >= 0);
  return { results, pass };
}
