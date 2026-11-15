/* Deterministic Canvas2D implementations of the §5 renderer interfaces.
 * Used with `?stub=1` (offline visual-CI fixture) and as the dev / failure fallback for the globe.
 * No WebGL, no network beyond the bundled mission PNGs, no animation loop (redraw on change only). */
import type {
  Bounds,
  GlobeEvents,
  GlobeLayer,
  GlobeRenderer,
  GlobeRendererOptions,
  GlobeStatus,
  HubEvents,
  HubRenderer,
  HubRendererOptions,
  LonLat,
  OrbitState,
  TemporalStep,
} from "../types";
import { assetUrl } from "../env";

type Handler<T> = (p: T) => void;

class Emitter<E> {
  private map = new Map<keyof E, Set<Handler<unknown>>>();
  on<K extends keyof E>(ev: K, fn: Handler<E[K]>): () => void {
    let s = this.map.get(ev);
    if (!s) {
      s = new Set();
      this.map.set(ev, s);
    }
    s.add(fn as Handler<unknown>);
    return () => s?.delete(fn as Handler<unknown>);
  }
  emit<K extends keyof E>(ev: K, p: E[K]): void {
    for (const fn of this.map.get(ev) ?? []) (fn as Handler<E[K]>)(p);
  }
  clear(): void {
    this.map.clear();
  }
}

const INK = "#0E1020";
const GRAPHITE = "#1C2036";
const PEARL = "#F3F5F7";
const CYAN = "#3DE0D0";
const AMBER = "#F2B441";
const MAGENTA = "#E0489B";
const INDIGO = "#6C5CE7";

const imgCache = new Map<string, HTMLImageElement>();
function image(rel: string, onload: () => void): HTMLImageElement | null {
  if (!rel || /\{[xyz]\}/.test(rel)) return null;
  const url = assetUrl(rel);
  let img = imgCache.get(url);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = url;
    imgCache.set(url, img);
  }
  if (!img.complete) img.addEventListener("load", onload, { once: true });
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function makeCanvas(container: HTMLElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.style.position = "absolute";
  c.style.inset = "0";
  c.style.width = "100%";
  c.style.height = "100%";
  c.style.display = "block";
  c.setAttribute("data-stub-renderer", "1");
  container.appendChild(c);
  return c;
}

