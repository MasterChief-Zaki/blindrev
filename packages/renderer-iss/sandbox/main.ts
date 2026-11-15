import "@fontsource/outfit/600.css";
import "@fontsource/outfit/800.css";
import "@fontsource/ibm-plex-mono/400.css";
import type { QualityPreset } from "@blindrev/core-sim";
import { createHubRenderer, type HubRendererInternal } from "../src/hub";
import type { HubMission, HubOrbitState } from "../src/types";

/**
 * URL params: ?rm=1 (reduced motion) · ?q=low|medium|high · ?focus=<missionId> · ?view=bloomMask
 *             ?nisar=0 (no ephemeris) · ?clean=1 (hide status text) · ?hover=<0..3> (simulate pointer hover)
 */
const params = new URLSearchParams(location.search);
const PRESETS: Record<string, QualityPreset> = {
  low: { id: "low", tileCacheSize: 100, maximumScreenSpaceError: 4, renderScale: 0.75, allow4k: false },
  medium: { id: "medium", tileCacheSize: 200, maximumScreenSpaceError: 2, renderScale: 1.0, allow4k: false },
  high: { id: "high", tileCacheSize: 400, maximumScreenSpaceError: 1.5, renderScale: 1.0, allow4k: true },
};
const quality = PRESETS[params.get("q") ?? "medium"] ?? (PRESETS.medium as QualityPreset);
const reducedMotion = params.get("rm") === "1";
if (params.get("clean") === "1") document.body.classList.add("clean");

const missions: HubMission[] = [
  {
    id: "sinking-city",
    caseId: "CASE_001",
    title: "The Sinking City",
    kicker: "Ground deformation · San Joaquin Valley",
    theme: "subsidence",
    locked: false,
  },
  {
    id: "green-kingdom",
    caseId: "CASE_002",
    title: "The Green Kingdom",
    kicker: "Forests and vegetation",
    theme: "deforestation",
    locked: true,
  },
  {
    id: "drowned-world",
    caseId: "CASE_003",
    title: "The Drowned World",
    kicker: "Wetlands and water",
    theme: "wetlands",
    locked: true,
  },
  {
    id: "frozen-frontier",
    caseId: "CASE_004",
    title: "The Frozen Frontier",
    kicker: "Ice and glaciers",
    theme: "glacier",
    locked: true,
  },
];

/** SAMPLE (sandbox only): a fixed sub-satellite state over California; not propagated. */
const sampleNisar: HubOrbitState = {
  timeIso: "2026-11-15T17:42:08Z",
  lonDeg: -119.6,
  latDeg: 36.4,
  heightM: 747000,
  velEcefMps: { x: 1200, y: -900, z: -7300 },
};

const container = document.getElementById("hub") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const log: string[] = [];
const say = (s: string): void => {
  log.push(s);
  status.textContent = log.slice(-8).join("\n");
};

let hub: HubRendererInternal | null = null;
function mount(): HubRendererInternal {
  const h = createHubRenderer({
    container,
    missions,
    quality,
    reducedMotion,
    nisar: params.get("nisar") === "0" ? null : sampleNisar,
  });
  h.on("missionFocus", (id) => say(`missionFocus ${id}`));
  h.on("missionSelect", (id) => say(`missionSelect ${id}`));
  h.on("contextLost", () => say("contextLost"));
  h.on("contextRestored", () => say("contextRestored"));
  return h;
}
hub = mount();
const t0 = performance.now();
hub.ready
  .then(() => {
    say(`ready in ${Math.round(performance.now() - t0)} ms (${quality.id}${reducedMotion ? ", reduced motion" : ""})`);
    const f = params.get("focus");
    if (f) hub?.focusMission(f);
    if (params.get("view") === "bloomMask") hub?.__debug.setView("bloomMask");
    const hv = params.get("hover");
    if (hv !== null) simulateHover(Number(hv));
    (window as unknown as { __hubReady: boolean }).__hubReady = true;
  })
  .catch((e: unknown) => say(`ready rejected: ${String(e)}`));

/** Synthesises a pointermove over the label of slot i (projects its world position). */
function simulateHover(i: number): void {
  const c = hub?.getCanvas();
  const p = hub?.__debug.labelScreenPos(i);
  if (!c || !p) return;
  const [x, y] = p;
  c.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
}

// Harness handle for the measurement scripts (tools are in docs/reports/hub-renderer.md).
(window as unknown as Record<string, unknown>).__hub = {
  get: () => hub,
  remount: async () => {
    hub?.destroy();
    hub = mount();
    await hub.ready;
    return true;
  },
  destroy: () => {
    hub?.destroy();
    hub = null;
  },
};
