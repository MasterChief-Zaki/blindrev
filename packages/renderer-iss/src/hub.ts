import {
  BlendFunction,
  EffectComposer,
  EffectPass,
  RenderPass,
  SelectiveBloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import * as THREE from "three";
import { createEarth, type EarthRig, earthOrientation } from "./earth";
import { createInterior, type InteriorRig } from "./interior";
import { applyEnv, buildSpaceEnvironment, loadNisar } from "./nisar";
import { BLOOM_LAYER, FONT_DISPLAY, FONT_MONO, INK } from "./palette";
import {
  type HubEvents,
  type HubOrbitState,
  type HubRenderer,
  type HubRendererOptions,
  WebGL2UnavailableError,
} from "./types";
import { createWorlds, type WorldSlot, type WorldsRig } from "./worlds";

/** Internal debug/harness surface (not part of the §5 API; used by the sandbox + reports). */
export interface HubDebug {
  setView(v: "final" | "bloomMask"): void;
  /** Client-pixel position of slot i's label centre (for synthetic pointer tests). */
  labelScreenPos(i: number): [number, number] | null;
  frameTimes(): number[];
  /** Total frames rendered since creation (monotonic). */
  frameCount(): number;
  /**
   * Synchronous cost benchmark (rAF is vsync-capped): renders n frames back-to-back, each followed by a 1-pixel
   * readPixels from the default framebuffer (forces a full GPU round trip; gl.finish() does not block in Chrome).
   * "post" = the shipping path (HDR composer + selective bloom + tone mapping); "plain" = scene only, no post.
   */
  benchmark(n: number, mode: "post" | "plain"): { avgMs: number; p95Ms: number };
  info(): {
    renderer: string;
    vendor: string;
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
    pixelRatio: number;
    size: [number, number];
    bloomSelection: string[];
    msaa: number;
    shadows: boolean;
    earthTextures: "none" | "1k" | "4k";
    phases: Record<string, number>;
    nisarLoaded: boolean;
    readyMs: number | null;
  };
}
export type HubRendererInternal = HubRenderer & { __debug: HubDebug };

const SKY_FRAG = /* glsl */ `
uniform vec3 earthDir;
uniform float earthAng;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float a = acos(clamp(dot(d, earthDir), -1.0, 1.0));
  float t = max(a - earthAng, 0.0);
  vec3 ink = vec3(0.0055, 0.006, 0.016);
  vec3 violet = vec3(0.075, 0.035, 0.24);
  vec3 indigo = vec3(0.03, 0.025, 0.11);
  vec3 col = mix(indigo, ink, smoothstep(0.0, 0.9, t));
  col += violet * exp(-t * 7.0);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const CAM_POS = new THREE.Vector3(0, 1.95, 8.4);
const CAM_TARGET = new THREE.Vector3(0, 2.75, -4);
const BASE_VFOV = 42;
const NISAR_POS = new THREE.Vector3(0.5, 7.9, -44);
/** Fallback sub-satellite point when no ephemeris is supplied: over the mission AOI (San Joaquin Valley). */
const FALLBACK = { lonDeg: -119.9, latDeg: 36.1, headingDeg: 193 };
const ORBIT_RATE = (2 * Math.PI) / 5990; // rad/s, NISAR ~99.8 min period
/** Arrival camera settle (skipped under reduced motion). */
const INTRO_MS = 1400;
/** World 01's illustrative subsidence loop length. */
const SINK_LOOP_S = 9;

function loadBitmapTexture(
  url: string,
  srgb: boolean,
  maxAniso: number,
): Promise<{ tex: THREE.Texture; bmp: ImageBitmap }> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.ImageBitmapLoader();
    loader.setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" });
    loader.load(
      url,
      (bmp) => {
        const tex = new THREE.Texture(bmp);
        tex.flipY = false;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.anisotropy = maxAniso;
        tex.wrapS = THREE.RepeatWrapping;
        tex.needsUpdate = true;
        resolve({ tex, bmp });
      },
      undefined,
      (e) => reject(e instanceof Error ? e : new Error(`Failed to load ${url}`)),
    );
  });
}

function assetUrl(rel: string): string {
  return new URL(rel, document.baseURI).href;
}

async function fontsReady(timeoutMs: number): Promise<void> {
  if (!("fonts" in document)) return;
  const loads = [`800 84px ${FONT_DISPLAY}`, `600 36px ${FONT_DISPLAY}`, `400 32px ${FONT_MONO}`].map((f) =>
    document.fonts.load(f).catch(() => []),
  );
  await Promise.race([Promise.all([...loads, document.fonts.ready]), new Promise((r) => setTimeout(r, timeoutMs))]);
}

export function createHubRenderer(opts: HubRendererOptions): HubRendererInternal {
  const { container, missions, quality } = opts;
  const reducedMotion = opts.reducedMotion;

  // --- explicit WebGL2 context ---
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;outline:none;touch-action:none;";
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.renderer = "hub";
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    powerPreference: "high-performance",
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new WebGL2UnavailableError();
  container.appendChild(canvas);

  const t0 = performance.now();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: false,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });
  } catch (e) {
    canvas.remove();
    throw new WebGL2UnavailableError(`WebGL2 renderer init failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post chain (HDR half-float buffers)
  const shadows = quality.id !== "low";
  renderer.shadowMap.enabled = shadows;
  // PCFShadowMap explicitly: PCFSoftShadowMap is remapped at render time in this three.js version, which
  // would invalidate every program compiled up-front and force a multi-second synchronous recompile.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // static hall: shadows are rendered once (and after context restore)
  renderer.setClearColor(INK, 1);
  renderer.info.autoReset = false; // count every pass of a frame (reset once per frame below)
  const msaa = quality.id === "low" ? 0 : 4;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // --- scene ---
  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.FogExp2("#15203a", 0.022);
  const camera = new THREE.PerspectiveCamera(BASE_VFOV, 16 / 9, 0.1, 9000);
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_TARGET);

  // Earth layout: limb sits a little above the viewport sill; NISAR floats above it in the frame centre.
  const earthAng = THREE.MathUtils.degToRad(62);
  const limbElev = THREE.MathUtils.degToRad(5.5);
  const earthElev = limbElev - earthAng;
  const earthDist = 3200;
  const earthDir = new THREE.Vector3(0.05, Math.sin(earthElev), -Math.cos(earthElev)).normalize();
  const earthCenter = CAM_POS.clone().addScaledVector(earthDir, earthDist);
  const earthRadius = earthDist * Math.sin(earthAng);
  const earth: EarthRig = createEarth(earthCenter, earthRadius, quality.id === "low" ? 96 : 160);
  scene.add(earth.group);
  const sunDir = new THREE.Vector3(0.85, 0.42, -0.3).normalize();
  earth.setSun(sunDir);

  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: { earthDir: { value: earthDir.clone() }, earthAng: { value: earthAng } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  sky.name = "sky";
  sky.onBeforeRender = (_r, _s, cam) => {
    sky.position.copy(cam.position);
    sky.updateMatrixWorld();
  };
  scene.add(sky);

  const interior: InteriorRig = createInterior({ shadows });
  scene.add(interior.group);
  interior.sun.position.set(-3, 9, -14);
  interior.sun.target.position.set(0, 0, 1);

  const worlds: WorldsRig = createWorlds(missions, CAM_POS);
  scene.add(worlds.group);

  // NISAR exhibit + key light that only matters for it (directional, from the camera side).
  const nisarAnchor = new THREE.Group();
  nisarAnchor.name = "nisar-anchor";
  nisarAnchor.position.copy(NISAR_POS);
  scene.add(nisarAnchor);
  const nisarKey = new THREE.DirectionalLight("#dfe6ff", 1.4);
  nisarKey.position.set(6, 14, 6);
  nisarKey.target = nisarAnchor;
  scene.add(nisarKey);
  let nisar: THREE.Group | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;

  // --- post: HDR half-float composer, selective bloom on accent meshes only, neutral tone mapping ---
  let composer: EffectComposer;
  let bloom: SelectiveBloomEffect;
  const bloomTargets = new Set<THREE.Object3D>([...interior.bloomMeshes, ...worlds.bloomMeshes]);
  const buildComposer = (): void => {
    composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: msaa,
      stencilBuffer: false,
    });
    composer.addPass(new RenderPass(scene, camera));
    bloom = new SelectiveBloomEffect(scene, camera, {
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 0.22,
      luminanceSmoothing: 0.35,
      intensity: 1.35,
      radius: 0.62,
      levels: quality.id === "low" ? 5 : 7,
    });
    bloom.selection.layer = BLOOM_LAYER;
    bloom.ignoreBackground = true;
    bloom.inverted = false;
    for (const o of bloomTargets) bloom.selection.add(o);
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.55 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    composer.addPass(new EffectPass(camera, bloom, vignette, tone));
  };
  buildComposer();

  // --- sizing (renderScale from the preset; never changed mid-interaction) ---
  let width = 1;
  let height = 1;
  const applySize = (): void => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    width = w;
    height = h;
    const maxPixels = quality.allow4k ? 3840 * 2160 : 2560 * 1440;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality.renderScale;
    const pr = Math.min(dpr, Math.sqrt(maxPixels / (w * h)));
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setSize(w, h, false);
    earth.setPixelRatio(pr);
    const aspect = w / h;
    camera.aspect = aspect;
    const ref = 16 / 9;
    if (aspect < ref) {
      const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_VFOV / 2)) * ref);
      camera.fov = Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / aspect)));
    } else camera.fov = BASE_VFOV;
    camera.updateProjectionMatrix();
  };
  applySize();
  const ro = new ResizeObserver(() => {
    if (!destroyed) applySize();
  });
  ro.observe(container);

  // --- events ---
  const listeners = new Map<keyof HubEvents, Set<(p: never) => void>>();
  const emit = <K extends keyof HubEvents>(ev: K, p: HubEvents[K]): void => {
    const set = listeners.get(ev) as Set<(p: HubEvents[K]) => void> | undefined;
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(p);
      } catch (e) {
        console.error("[hub] listener error", e);
      }
    }
  };

  // --- focus / selection ---
  let hoverIdx: number | null = null;
  let programmaticId: string | null = null;
  let shownFocus: string | null = null;
  const slotById = (id: string | null): WorldSlot | null =>
    id ? (worlds.slots.find((s) => s.mission?.id === id) ?? null) : null;
  // Resting state: with nothing focused, the first playable world is PRESENTED as selected (hero frame,
  // ring, "SELECTED" label). Visual default only — no missionFocus event is emitted for it.
  const defaultSlot: WorldSlot | null = worlds.slots.find((s) => s.mission && !s.mission.locked) ?? null;
  let heroId: string | null = defaultSlot?.mission?.id ?? null;
  const applyFocus = (force = false): void => {
    const hovered = hoverIdx !== null ? (worlds.slots[hoverIdx] ?? null) : null;
    const slot = hovered?.mission ? hovered : slotById(programmaticId);
    const id = slot?.mission?.id ?? null;
    if (id === shownFocus && !force) return;
    const prev = slotById(shownFocus);
    const prevHero = slotById(heroId);
    shownFocus = id;
    // The cyan hero frame is reserved for an unlocked world; a focused LOCKED world gets a dim outline
    // and the hero stays on the playable case.
    const lockedFocus = slot?.mission?.locked ? slot : null;
    const hero = slot && !lockedFocus ? slot : defaultSlot;
    heroId = hero?.mission?.id ?? null;
    const changed = new Set<number>();
    for (const s of [prev, slot, prevHero, hero]) if (s) changed.add(s.index);
    worlds.redraw(heroId, force ? undefined : changed);
    for (const s of worlds.slots) {
      const base = s.mission ? (s.mission.locked ? 0.6 : 1.0) : 0.35;
      const active = s === hero && s === slot; // really focused (hover / focusMission), not just the resting hero
      s.targetGain = active ? 1.38 : s === hero ? 1.14 : s === lockedFocus ? 0.82 : base;
      if (reducedMotion) s.gain = s.targetGain;
      // Only the focused, unlocked label joins the bloom selection ("active/selected states"); the resting
      // hero keeps its text matte (frame + ring carry the accent glow).
      if (active) bloom.selection.add(s.label);
      else bloom.selection.delete(s.label);
    }
    worlds.placeSelection(hero, lockedFocus);
    canvas.style.cursor = slot?.mission && !slot.mission.locked && hovered === slot ? "pointer" : "default";
  };
  applyFocus(true); // present the resting hero before the first frame

  // --- pointer ---
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pointerDirty = false;
  let pointerInside = false;
  const parallax = new THREE.Vector2();
  const parallaxTarget = new THREE.Vector2();
  const pick = (): WorldSlot | null => {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(worlds.pickables, false);
    const first = hits[0];
    return first ? worlds.slotFor(first.object) : null;
  };
  const toNdc = (e: PointerEvent | MouseEvent): void => {
    const r = canvas.getBoundingClientRect();
    ndc.set(
      ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1,
      -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1,
    );
  };
  const onMove = (e: PointerEvent): void => {
    toNdc(e);
    pointerInside = true;
    pointerDirty = true;
    if (!reducedMotion) parallaxTarget.set(ndc.x, ndc.y);
  };
  const onLeave = (): void => {
    pointerInside = false;
    pointerDirty = true;
    parallaxTarget.set(0, 0);
  };
  const onClick = (e: MouseEvent): void => {
    toNdc(e);
    const s = pick();
    if (s?.mission && !s.mission.locked) emit("missionSelect", s.mission.id);
  };
  const updateHover = (): void => {
    if (!pointerDirty) return;
    pointerDirty = false;
    const s = pointerInside ? pick() : null;
    const idx = s?.mission ? s.index : null;
    if (idx !== hoverIdx) {
      hoverIdx = idx;
      emit("missionFocus", idx !== null ? (worlds.slots[idx]?.mission?.id ?? null) : null);
      applyFocus();
    }
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);

  // --- NISAR-driven Earth orientation ---
  const anchorQ = new THREE.Quaternion();
  const blendFromQ = new THREE.Quaternion();
  let blendT = 1;
  let anchorTime = performance.now();
  const upW = new THREE.Vector3();
  const fwdW = new THREE.Vector3(0.0, 0, -1);
  const spinAxis = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const headingFromState = (s: HubOrbitState): number => {
    const v = s.velEcefMps;
    if (!v) return FALLBACK.headingDeg;
    const lon = THREE.MathUtils.degToRad(s.lonDeg);
    const lat = THREE.MathUtils.degToRad(s.latDeg);
    const e = -Math.sin(lon) * v.x + Math.cos(lon) * v.y;
    const n = -Math.sin(lat) * Math.cos(lon) * v.x - Math.sin(lat) * Math.sin(lon) * v.y + Math.cos(lat) * v.z;
    return THREE.MathUtils.radToDeg(Math.atan2(e, n));
  };
  const currentEarthQ = (now: number, out: THREE.Quaternion): THREE.Quaternion => {
    const dt = reducedMotion ? 0 : (now - anchorTime) / 1000;
    tmpQ.setFromAxisAngle(spinAxis, ORBIT_RATE * dt);
    out.copy(tmpQ).multiply(anchorQ);
    if (blendT < 1) out.slerpQuaternions(blendFromQ, out.clone(), blendT);
    return out;
  };
  const setEarthAnchor = (s: HubOrbitState | null, smooth: boolean): void => {
    const now = performance.now();
    if (smooth) currentEarthQ(now, blendFromQ);
    upW.copy(NISAR_POS).sub(earthCenter).normalize();
    spinAxis
      .crossVectors(
        fwdW
          .clone()
          .sub(upW.clone().multiplyScalar(fwdW.dot(upW)))
          .normalize(),
        upW,
      )
      .normalize();
    const lon = s?.lonDeg ?? FALLBACK.lonDeg;
    const lat = s?.latDeg ?? FALLBACK.latDeg;
    const hd = s ? headingFromState(s) : FALLBACK.headingDeg;
    earthOrientation(lon, lat, hd, upW, fwdW, anchorQ);
    anchorTime = now;
    blendT = smooth && !reducedMotion ? 0 : 1;
  };
  setEarthAnchor(opts.nisar, false);
  worlds.setTelemetry(opts.nisar);

  // --- frame loop ---
  let raf = 0;
  let running = false;
  let paused = false;
  let destroyed = false;
  let contextLost = false;
  let view: "final" | "bloomMask" = "final";
  let last = performance.now();
  const frameTimes: number[] = [];
  let frameCount = 0;
  const clock0 = performance.now();
  const earthQ = new THREE.Quaternion();
  const lookTarget = new THREE.Vector3();
  let introStart: number | null = null;

  const renderFrame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = (now - clock0) / 1000;
    renderer.info.reset();
    updateHover();
    // Camera parallax + arrival settle (both off under reduced motion: static camera at the rest pose).
    if (!reducedMotion) {
      parallax.lerp(parallaxTarget, 1 - Math.exp(-dt * 2.5));
      // Arrival: a short eased dolly-in from slightly back and up, starting on the first rendered frame.
      if (introStart === null) introStart = now;
      const ik = Math.min(1, (now - introStart) / INTRO_MS);
      const settle = (1 - ik) ** 3; // ease-out cubic, 1 → 0
      camera.position.set(
        CAM_POS.x + parallax.x * 0.32,
        CAM_POS.y + parallax.y * 0.16 + settle * 0.42,
        CAM_POS.z + settle * 1.7,
      );
      lookTarget.set(CAM_TARGET.x + parallax.x * 0.12, CAM_TARGET.y + parallax.y * 0.06, CAM_TARGET.z);
      camera.lookAt(lookTarget);
    }
    // Hover/select emphasis: the focused world lifts and grows a little, its ring widens (and pulses).
    for (const s of worlds.slots) {
      const want = s.mission && s.mission.id === shownFocus ? (s.mission.locked ? 0.3 : 1) : 0;
      s.lift = reducedMotion ? want : s.lift + (want - s.lift) * (1 - Math.exp(-dt * 9));
      const pulse = reducedMotion || !s.mission || s.mission.locked ? 0 : 0.035 * Math.sin(t * 4.2) * s.lift;
      s.world.scale.setScalar(1.05 * (1 + 0.09 * s.lift));
      s.ring.scale.setScalar(1 + 0.1 * s.lift + pulse);
      if (reducedMotion) s.world.position.y = 0.1 * s.lift;
    }
    // Lantern sway + world bob/rotation.
    if (!reducedMotion) {
      for (const l of interior.lanterns) {
        l.pivot.rotation.z = Math.sin(t * 0.8 + l.phase) * l.amp;
        l.pivot.rotation.x = Math.sin(t * 0.63 + l.phase * 1.7) * l.amp * 0.7;
      }
      for (const s of worlds.slots) {
        s.world.position.y = Math.sin(t * 0.7 + s.index * 1.3) * 0.045 + 0.1 * s.lift;
        s.world.rotation.y = t * 0.12 + s.index;
        if (s.sink) {
          // Illustrative subsidence loop: ~6 s down, short hold, eased reset. Not a measurement.
          const ph = (t % SINK_LOOP_S) / SINK_LOOP_S;
          const down = ph < 0.68 ? ph / 0.68 : ph < 0.8 ? 1 : 1 - (ph - 0.8) / 0.2;
          const k = down * down * (3 - 2 * down);
          s.sink.town.position.y = -0.07 * k;
          if (s.sink.pond) {
            s.sink.pond.scale.set(1 + 0.55 * k, 1, 1 + 0.55 * k);
            s.sink.pond.position.y = 0.012 * k;
          }
        }
      }
      if (nisar) nisar.rotation.y = -0.5 + Math.sin(t * 0.05) * 0.25;
    }
    // Screen gains (instant under reduced motion — no bloom-intensity transitions).
    for (const s of worlds.slots) {
      if (!reducedMotion) s.gain += (s.targetGain - s.gain) * (1 - Math.exp(-dt * 10));
      const u = s.material.uniforms;
      if (u.gain) u.gain.value = s.gain;
      if (u.time) u.time.value = t;
      if (u.sweep) u.sweep.value = reducedMotion ? 0 : 1;
    }
    // Earth (driven by the NISAR sub-satellite point; extrapolated along-track between updates).
    if (blendT < 1) blendT = Math.min(1, blendT + dt / 1.5);
    earth.spin.quaternion.copy(currentEarthQ(now, earthQ));
    const cu = earth.material.uniforms.cloudOffset;
    if (cu && !reducedMotion) cu.value = t * 0.0000025;

    if (view === "bloomMask") {
      // A3 proof: draw ONLY what is on the bloom selection layer, on black, without post.
      const prevMask = camera.layers.mask;
      const prevFog = scene.fog;
      scene.fog = null;
      camera.layers.set(bloom.selection.layer);
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setClearColor(INK, 1);
      camera.layers.mask = prevMask;
      scene.fog = prevFog;
    } else {
      composer.render(dt);
    }
    frameCount++;
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 600) frameTimes.shift();
  };
  const loop = (now: number): void => {
    raf = 0;
    if (!running) return;
    renderFrame(now);
    raf = requestAnimationFrame(loop);
  };
  const start = (): void => {
    if (running || destroyed || contextLost || paused) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const stop = (): void => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  // --- context loss / restore ---
  const onLost = (e: Event): void => {
    e.preventDefault();
    if (destroyed) return;
    contextLost = true;
    stop();
    emit("contextLost", undefined);
  };
  const onRestored = (): void => {
    if (destroyed) return;
    // three.js re-initialises its GL state on restore; rebuild everything that lived only on the GPU.
    contextLost = false;
    buildComposer();
    applyFocus(true); // the new bloom selection must contain the selected label again
    applySize();
    // three.js recreated its property maps on restore, so geometries/textures/programs re-upload lazily;
    // only GPU-generated content (PMREM env, shadow map, post targets) must be regenerated explicitly.
    envRT = null; // its GL objects died with the old context; do not dispose them on the new one
    rebuildEnv();
    renderer.shadowMap.needsUpdate = true;
    renderFrame(performance.now());
    emit("contextRestored", undefined);
    start();
  };
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);

  // --- assets ---
  const manager = new THREE.LoadingManager();
  const bitmaps: ImageBitmap[] = [];
  const earthTextures: THREE.Texture[] = [];
  let earthTier: "none" | "1k" | "4k" = "none";
  let readyMs: number | null = null;
  const phases: Record<string, number> = {};
  const mark = (k: string): void => {
    phases[k] = Math.round(performance.now() - t0);
  };
  const allTextures = (): THREE.Texture[] => [...interior.textures, ...worlds.textures, ...earthTextures];
  const rebuildEnv = (): void => {
    if (!nisar) return;
    envRT?.dispose();
    envRT = buildSpaceEnvironment(renderer, sunDir, earthDir);
    applyEnv(nisar, envRT.texture);
  };
  const setEarth = (
    day: { tex: THREE.Texture; bmp: ImageBitmap },
    aux: { tex: THREE.Texture; bmp: ImageBitmap },
    tier: "1k" | "4k",
  ): void => {
    const old = [...earthTextures];
    earthTextures.length = 0;
    earthTextures.push(day.tex, aux.tex);
    bitmaps.push(day.bmp, aux.bmp);
    if (!contextLost) {
      renderer.initTexture(day.tex);
      renderer.initTexture(aux.tex);
    }
    earth.setTextures(day.tex, aux.tex);
    earthTier = tier;
    for (const t of old) {
      t.dispose();
      const img = t.image as ImageBitmap | undefined;
      if (img && typeof img.close === "function") img.close();
    }
  };

  let rejectReady: (e: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    const timeout = setTimeout(() => reject(new Error("Hub renderer timed out while loading (15 s).")), 15000);
    (async () => {
      const fontP = fontsReady(700);
      const lowP = Promise.all([
        loadBitmapTexture(assetUrl("textures/hub/earth_day_1k.jpg"), true, maxAniso),
        loadBitmapTexture(assetUrl("textures/hub/earth_aux_1k.jpg"), false, maxAniso),
      ]);
      const nisarP = loadNisar(assetUrl("models/nisar/Nisar.gltf"), manager).catch((e: unknown) => {
        console.warn("[hub] NISAR model failed to load; continuing without it.", e);
        return null;
      });
      await fontP;
      mark("fonts");
      worlds.redraw(heroId);
      mark("labels");
      const [low, model] = await Promise.all([
        lowP.catch((e: unknown) => {
          console.warn("[hub] Earth textures failed to load; showing a plain Earth.", e);
          return null;
        }),
        nisarP,
      ]);
      mark("assets");
      if (destroyed) return;
      if (low) setEarth(low[0], low[1], "1k");
      if (model) {
        nisar = model;
        nisar.scale.setScalar(0.72);
        nisar.rotation.set(0.75, -0.5, -0.2);
        nisarAnchor.add(nisar);
        rebuildEnv();
      }
      renderer.shadowMap.needsUpdate = true;
      // Compile against the composer's linear half-float target: program variants depend on the output
      // target (sRGB screen vs linear buffer); compiling for the screen would compile everything twice.
      renderer.setRenderTarget(composer.inputBuffer);
      await renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(null);
      mark("compile");
      if (destroyed) return;
      renderFrame(performance.now());
      mark("firstFrame");
      readyMs = performance.now() - t0;
      clearTimeout(timeout);
      resolve();
      start();
      // Progressive upgrade to the 4k Earth after the first frame.
      Promise.all([
        loadBitmapTexture(assetUrl("textures/hub/earth_day_4k.jpg"), true, maxAniso),
        loadBitmapTexture(assetUrl("textures/hub/earth_aux_4k.jpg"), false, maxAniso),
      ])
        .then(([d, a]) => {
          if (destroyed) {
            d.bmp.close();
            a.bmp.close();
            d.tex.dispose();
            a.tex.dispose();
            return;
          }
          setEarth(d, a, "4k");
        })
        .catch((e: unknown) => console.warn("[hub] 4k Earth upgrade failed; keeping 1k.", e));
    })().catch((e: unknown) => {
      clearTimeout(timeout);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
  ready.catch(() => {}); // consumers handle rejection; avoid an unhandled-rejection report here

  const onFontsDone = (): void => {
    if (!destroyed) worlds.redraw(heroId);
  };
  document.fonts?.addEventListener?.("loadingdone", onFontsDone);

  // --- disposal ---
  const disposeAll = (): void => {
    const seenMat = new Set<THREE.Material>();
    const seenTex = new Set<THREE.Texture>();
    const seenGeo = new Set<THREE.BufferGeometry>();
    const texOf = (m: THREE.Material): void => {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) seenTex.add(v);
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u)
        for (const k of Object.keys(u))
          if (u[k]?.value instanceof THREE.Texture) seenTex.add(u[k].value as THREE.Texture);
    };
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) seenGeo.add(mesh.geometry);
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const m of mats) {
        seenMat.add(m);
        texOf(m);
      }
      const light = o as THREE.DirectionalLight;
      if (light.isLight && light.shadow?.map) light.shadow.map.dispose();
    });
    for (const m of [...interior.materials, ...worlds.materials]) {
      seenMat.add(m);
      texOf(m);
    }
    for (const t of allTextures()) seenTex.add(t);
    for (const g of seenGeo) g.dispose();
    for (const m of seenMat) m.dispose();
    for (const t of seenTex) t.dispose();
    for (const b of bitmaps) b.close();
    envRT?.dispose();
    composer.dispose();
  };

  const api: HubRendererInternal = {
    ready,
    focusMission(id) {
      if (destroyed) return;
      programmaticId = id;
      applyFocus();
    },
    setNisar(state) {
      if (destroyed) return;
      worlds.setTelemetry(state);
      setEarthAnchor(state, true);
    },
    on(ev, fn) {
      let set = listeners.get(ev);
      if (!set) {
        set = new Set();
        listeners.set(ev, set);
      }
      const f = fn as (p: never) => void;
      set.add(f);
      return () => {
        set?.delete(f);
      };
    },
    getCanvas: () => canvas,
    pause() {
      paused = true;
      stop();
    },
    resume() {
      paused = false;
      start();
    },
    forceContextLoss() {
      if (destroyed) return;
      renderer.forceContextLoss();
    },
    forceContextRestore() {
      if (destroyed) return;
      // Deferred: restoreContext() is ignored while the webglcontextlost event is still being dispatched
      // (e.g. when called from a contextLost listener or a promise continuation of one).
      setTimeout(() => {
        if (!destroyed && contextLost) renderer.forceContextRestore();
      }, 0);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      rejectReady(new Error("Hub renderer destroyed before ready."));
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      document.fonts?.removeEventListener?.("loadingdone", onFontsDone);
      listeners.clear();
      try {
        disposeAll();
      } catch (e) {
        console.warn("[hub] dispose error", e);
      }
      renderer.dispose();
      canvas.removeEventListener("webglcontextrestored", onRestored, false);
      if (!contextLost) renderer.forceContextLoss();
      canvas.removeEventListener("webglcontextlost", onLost, false);
      canvas.remove();
    },
    __debug: {
      setView(v) {
        view = v;
      },
      frameTimes: () => [...frameTimes],
      frameCount: () => frameCount,
      benchmark(n, mode) {
        const wasRunning = running;
        stop();
        const ts: number[] = [];
        const px = new Uint8Array(4);
        const once = (): void => {
          if (mode === "post") renderFrame(performance.now());
          else {
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
          }
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        };
        for (let i = 0; i < 10; i++) once(); // warm-up (compiles the screen-target variants for "plain")
        for (let i = 0; i < n; i++) {
          const a = performance.now();
          once();
          ts.push(performance.now() - a);
        }
        if (wasRunning) start();
        ts.sort((x, y) => x - y);
        return { avgMs: ts.reduce((s, v) => s + v, 0) / n, p95Ms: ts[Math.floor(n * 0.95)] ?? 0 };
      },
      labelScreenPos(i) {
        const s = worlds.slots[i];
        if (!s) return null;
        const p = new THREE.Vector3();
        s.label.getWorldPosition(p);
        p.project(camera);
        const r = canvas.getBoundingClientRect();
        return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
      },
      info() {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        const info = renderer.info;
        return {
          renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
          vendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs?.length ?? 0,
          pixelRatio: renderer.getPixelRatio(),
          size: [width, height],
          bloomSelection: [...bloom.selection].map((o) => o.name || o.type),
          msaa,
          shadows,
          earthTextures: earthTier,
          phases: { ...phases },
          nisarLoaded: !!nisar,
          readyMs,
        };
      },
    },
  };
  return api;
}
