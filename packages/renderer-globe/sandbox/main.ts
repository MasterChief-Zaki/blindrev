/**
 * Globe sandbox: exercises the whole renderer-globe API with the real mission manifest when D's
 * data exists (fixture otherwise). URL params (all optional):
 *   view=orbit|aoi|track|oblique   step=<index>   qa=1   ref=1   ctx=<layerId|first>   roi=ref|invalid|none
 *   track=1   anno=1   logdepth=0|1   custom=0|1   offline=1   quality=low|medium|high   ui=0   reduced=1
 *   cam=lon,lat,range,heading,pitch   ion=<token>
 * window.__sandbox exposes { renderer, runA2, fps, loseContext, ... } for tools/shot.mjs --eval.
 */
import {
  type CameraConfig,
  type LonLat,
  type MissionManifest,
  nadirGroundTrack,
  type OrbitState,
  parseCameraConfig,
  parseMissionManifest,
  parseQualityPresets,
  propagateTle,
  type QualityPreset,
  tleFromSnapshot,
  validateRoi,
} from "@blindrev/core-sim";
import { createGlobeRenderer, type GlobeAnnotation, type GlobeLayer, type GlobeRenderer } from "../src/index";
import type { GlobeRendererImpl } from "../src/globe";
import { runA2 } from "./a2";
import { buildFixtureMission, FIXTURE_BASEMAP } from "./fixture";

const qs = new URLSearchParams(location.search);
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as unknown;
  } catch {
    return null;
  }
}

async function loadInputs(): Promise<{
  mission: MissionManifest;
  missionSource: string;
  basemap: unknown;
  camera: CameraConfig;
  quality: QualityPreset[];
  tle: unknown;
}> {
  const [m, b, c, q, t] = await Promise.all([
    fetchJson("/__data/missions/sinking-city.json"),
    fetchJson("/__data/prefabs/basemap.json"),
    fetchJson("/__data/prefabs/camera.json"),
    fetchJson("/__data/prefabs/quality.json"),
    fetchJson("/__data/tle/nisar-65053.snapshot.json"),
  ]);
  let mission: MissionManifest;
  let missionSource = "data/missions/sinking-city.json";
  if (m && qs.get("fixture") !== "1") {
    try {
      mission = parseMissionManifest(m, missionSource);
    } catch (err) {
      console.warn("[sandbox] manifest failed validation, using it unvalidated", err);
      mission = m as MissionManifest;
      missionSource += " (UNVALIDATED)";
    }
  } else {
    mission = buildFixtureMission();
    missionSource = "TEST_FIXTURE (sandbox)";
  }
  return {
    mission,
    missionSource,
    basemap: b ?? FIXTURE_BASEMAP,
    camera: parseCameraConfig(c),
    quality: parseQualityPresets(q),
    tle: t,
  };
}

function fpsSample(ms: number): Promise<{ fps: number; p50: number; p95: number; frames: number }> {
  return new Promise((res) => {
    const d: number[] = [];
    let last = performance.now();
    const t0 = last;
    const f = (t: number): void => {
      d.push(t - last);
      last = t;
      if (t - t0 < ms) requestAnimationFrame(f);
      else {
        const s = d.slice(2).sort((a, b) => a - b);
        const pct = (p: number): number =>
          Math.round((s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? Number.NaN) * 100) / 100;
        res({
          fps: Math.round((d.length / ((t - t0) / 1000)) * 10) / 10,
          p50: pct(0.5),
          p95: pct(0.95),
          frames: d.length,
        });
      }
    };
    requestAnimationFrame(f);
  });
}