export function createStubGlobeRenderer(opts: GlobeRendererOptions): GlobeRenderer {
  const { container, mission } = opts;
  const canvas = makeCanvas(container);
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Mission map (2D fixture). Click to place ROI vertices when marking is on.");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  const em = new Emitter<GlobeEvents>();
  const b = mission.effectiveBounds;
  const padX = (b[2] - b[0]) * 0.18;
  const padY = (b[3] - b[1]) * 0.18;
  const view: Bounds = [b[0] - padX, b[1] - padY, b[2] + padX, b[3] + padY];
  const cosLat = Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180);

  let step: TemporalStep | null = null;
  let contextId: string | null = null;
  const visible: Record<GlobeLayer, boolean> = {
    evidence: true,
    qa: false,
    context: true,
    referenceMask: false,
    groundTrack: true,
    aoiOutline: true,
  };
  const opacity: Record<GlobeLayer, number> = {
    evidence: 0.85,
    qa: 0.6,
    context: 1,
    referenceMask: 0.7,
    groundTrack: 1,
    aoiOutline: 1,
  };
  let roi: LonLat[] = [];
  let roiState = { closed: false, valid: false, selectedIndex: null as number | null };
  let drawMode = false;
  let track: OrbitState[] | null = null;
  let annotations: { id: string; label: string; ring: LonLat[]; kind: "anomaly" | "note" }[] = [];
  let suspended = false;
  let destroyed = false;
  let paused = false;
  const status: GlobeStatus = {
    terrain: "ELLIPSOID",
    imagery: "OFFLINE_BUNDLED",
    offline: true,
    contextLost: false,
    sceneReady: false,
    logDepth: false,
    webgl2: false,
    message: "2D fixture renderer (no WebGL)",
  };

  // viewport transform (fit view bounds, keep ground aspect)
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let dpr = 1;
  function layout(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = container.clientWidth || 1280;
    const h = container.clientHeight || 720;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const vw = (view[2] - view[0]) * cosLat;
    const vh = view[3] - view[1];
    scale = Math.min(w / vw, h / vh);
    ox = (w - vw * scale) / 2;
    oy = (h - vh * scale) / 2;
  }
  const toPx = (lon: number, lat: number): [number, number] => [
    ox + (lon - view[0]) * cosLat * scale,
    oy + (view[3] - lat) * scale,
  ];
  const toLonLat = (x: number, y: number): LonLat => ({
    lon: view[0] + (x - ox) / (cosLat * scale),
    lat: view[3] - (y - oy) / scale,
  });

  function drawImg(rel: string | null | undefined, bounds: Bounds, alpha: number): void {
    if (!rel || !ctx) return;
    const img = image(rel, schedule);
    if (!img) return;
    const [x0, y0] = toPx(bounds[0], bounds[3]);
    const [x1, y1] = toPx(bounds[2], bounds[1]);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
  }

  function draw(): void {
    if (!ctx || destroyed) return;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, w, h);
    // land plate
    const [ax0, ay0] = toPx(view[0], view[3]);
    const [ax1, ay1] = toPx(view[2], view[1]);
    ctx.fillStyle = GRAPHITE;
    ctx.fillRect(ax0, ay0, ax1 - ax0, ay1 - ay0);
    // context layer (single-tile only in the fixture)
    if (visible.context) {
      const layer =
        mission.contextLayers.find((l) => l.layerId === contextId) ??
        mission.contextLayers.find((l) => step && l.stepId === step.stepId) ??
        mission.contextLayers[0];
      if (layer && layer.tiling.tileMatrixSet === "SINGLE_TILE")
        drawImg(layer.tileUrlTemplate, layer.bounds, opacity.context);
    }
    // graticule every 0.1°
    ctx.strokeStyle = "rgba(243,245,247,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lon = Math.ceil(view[0] * 10) / 10; lon <= view[2]; lon += 0.1) {
      const [x] = toPx(lon, 0);
      ctx.moveTo(x, ay0);
      ctx.lineTo(x, ay1);
    }
    for (let lat = Math.ceil(view[1] * 10) / 10; lat <= view[3]; lat += 0.1) {
      const [, y] = toPx(0, lat);
      ctx.moveTo(ax0, y);
      ctx.lineTo(ax1, y);
    }
    ctx.stroke();
    if (step?.isAvailable && visible.evidence) drawImg(step.tileUrlTemplate, step.bounds, opacity.evidence);
    if (step?.isAvailable && visible.qa && step.qaMaskId) {
      const m = mission.masks[step.qaMaskId];
      if (m) drawImg(m.pngUrl, m.bounds, opacity.qa);
    }
    if (visible.referenceMask) {
      const m = mission.masks[mission.referenceMaskId];
      if (m) drawImg(m.pngUrl, m.bounds, opacity.referenceMask);
    }
    // AOI outline
    if (visible.aoiOutline) {
      const [x0, y0] = toPx(b[0], b[3]);
      const [x1, y1] = toPx(b[2], b[1]);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
    }
    // ground track
    if (visible.groundTrack && track && track.length > 1) {
      ctx.strokeStyle = INDIGO;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let pen = false;
      for (const s of track) {
        const inside =
          s.lonDeg >= view[0] - 1 && s.lonDeg <= view[2] + 1 && s.latDeg >= view[1] - 1 && s.latDeg <= view[3] + 1;
        if (!inside) {
          pen = false;
          continue;
        }
        const [x, y] = toPx(s.lonDeg, s.latDeg);
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    }
    // annotations (Anomaly Detector): amber dashed outline + label, matte
    for (const a of annotations) {
      if (a.ring.length < 2) continue;
      ctx.beginPath();
      a.ring.forEach((v, i) => {
        const [x, y] = toPx(v.lon, v.lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      const p0 = a.ring[0];
      if (p0) {
        const [lx, ly] = toPx(Math.min(...a.ring.map((r) => r.lon)), Math.max(...a.ring.map((r) => r.lat)));
        ctx.font = "600 12px 'IBM Plex Mono', monospace";
        const tw = ctx.measureText(a.label).width;
        ctx.fillStyle = "rgba(14,16,32,0.86)";
        ctx.fillRect(lx, ly - 18, tw + 10, 16);
        ctx.fillStyle = AMBER;
        ctx.fillText(a.label, lx + 5, ly - 6);
      }
    }
    // ROI
    if (roi.length) {
      ctx.beginPath();
      roi.forEach((v, i) => {
        const [x, y] = toPx(v.lon, v.lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (roiState.closed) ctx.closePath();
      const ok = roiState.valid || !roiState.closed;
      if (roiState.closed) {
        ctx.fillStyle = ok ? "rgba(61,224,208,0.14)" : "rgba(224,72,155,0.14)";
        ctx.fill();
      }
      ctx.strokeStyle = ok ? CYAN : MAGENTA;
      ctx.setLineDash(ok ? [] : [6, 4]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      roi.forEach((v, i) => {
        const [x, y] = toPx(v.lon, v.lat);
        const sel = roiState.selectedIndex === i;
        ctx.fillStyle = sel ? AMBER : INK;
        ctx.strokeStyle = sel ? AMBER : CYAN;
        ctx.lineWidth = 2;
        ctx.fillRect(x - 5, y - 5, 10, 10);
        ctx.strokeRect(x - 5, y - 5, 10, 10);
      });
    }
    // fixture watermark (bottom-centre, above the timeline area)
    ctx.fillStyle = "rgba(243,245,247,0.45)";
    ctx.font = "12px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("2D FIXTURE MAP — EQUIRECTANGULAR — NOT A GLOBE", w / 2, oy + 18);
    ctx.textAlign = "left";
    if (!status.sceneReady) {
      status.sceneReady = true;
      em.emit("status", { ...status });
      resolveReady();
    }
  }

  let raf = 0;
  function schedule(): void {
    if (raf || destroyed || paused) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });

  const ro = new ResizeObserver(() => {
    layout();
    schedule();
  });
  ro.observe(container);
  layout();

  function evtXY(e: MouseEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  const onClick = (e: MouseEvent): void => {
    if (!drawMode || suspended) return;
    const [x, y] = evtXY(e);
    if (roi.length >= 3 && !roiState.closed) {
      const first = roi[0];
      if (first) {
        const [fx, fy] = toPx(first.lon, first.lat);
        if (Math.hypot(fx - x, fy - y) < 12) {
          em.emit("roiCloseRequested", undefined);
          return;
        }
      }
    }
    em.emit("roiVertexAdded", toLonLat(x, y));
  };
  const onDbl = (e: MouseEvent): void => {
    if (!drawMode || suspended) return;
    e.preventDefault();
    em.emit("roiCloseRequested", undefined);
  };
  const onMove = (e: MouseEvent): void => {
    const [x, y] = evtXY(e);
    const p = toLonLat(x, y);
    em.emit("pointer", p.lon >= view[0] && p.lon <= view[2] && p.lat >= view[1] && p.lat <= view[3] ? p : null);
  };
  const onLeave = (): void => em.emit("pointer", null);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("dblclick", onDbl);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);

  queueMicrotask(() => {
    em.emit("status", { ...status });
    em.emit("camera", {
      lonDeg: mission.camera.aoi.lon,
      latDeg: mission.camera.aoi.lat,
      heightM: mission.camera.aoi.heightM,
    });
    schedule();
  });

  return {
    ready,
    setStep(s) {
      step = s;
      schedule();
    },
    setContextLayer(id) {
      contextId = id;
      schedule();
    },
    setLayerVisible(l, v) {
      visible[l] = v;
      schedule();
    },
    setLayerOpacity(l, o) {
      opacity[l] = o;
      schedule();
    },
    setRoi(v, st) {
      roi = v.slice();
      roiState = { ...st };
      schedule();
    },
    setRoiDrawMode(on) {
      drawMode = on;
      canvas.style.cursor = on ? "crosshair" : "default";
    },
    setGroundTrack(t) {
      track = t;
      schedule();
    },
    setAnnotations(items) {
      annotations = items.slice();
      schedule();
    },
    flyTo() {
      schedule();
    },
    setInputSuspended(s) {
      suspended = s;
    },
    setQuality() {},
    getStatus: () => ({ ...status }),
    getCanvas: () => canvas,
    on: (ev, fn) => em.on(ev, fn),
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      schedule();
    },
    forceContextLoss() {
      status.contextLost = true;
      em.emit("contextLost", undefined);
      em.emit("status", { ...status });
    },
    forceContextRestore() {
      setTimeout(() => {
        if (destroyed) return;
        status.contextLost = false;
        em.emit("contextRestored", undefined);
        em.emit("status", { ...status });
        schedule();
      }, 30);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDbl);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      em.clear();
    },
  };
}

/** Static Canvas2D hub board — stub for `?stub=1`. */
export function createStubHubRenderer(opts: HubRendererOptions): HubRenderer {
  const { container, missions } = opts;
  const canvas = makeCanvas(container);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  const em = new Emitter<HubEvents>();
  let focus: string | null = null;
  let destroyed = false;
  let dpr = 1;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });

  function draw(): void {
    if (!ctx || destroyed) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = container.clientWidth || 1280;
    const h = container.clientHeight || 720;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, w, h);
    // floor grid
    ctx.strokeStyle = "rgba(61,224,208,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 48) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y < h; y += 48) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    // hex ring (the open signal)
    const cx = w * 0.62;
    const cy = h * 0.46;
    const r = Math.min(w, h) * 0.22;
    ctx.strokeStyle = MAGENTA;
    ctx.lineWidth = 10;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2 + 0.18;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();
    // board slots
    missions.forEach((m, i) => {
      const x = cx - r * 1.1 + i * ((r * 2.2) / Math.max(1, missions.length - 1 || 1));
      const y = cy + r * 1.35;
      ctx.fillStyle = m.id === focus ? CYAN : m.locked ? GRAPHITE : AMBER;
      ctx.fillRect(x - 18, y - 6, 36, 12);
    });
    ctx.fillStyle = "rgba(243,245,247,0.4)";
    ctx.font = "12px 'IBM Plex Mono', monospace";
    ctx.fillText("HUB FIXTURE — CANVAS2D", 24, h - 24);
    resolveReady();
  }
  const ro = new ResizeObserver(() => draw());
  ro.observe(container);
  draw();

  return {
    ready,
    focusMission(id) {
      focus = id;
      draw();
      em.emit("missionFocus", id);
    },
    setNisar() {},
    on: (ev, fn) => em.on(ev, fn),
    getCanvas: () => canvas,
    pause() {},
    resume() {},
    forceContextLoss() {
      em.emit("contextLost", undefined);
    },
    forceContextRestore() {
      setTimeout(() => !destroyed && em.emit("contextRestored", undefined), 30);
    },
    destroy() {
      destroyed = true;
      ro.disconnect();
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      em.clear();
    },
  };
}