async function main(): Promise<void> {
  const inp = await loadInputs();
  const { mission } = inp;
  const qualityId = qs.get("quality") ?? "medium";
  const quality = inp.quality.find((p) => p.id === qualityId) ?? (inp.quality[1] as QualityPreset);
  const custom = qs.get("custom") !== "0";
  if (qs.get("ui") === "0") {
    $("panel").classList.add("hidden");
    $("probe").classList.add("hidden");
  }

  let renderer: GlobeRenderer = createGlobeRenderer({
    container: $("globe"),
    mission,
    quality,
    cameraConfig: inp.camera,
    basemap: inp.basemap,
    ionToken: qs.get("ion") ?? ((import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined) || null),
    reducedMotion: qs.get("reduced") === "1",
    useCustomCamera: custom,
    offlineOnly: qs.get("offline") === "1",
  });
  const impl = (): GlobeRendererImpl => renderer as unknown as GlobeRendererImpl;
  if (qs.has("logdepth")) impl().setLogDepth(qs.get("logdepth") === "1");

  const log: string[] = [];
  let lastStatus = renderer.getStatus();
  let lastCam = { lonDeg: 0, latDeg: 0, heightM: 0 };
  let progress = { loaded: 0, pending: 0 };
  const events = { roiVertexAdded: 0, roiCloseRequested: 0, contextLost: 0, contextRestored: 0 };
  let draw = false;
  const wire = (r: GlobeRenderer): void => {
    r.on("status", (s) => {
      lastStatus = s;
      render();
    });
    r.on("camera", (c) => {
      lastCam = c;
      render();
    });
    r.on("progress", (p) => {
      progress = p;
    });
    r.on("pointer", (p) => {
      $("probe").textContent = p ? `${p.lat.toFixed(5)}°, ${p.lon.toFixed(5)}°` : "—";
    });
    r.on("roiVertexAdded", (v) => {
      events.roiVertexAdded++;
      if (roi.closed) roi = { vertices: [], closed: false };
      roi.vertices.push(v);
      pushRoi();
    });
    r.on("roiCloseRequested", () => {
      events.roiCloseRequested++;
      if (roi.vertices.length >= 3) roi.closed = true;
      pushRoi();
    });
    r.on("contextLost", () => {
      events.contextLost++;
      log.push(`contextLost @${Math.round(performance.now())}`);
    });
    r.on("contextRestored", () => {
      events.contextRestored++;
      log.push(`contextRestored @${Math.round(performance.now())}`);
    });
  };
  wire(renderer);

  // ── mission state driven by the sandbox
  let stepIndex = Math.min(mission.steps.length - 1, Math.max(0, Number(qs.get("step") ?? firstAvailable())));
  function firstAvailable(): number {
    const i = mission.steps.findIndex((s) => s.isAvailable);
    return Math.max(i, 0);
  }
  let roi: { vertices: LonLat[]; closed: boolean } = { vertices: [], closed: false };
  let roiValid = true;
  const pushRoi = (): void => {
    if (roi.closed) {
      const v = validateRoi(roi.vertices, { roiAreaMinKm2: 25, roiAreaMaxKm2: 2500 });
      roiValid = v.ok;
    } else roiValid = true;
    renderer.setRoi(roi.vertices, {
      closed: roi.closed,
      valid: roiValid,
      selectedIndex: roi.closed ? null : roi.vertices.length - 1,
    });
    render();
  };
  const applyStep = (): void => {
    renderer.setStep(mission.steps[stepIndex] ?? null);
    render();
  };
  applyStep();

  const roiMode = qs.get("roi");
  if (roiMode === "ref" && mission.referencePolygons[0]) {
    roi = { vertices: mission.referencePolygons[0].map((p) => ({ ...p })), closed: true };
    pushRoi();
  } else if (roiMode === "invalid") {
    const b = mission.effectiveBounds;
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    const w = (b[2] - b[0]) / 4;
    const h = (b[3] - b[1]) / 4;
    roi = {
      vertices: [
        { lon: cx - w, lat: cy + h },
        { lon: cx + w, lat: cy - h },
        { lon: cx + w, lat: cy + h },
        { lon: cx - w, lat: cy - h },
      ],
      closed: true,
    };
    pushRoi();
  } else if (roiMode === "open" && mission.referencePolygons[0]) {
    roi = { vertices: mission.referencePolygons[0].slice(0, 3).map((p) => ({ ...p })), closed: false };
    pushRoi();
  }
  if (qs.get("qa") === "1") renderer.setLayerVisible("qa", true);
  if (qs.get("ref") === "1") renderer.setLayerVisible("referenceMask", true);
  const ctx = qs.get("ctx");
  if (ctx) renderer.setContextLayer(ctx === "first" ? (mission.contextLayers[0]?.layerId ?? null) : ctx);
  if (qs.get("draw") === "1") renderer.setRoiDrawMode(true);

  let track: OrbitState[] | null = null;
  let current: OrbitState | null = null;
  const tleSnap = inp.tle as { name: string; line1: string; line2: string } | null;
  const computeTrack = (): void => {
    if (!tleSnap) return;
    const tle = tleFromSnapshot(tleSnap);
    let at = qs.get("t") && qs.get("t") !== "aoipass" ? new Date(qs.get("t") as string) : new Date();
    if (qs.get("t") === "aoipass") {
      // Closest NISAR nadir approach to the AOI centre in the next 48 h (30 s steps).
      const b = mission.effectiveBounds;
      const cx = (b[0] + b[2]) / 2;
      const cy = (b[1] + b[3]) / 2;
      let best = Number.POSITIVE_INFINITY;
      const t0 = Date.parse("2026-11-15T12:00:00Z");
      for (let k = 0; k < 48 * 120; k++) {
        const o = propagateTle(tle, new Date(t0 + k * 30000));
        if (!o) continue;
        const d = Math.hypot((o.lonDeg - cx) * Math.cos((cy * Math.PI) / 180), o.latDeg - cy);
        if (d < best) {
          best = d;
          at = new Date(t0 + k * 30000);
        }
      }
    }
    track = nadirGroundTrack(tle, new Date(at.getTime() - 50 * 60 * 1000), 100 * 60, 30);
    current = propagateTle(tle, at);
  };
  if (qs.get("track") === "1") {
    computeTrack();
    renderer.setGroundTrack(track, current);
  }
  if (qs.get("anno") === "1") renderer.setAnnotations(demoAnnotations(mission));

  const view = qs.get("view") ?? "aoi";
  const camParam = qs.get("cam");
  if (camParam) {
    const [lonDeg, latDeg, rangeM, headingDeg, pitchDeg] = camParam.split(",").map(Number) as number[];
    impl().setCamState({
      lonDeg: lonDeg ?? 0,
      latDeg: latDeg ?? 0,
      rangeM: rangeM ?? 1e7,
      headingDeg: headingDeg ?? 0,
      pitchDeg: pitchDeg ?? -90,
    });
  } else if (view === "aoi") {
    const a = mission.camera.aoi;
    impl().setCamState({ lonDeg: a.lon, latDeg: a.lat, rangeM: a.heightM, headingDeg: 0, pitchDeg: -90 });
  } else if (view === "oblique") {
    const a = mission.camera.aoi;
    impl().setCamState({ lonDeg: a.lon, latDeg: a.lat, rangeM: a.heightM * 1.1, headingDeg: 20, pitchDeg: -45 });
  } else if (view === "track" && current) {
    const c = current as OrbitState;
    impl().setCamState({ lonDeg: c.lonDeg - 8, latDeg: c.latDeg - 6, rangeM: 4.5e6, headingDeg: 35, pitchDeg: -30 });
  }

  // ── panel
  const layers: GlobeLayer[] = ["evidence", "qa", "context", "referenceMask", "groundTrack", "aoiOutline"];
  const vis: Record<GlobeLayer, boolean> = {
    evidence: true,
    qa: qs.get("qa") === "1",
    context: true,
    referenceMask: qs.get("ref") === "1",
    groundTrack: true,
    aoiOutline: true,
  };
  const btn = (parent: HTMLElement, label: string, fn: () => void, id?: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    if (id) b.id = id;
    b.addEventListener("click", fn);
    parent.appendChild(b);
    return b;
  };
  const stepRow = $("stepRow");
  btn(stepRow, "◀ step", () => {
    stepIndex = Math.max(0, stepIndex - 1);
    applyStep();
  });
  btn(stepRow, "step ▶", () => {
    stepIndex = Math.min(mission.steps.length - 1, stepIndex + 1);
    applyStep();
  });
  const layerRow = $("layerRow");
  for (const l of layers) {
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = vis[l];
    cb.addEventListener("change", () => {
      vis[l] = cb.checked;
      renderer.setLayerVisible(l, cb.checked);
    });
    lab.append(cb, l);
    layerRow.appendChild(lab);
  }
  const op = document.createElement("input");
  op.type = "range";
  op.min = "0";
  op.max = "1";
  op.step = "0.05";
  op.value = "0.85";
  op.addEventListener("input", () => renderer.setLayerOpacity("evidence", Number(op.value)));
  const opl = document.createElement("label");
  opl.append("evidence opacity", op);
  layerRow.appendChild(opl);
  const ctxSel = document.createElement("select");
  ctxSel.append(new Option("context: none", ""));
  for (const c of mission.contextLayers) ctxSel.append(new Option(c.title, c.layerId));
  ctxSel.addEventListener("change", () => renderer.setContextLayer(ctxSel.value || null));
  layerRow.appendChild(ctxSel);

  const act = $("actionRow");
  btn(act, "home", () => renderer.flyTo("home"));
  btn(act, "aoi", () => renderer.flyTo("aoi"));
  draw = qs.get("draw") === "1";
  btn(act, "draw ROI", () => {
    draw = !draw;
    renderer.setRoiDrawMode(draw);
    render();
  });
  btn(act, "clear ROI", () => {
    roi = { vertices: [], closed: false };
    pushRoi();
  });
  btn(act, "track", () => {
    computeTrack();
    renderer.setGroundTrack(track, current);
  });
  btn(act, "annotations", () => renderer.setAnnotations(demoAnnotations(mission)));
  btn(act, "lose ctx", () => renderer.forceContextLoss());
  btn(act, "pause", () => renderer.pause());
  btn(act, "resume", () => renderer.resume());
  const qSel = document.createElement("select");
  for (const p of inp.quality)
    qSel.append(new Option(`quality: ${p.id}`, p.id, p.id === quality.id, p.id === quality.id));
  qSel.addEventListener("change", () => {
    const p = inp.quality.find((x) => x.id === qSel.value);
    if (p) renderer.setQuality(p);
  });
  act.appendChild(qSel);
  const susp = document.createElement("input");
  susp.placeholder = "focus me: keys suspended";
  act.appendChild(susp);

  function render(): void {
    const step = mission.steps[stepIndex];
    $("status").textContent = [
      `mission: ${mission.missionId} (${inp.missionSource})`,
      `step ${stepIndex}: ${step?.date ?? "-"} ${step?.isAvailable ? "" : "— No acquisition"}`,
      `roi: ${roi.vertices.length} v, closed=${roi.closed}, valid=${roiValid}, draw=${draw}`,
      `cam: ${lastCam.latDeg.toFixed(4)}, ${lastCam.lonDeg.toFixed(4)}, h=${Math.round(lastCam.heightM)} m`,
      `tiles: loaded ${progress.loaded} pending ${progress.pending}`,
      JSON.stringify(lastStatus, null, 1),
      log.slice(-4).join("\n"),
    ].join("\n");
  }
  render();

  const glInfo = (): { renderer: string; vendor: string } => {
    const c = renderer.getCanvas();
    const gl = c.getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown",
      vendor: gl && ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : "unknown",
    };
  };

  const sandbox = {
    get renderer() {
      return renderer;
    },
    ready: renderer.ready,
    status: () => renderer.getStatus(),
    events,
    glInfo,
    fps: (ms = 3000) => fpsSample(ms),
    runA2: async () => {
      const r = await runA2(impl(), renderer.getCanvas(), inp.camera.minClearanceM);
      return { ...r, gl: glInfo(), status: renderer.getStatus() };
    },
    /** A1-style context-loss loop: n forced losses, measure time to "contextRestored". */
    contextLossLoop: async (n = 3) => {
      const times: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const done = new Promise<void>((res) => {
          const off = renderer.on("contextRestored", () => {
            off();
            res();
          });
        });
        renderer.forceContextLoss();
        await Promise.race([done, new Promise((r) => setTimeout(r, 6000))]);
        times.push(Math.round(performance.now() - t0));
        await new Promise((r) => setTimeout(r, 500));
      }
      return { times, events: { ...events }, status: renderer.getStatus(), roiVertices: roi.vertices.length };
    },
    destroyAndCount: () => {
      renderer.destroy();
      return { canvases: document.querySelectorAll("canvas").length };
    },
    recreate: () => {
      renderer = createGlobeRenderer({
        container: $("globe"),
        mission,
        quality,
        cameraConfig: inp.camera,
        basemap: inp.basemap,
        ionToken: null,
        reducedMotion: false,
        useCustomCamera: custom,
        offlineOnly: qs.get("offline") === "1",
      });
      wire(renderer);
      return renderer.ready;
    },
    clickAt: (x: number, y: number) => {
      const c = renderer.getCanvas();
      const r = c.getBoundingClientRect();
      const base = {
        pointerId: 3,
        pointerType: "mouse",
        bubbles: true,
        button: 0,
        clientX: r.left + x,
        clientY: r.top + y,
      };
      c.dispatchEvent(new PointerEvent("pointerdown", base));
      c.dispatchEvent(new PointerEvent("pointerup", base));
    },
    setStep: (i: number) => {
      stepIndex = i;
      applyStep();
    },
  };
  (window as unknown as { __sandbox: typeof sandbox }).__sandbox = sandbox;
  await renderer.ready;
  document.body.dataset.ready = "1";
}

function demoAnnotations(mission: MissionManifest): GlobeAnnotation[] {
  const b = mission.effectiveBounds;
  const w = (b[2] - b[0]) / 10;
  const h = (b[3] - b[1]) / 10;
  const box = (cx: number, cy: number, s: number): LonLat[] => [
    { lon: cx - w * s, lat: cy - h * s },
    { lon: cx + w * s, lat: cy - h * s },
    { lon: cx + w * s, lat: cy + h * s },
    { lon: cx - w * s, lat: cy + h * s },
  ];
  return [
    { id: "a1", label: "Anomaly A", ring: box(b[0] + 3 * w, b[1] + 7 * h, 1), kind: "anomaly" },
    { id: "a2", label: "Anomaly B", ring: box(b[0] + 7.5 * w, b[1] + 2.5 * h, 0.8), kind: "anomaly" },
  ];
}

main().catch((err: unknown) => {
  console.error("[sandbox] failed", err);
  document.body.dataset.error = String(err);
  const el = document.getElementById("status");
  if (el) el.textContent = `FAILED: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`;
});
