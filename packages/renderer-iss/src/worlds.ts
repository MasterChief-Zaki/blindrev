import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Batch } from "./batch";
import { drawMissionScreen, drawTelemetry, makeCanvas, SCREEN_H, SCREEN_W, themeRamp } from "./canvasArt";
import { glow, LAYOUT, roundedFrameGeometry } from "./interior";
import { AMBER, CYAN, GRAPHITE, INDIGO, INK } from "./palette";
import type { HubMission, HubOrbitState } from "./types";

/**
 * The four worlds arranged around NISAR (ARCHITECTURE §10): floating low-poly hex dioramas, one per case,
 * each with a CRT label screen. Selecting a world (pointer or focusMission) selects its case.
 */

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SCREEN_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float gain;
uniform float time;
uniform float sweep;
uniform float lines;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec2 uv = 0.5 + c * (1.0 + 0.04 * r2);
  vec3 col = texture2D(map, uv).rgb;
  float edge = smoothstep(0.0, 0.008, uv.x) * smoothstep(1.0, 0.992, uv.x) * smoothstep(0.0, 0.02, uv.y) * smoothstep(1.0, 0.98, uv.y);
  float scan = 0.92 + 0.08 * sin(uv.y * lines * 3.14159265);
  float band = exp(-pow((fract(uv.y + time * 0.11) - 0.5) * 14.0, 2.0)) * 0.06 * sweep;
  float vig = 1.0 - r2 * 0.6;
  col = col * scan * vig + vec3(0.24, 0.88, 0.82) * band;
  gl_FragColor = vec4(col * gain * edge, 1.0);
  #include <colorspace_fragment>
}
`;

export interface WorldSlot {
  index: number;
  mission: HubMission | null;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  label: THREE.Mesh;
  material: THREE.ShaderMaterial;
  world: THREE.Group;
  ring: THREE.Mesh;
  baseY: number;
  gain: number;
  targetGain: number;
  /** Hover/select emphasis 0..1 (lift + scale of the diorama, ring pulse); eased in the frame loop. */
  lift: number;
  /** Subsidence world only: the town sinks into the bowl on a slow loop while the pond spreads. */
  sink: { town: THREE.Mesh; pond: THREE.Mesh | null } | null;
}

export interface WorldsRig {
  group: THREE.Group;
  slots: WorldSlot[];
  frame: THREE.Mesh;
  check: THREE.Group;
  telemetry: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh };
  textures: THREE.Texture[];
  materials: THREE.Material[];
  /** Meshes permanently on the bloom layer (task lights, active ring, selection frame + check). */
  bloomMeshes: THREE.Object3D[];
  pickables: THREE.Object3D[];
  slotFor(obj: THREE.Object3D): WorldSlot | null;
  redraw(focusedId: string | null, only?: Set<number>): void;
  setTelemetry(s: HubOrbitState | null): void;
  /** `slot` gets the cyan hero frame (unlocked worlds only); `lockedSlot` gets the dim indigo outline. */
  placeSelection(slot: WorldSlot | null, lockedSlot?: WorldSlot | null): void;
}

export const LABEL = { w: 2.06, h: 2.06 * (SCREEN_H / SCREEN_W) };

/** World layout: a crescent under NISAR. */
const POS: THREE.Vector3Tuple[] = [
  [-4.0, 2.85, -1.7],
  [-1.36, 2.6, -0.8],
  [1.36, 2.6, -0.8],
  [4.0, 2.85, -1.7],
];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000003) / 1000003;
  };
}

const C30 = Math.cos(Math.PI / 6);

/** Hex "distance": the apothem-scaled norm of a flat-top hexagon. */
function hexNorm(x: number, z: number): number {
  return Math.max(Math.abs(z), Math.abs(x * C30 + z * 0.5), Math.abs(-x * C30 + z * 0.5));
}

function colorize(geo: THREE.BufferGeometry, col: THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position?.count ?? 0;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(g.attributes))
    if (k !== "position" && k !== "normal" && k !== "color") g.deleteAttribute(k);
  return g;
}

type Kind = "subsidence" | "forest" | "wetland" | "glacier" | "other";
function kindOf(theme: string): Kind {
  const t = theme.toLowerCase();
  if (t.startsWith("subsid")) return "subsidence";
  if (t.startsWith("defor") || t.startsWith("forest")) return "forest";
  if (t.startsWith("wet")) return "wetland";
  if (t.startsWith("glac") || t.startsWith("ice")) return "glacier";
  return "other";
}

/** Builds one vertex-coloured, flat-shaded diorama (terrain + props + rock base) as a single geometry. */
function buildDiorama(
  theme: string,
  locked: boolean,
  seed: number,
): { geo: THREE.BufferGeometry; water: THREE.BufferGeometry | null; town: THREE.BufferGeometry | null } {
  const kind = kindOf(theme);
  const ramp = themeRamp(theme).map((h) => new THREE.Color(h)) as [THREE.Color, THREE.Color, THREE.Color];
  const R = 0.62; // apothem
  const rnd = rng(seed);
  const N = 18;
  const plane = new THREE.PlaneGeometry(R * 2.4, R * 2.4, N, N);
  plane.rotateX(-Math.PI / 2);
  const p = plane.attributes.position as THREE.BufferAttribute;
  const height = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    const n1 = Math.sin(x * 7.1 + seed) * Math.cos(z * 6.3 - seed * 0.7);
    switch (kind) {
      case "subsidence":
        return 0.13 + n1 * 0.02 - 0.15 * Math.exp(-((r / 0.33) ** 2));
      case "forest":
        return 0.1 + 0.07 * (n1 * 0.5 + 0.5) + 0.05 * Math.sin(x * 3.1 + 1.3);
      case "wetland":
        return 0.045 + 0.035 * n1;
      case "glacier": {
        const ridge = Math.max(0, 0.42 - 0.9 * Math.abs(z + 0.18 + 0.15 * Math.sin(x * 4)));
        return 0.1 + ridge * (0.7 + 0.3 * n1) + 0.02 * n1;
      }
      default:
        return 0.1;
    }
  };
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let z = p.getZ(i);
    const d = hexNorm(x, z);
    if (d > R) {
      x *= R / d;
      z *= R / d;
    }
    p.setXYZ(i, x, height(x, z), z);
  }
  const terrain = plane.toNonIndexed();
  plane.dispose();
  terrain.computeVertexNormals();
  {
    const tp = terrain.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(tp.count * 3);
    const c = new THREE.Color();
    for (let t = 0; t < tp.count; t += 3) {
      const h = (tp.getY(t) + tp.getY(t + 1) + tp.getY(t + 2)) / 3;
      let step: number;
      if (kind === "subsidence") step = h < 0.06 ? 0 : h < 0.12 ? 1 : 2;
      else if (kind === "glacier") step = h < 0.16 ? 0 : h < 0.3 ? 1 : 2;
      else if (kind === "wetland") step = h < 0.05 ? 0 : h < 0.07 ? 1 : 2;
      else step = h < 0.15 ? 0 : h < 0.19 ? 1 : 2;
      c.copy(ramp[step as 0 | 1 | 2]).multiplyScalar(0.92 + rnd() * 0.16);
      for (let k = 0; k < 3; k++) {
        cols[(t + k) * 3] = c.r;
        cols[(t + k) * 3 + 1] = c.g;
        cols[(t + k) * 3 + 2] = c.b;
      }
    }
    terrain.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    terrain.deleteAttribute("uv");
  }
  const parts: THREE.BufferGeometry[] = [terrain];
  // Rock base under the tile.
  const rock = new THREE.Color(ramp[0]).lerp(new THREE.Color(GRAPHITE), 0.72);
  const base = new THREE.CylinderGeometry(R / C30, (R / C30) * 0.6, 0.34, 6, 2);
  base.rotateY(Math.PI / 6);
  base.translate(0, -0.17 + 0.04, 0);
  parts.push(colorize(base, rock));
  const tip = new THREE.ConeGeometry((R / C30) * 0.6, 0.26, 6);
  tip.rotateX(Math.PI);
  tip.rotateY(Math.PI / 6);
  tip.translate(0, -0.43, 0);
  parts.push(colorize(tip, rock.clone().multiplyScalar(0.8)));

  let target = parts;
  const place = (
    g: THREE.BufferGeometry,
    col: THREE.Color,
    x: number,
    z: number,
    y = height(x, z),
    rotY = 0,
    tilt = 0,
  ): void => {
    g.rotateZ(tilt);
    g.rotateY(rotY);
    g.translate(x, y, z);
    target.push(colorize(g, col));
  };
  const townParts: THREE.BufferGeometry[] = [];
  if (kind === "subsidence") {
    // A small town sinking into the bowl: blocks tilt toward the centre. Kept as its own mesh so the
    // hub can lower it on a slow loop (the case in one glance).
    target = townParts;
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.08 + rnd() * 0.42;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (hexNorm(x, z) > R * 0.9) continue;
      const w = 0.06 + rnd() * 0.06;
      const h = 0.06 + rnd() * 0.16;
      const box = new THREE.BoxGeometry(w, h, w * (0.8 + rnd() * 0.5));
      box.translate(0, h / 2 - 0.02, 0);
      const col = rnd() < 0.5 ? ramp[2].clone() : new THREE.Color("#d9d3c7");
      place(box, col, x, z, undefined, rnd() * Math.PI, (0.33 - r) * 0.6 * (rnd() < 0.5 ? -1 : 1));
    }
    target = parts;
    // Aqueduct line crossing the tile.
    const canal = new THREE.BoxGeometry(1.15, 0.03, 0.045);
    canal.rotateY(0.5);
    canal.translate(0, 0.16, 0.05);
    parts.push(colorize(canal, new THREE.Color("#5fb6c9")));
  } else if (kind === "forest") {
    for (let i = 0; i < 26; i++) {
      const x = (rnd() * 2 - 1) * R;
      const z = (rnd() * 2 - 1) * R;
      if (hexNorm(x, z) > R * 0.86) continue;
      const s = 0.7 + rnd() * 0.6;
      const cone = new THREE.ConeGeometry(0.065 * s, 0.22 * s, 5);
      cone.translate(0, 0.15 * s, 0);
      place(cone, (rnd() < 0.5 ? ramp[0] : ramp[1]).clone(), x, z);
      const trunk = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 4);
      trunk.translate(0, 0.02, 0);
      place(trunk, new THREE.Color("#4a3a2a"), x, z);
    }
  } else if (kind === "wetland") {
    for (let i = 0; i < 22; i++) {
      const x = (rnd() * 2 - 1) * R;
      const z = (rnd() * 2 - 1) * R;
      if (hexNorm(x, z) > R * 0.88) continue;
      const reed = new THREE.BoxGeometry(0.012, 0.08 + rnd() * 0.08, 0.012);
      reed.translate(0, 0.05, 0);
      place(reed, ramp[2].clone(), x, z, undefined, rnd(), (rnd() - 0.5) * 0.4);
    }
  } else if (kind === "glacier") {
    for (let i = 0; i < 9; i++) {
      const x = (rnd() * 2 - 1) * R * 0.8;
      const z = 0.25 + rnd() * 0.3;
      if (hexNorm(x, z) > R * 0.9) continue;
      const berg = new THREE.DodecahedronGeometry(0.04 + rnd() * 0.04, 0);
      place(berg, ramp[2].clone(), x, z, 0.08, rnd() * 3);
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("diorama merge failed");
  const town = townParts.length ? mergeGeometries(townParts, false) : null;
  for (const g of townParts) g.dispose();
  for (const geo of [merged, town]) {
    if (!geo) continue;
    if (locked) {
      // Dim + cool the locked worlds (still recognisable; the label carries the lock glyph + word).
      const col = geo.attributes.color as THREE.BufferAttribute;
      const ink = new THREE.Color(INK);
      const c = new THREE.Color();
      for (let i = 0; i < col.count; i++) {
        c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(ink, 0.5);
        col.setXYZ(i, c.r, c.g, c.b);
      }
    }
    geo.computeVertexNormals();
  }
  let water: THREE.BufferGeometry | null = null;
  if (kind === "wetland" || kind === "subsidence") {
    // Hex water plane (wetland floods; subsidence bowl holds a pond).
    const w = new THREE.CircleGeometry(kind === "wetland" ? (R / C30) * 0.985 : 0.22, 6);
    w.rotateX(-Math.PI / 2);
    if (kind === "wetland") w.rotateY(Math.PI / 6);
    w.translate(0, kind === "wetland" ? 0.052 : 0.0, 0);
    water = w;
  }
  return { geo: merged, water, town };
}

export function createWorlds(missions: HubMission[], cameraPos: THREE.Vector3): WorldsRig {
  const group = new THREE.Group();
  group.name = "worlds";
  const textures: THREE.Texture[] = [];
  const dioramaMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: true,
  });
  const waterMat = new THREE.MeshStandardMaterial({
    color: "#3E9C9A",
    roughness: 0.18,
    metalness: 0.3,
    flatShading: true,
  });
  const waterLocked = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#3E9C9A").lerp(new THREE.Color(INK), 0.5),
    roughness: 0.25,
    metalness: 0.3,
  });
  const bezelMat = new THREE.MeshStandardMaterial({
    color: "#2b3352",
    roughness: 0.55,
    metalness: 0.4,
    flatShading: true,
  });
  const recess = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.9, metalness: 0.1 });
  const rivetMat = new THREE.MeshStandardMaterial({
    color: "#69708a",
    roughness: 0.45,
    metalness: 0.7,
    flatShading: true,
  });
  const ringLocked = new THREE.MeshStandardMaterial({ color: INDIGO, roughness: 0.6, metalness: 0.2 });
  const ringActive = glow(CYAN, 2.2);
  const amberLamp = glow(AMBER, 3.2);
  const materials: THREE.Material[] = [
    dioramaMat,
    waterMat,
    waterLocked,
    bezelMat,
    recess,
    rivetMat,
    ringLocked,
    ringActive,
    amberLamp,
  ];
  const bloomMeshes: THREE.Object3D[] = [];
  const slots: WorldSlot[] = [];
  const pickables: THREE.Object3D[] = [];

  const bezelGeo = roundedFrameGeometry(LABEL.w + 0.16, LABEL.h + 0.16, 0.09, 0.1, 0.07, 0.02);
  const rivetGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.03, 6);
  const lensGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8);
  lensGeo.rotateX(Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry((0.62 / C30) * 1.12, 0.022, 4, 6);
  ringGeo.rotateX(Math.PI / 2);
  const labelGeo = new THREE.PlaneGeometry(LABEL.w, LABEL.h);

  POS.forEach((pos, i) => {
    const m = missions[i] ?? null;
    const anchor = new THREE.Group();
    anchor.position.set(pos[0], pos[1], pos[2]);
    anchor.rotation.y = Math.atan2(cameraPos.x - pos[0], cameraPos.z - pos[2]) * 0.85;
    group.add(anchor);
    // Diorama.
    const world = new THREE.Group();
    world.name = `world-${i}`;
    const { geo, water, town } = buildDiorama(m?.theme ?? "other", m ? m.locked : true, 1013 + i * 7919);
    const dio = new THREE.Mesh(geo, dioramaMat);
    dio.castShadow = true;
    dio.receiveShadow = true;
    world.add(dio);
    let pond: THREE.Mesh | null = null;
    if (water) {
      const wm = new THREE.Mesh(water, m && !m.locked ? waterMat : waterLocked);
      wm.receiveShadow = true;
      if ((m?.theme ?? "").toLowerCase().startsWith("subsid")) {
        wm.position.y = 0.0;
        pond = wm;
      }
      world.add(wm);
    }
    let townMesh: THREE.Mesh | null = null;
    if (town) {
      townMesh = new THREE.Mesh(town, dioramaMat);
      townMesh.receiveShadow = true;
      townMesh.userData.slot = i;
      townMesh.name = `world-${i}-town`;
      world.add(townMesh);
      pickables.push(townMesh);
    }
    world.rotation.x = 0.32; // tilt toward the camera so the tops read
    world.scale.setScalar(1.05);
    anchor.add(world);
    const ring = new THREE.Mesh(ringGeo, m && !m.locked ? ringActive : ringLocked);
    ring.position.y = -0.5;
    ring.rotation.x = 0.32;
    ring.name = m && !m.locked ? "accent-world-ring" : "world-ring-locked";
    anchor.add(ring);
    if (m && !m.locked) bloomMeshes.push(ring);

    // Label screen below the world.
    const lb = new Batch();
    const ly = -1.3;
    lb.add(bezelMat, bezelGeo, { x: 0, y: ly, z: -0.06 });
    lb.add(recess, new THREE.BoxGeometry(LABEL.w + 0.04, LABEL.h + 0.04, 0.05), { x: 0, y: ly, z: -0.05 });
    for (const [rx, ry] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      lb.add(
        rivetMat,
        rivetGeo,
        { x: rx * (LABEL.w / 2 + 0.03), y: ly + ry * (LABEL.h / 2 + 0.03), z: 0.035 },
        { x: Math.PI / 2 },
      );
    }
    // Strut from label up to the world's ring (field-built mount).
    lb.add(bezelMat, new THREE.BoxGeometry(0.07, 0.42, 0.07), { x: 0, y: ly + LABEL.h / 2 + 0.28, z: -0.08 });
    for (const mesh of lb.build({ receiveShadow: true })) anchor.add(mesh);

    const canvas = makeCanvas(SCREEN_W, SCREEN_H);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    textures.push(texture);
    const material = new THREE.ShaderMaterial({
      vertexShader: SCREEN_VERT,
      fragmentShader: SCREEN_FRAG,
      uniforms: {
        map: { value: texture },
        gain: { value: 1 },
        time: { value: 0 },
        sweep: { value: 1 },
        lines: { value: 200 },
      },
      fog: false,
    });
    materials.push(material);
    const label = new THREE.Mesh(labelGeo, material);
    label.position.set(0, ly, 0.02);
    label.name = `label-${i}`;
    anchor.add(label);
    const base = m ? (m.locked ? 0.6 : 1.0) : 0.35;
    const slot: WorldSlot = {
      index: i,
      mission: m,
      canvas,
      texture,
      label,
      material,
      world,
      ring,
      baseY: 0,
      gain: base,
      targetGain: base,
      lift: 0,
      sink: townMesh ? { town: townMesh, pond } : null,
    };
    label.userData.slot = i;
    dio.userData.slot = i;
    pickables.push(label, dio);
    slots.push(slot);
    if (m && !m.locked) {
      const lens = new THREE.Mesh(lensGeo, amberLamp);
      lens.position.set(-LABEL.w / 2 + 0.01, ly - LABEL.h / 2 - 0.05, 0.05);
      lens.name = `accent-task-light-${i}`;
      anchor.add(lens);
      bloomMeshes.push(lens);
    }
  });

  // Telemetry strip on the top frame of the viewport.
  const tCanvas = makeCanvas(1024, 112);
  const tTex = new THREE.CanvasTexture(tCanvas);
  tTex.colorSpace = THREE.SRGBColorSpace;
  textures.push(tTex);
  const tMat = new THREE.ShaderMaterial({
    vertexShader: SCREEN_VERT,
    fragmentShader: SCREEN_FRAG,
    uniforms: {
      map: { value: tTex },
      gain: { value: 0.95 },
      time: { value: 0 },
      sweep: { value: 0 },
      lines: { value: 56 },
    },
    fog: false,
  });
  materials.push(tMat);
  const tMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.35), tMat);
  tMesh.position.set(0, LAYOUT.view.y1 + 0.33, LAYOUT.viewZ + 0.62);
  tMesh.name = "telemetry-strip";
  group.add(tMesh);
  const tb = new THREE.Mesh(roundedFrameGeometry(3.34, 0.48, 0.07, 0.07, 0.06, 0.015), bezelMat);
  tb.position.set(0, LAYOUT.view.y1 + 0.33, LAYOUT.viewZ + 0.55);
  group.add(tb);

  // Selection frame (cyan) + check-mark badge: shape cues, never colour alone.
  const frameMat = glow(CYAN, 3.0);
  materials.push(frameMat);
  const frame = new THREE.Mesh(roundedFrameGeometry(LABEL.w + 0.36, LABEL.h + 0.36, 0.15, 0.035, 0.02, 0), frameMat);
  frame.name = "accent-selection-frame";
  frame.visible = false;
  const check = new THREE.Group();
  check.name = "selection-check";
  {
    const discMat = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6, flatShading: true });
    materials.push(discMat);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 6), discMat);
    disc.rotation.x = Math.PI / 2;
    check.add(disc);
    const s = new THREE.Shape();
    s.moveTo(-0.075, 0.0);
    s.lineTo(-0.045, -0.03);
    s.lineTo(-0.02, -0.005);
    s.lineTo(0.06, 0.075);
    s.lineTo(0.088, 0.045);
    s.lineTo(-0.02, -0.065);
    s.lineTo(-0.105, 0.03);
    s.closePath();
    const mark = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }), frameMat);
    mark.position.set(0.008, 0, 0.02);
    mark.name = "accent-check";
    check.add(mark);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 4, 6), frameMat);
    ring.rotation.z = Math.PI / 6;
    ring.position.z = 0.02;
    ring.name = "accent-check-ring";
    check.add(ring);
  }
  check.visible = false;
  // Focus outline for a LOCKED world: thin, matte indigo, never on the bloom layer. The bright cyan hero
  // frame above is reserved for a playable (unlocked) world.
  const lockedFrameMat = new THREE.MeshBasicMaterial({ color: INDIGO, fog: false });
  materials.push(lockedFrameMat);
  const lockedFrame = new THREE.Mesh(
    roundedFrameGeometry(LABEL.w + 0.3, LABEL.h + 0.3, 0.13, 0.014, 0.012, 0),
    lockedFrameMat,
  );
  lockedFrame.name = "locked-focus-outline";
  lockedFrame.visible = false;
  group.add(frame, check, lockedFrame);

  let lastTele = "";
  return {
    group,
    slots,
    frame,
    check,
    telemetry: { canvas: tCanvas, texture: tTex, mesh: tMesh },
    textures,
    materials,
    bloomMeshes: [...bloomMeshes, frame, ...check.children.filter((o) => o.name.startsWith("accent"))],
    pickables,
    slotFor(obj) {
      const i = obj.userData.slot as number | undefined;
      return i === undefined ? null : (slots[i] ?? null);
    },
    redraw(focusedId, only) {
      for (const s of slots) {
        if (only && !only.has(s.index)) continue;
        if (s.mission) drawMissionScreen(s.canvas, s.mission, s.mission.id === focusedId, s.index);
        else drawEmpty(s.canvas);
        s.texture.needsUpdate = true;
      }
    },
    setTelemetry(st) {
      const key = st
        ? `${st.latDeg.toFixed(2)}|${st.lonDeg.toFixed(2)}|${Math.round(st.heightM / 1000)}|${st.timeIso.slice(11, 19)}`
        : "none";
      if (key === lastTele) return;
      lastTele = key;
      drawTelemetry(tCanvas, st);
      tTex.needsUpdate = true;
    },
    placeSelection(slot, lockedSlot = null) {
      if (lockedSlot) {
        const la = lockedSlot.label.parent as THREE.Object3D;
        la.updateMatrixWorld(true);
        lockedFrame.position.copy(
          new THREE.Vector3(0, lockedSlot.label.position.y, 0.035).applyMatrix4(la.matrixWorld),
        );
        lockedFrame.quaternion.copy(la.quaternion);
        lockedFrame.visible = true;
      } else lockedFrame.visible = false;
      if (!slot) {
        frame.visible = false;
        check.visible = false;
        return;
      }
      const anchor = slot.label.parent as THREE.Object3D;
      anchor.updateMatrixWorld(true);
      const p = new THREE.Vector3(0, slot.label.position.y, 0.035).applyMatrix4(anchor.matrixWorld);
      frame.position.copy(p);
      frame.quaternion.copy(anchor.quaternion);
      frame.visible = true;
      const unlocked = !!slot.mission && !slot.mission.locked;
      check.visible = unlocked;
      const cp = new THREE.Vector3(LABEL.w / 2 + 0.1, slot.label.position.y + LABEL.h / 2 + 0.1, 0.09).applyMatrix4(
        anchor.matrixWorld,
      );
      check.position.copy(cp);
      check.quaternion.copy(anchor.quaternion);
    },
  };
}

function drawEmpty(c: HTMLCanvasElement): void {
  const g = c.getContext("2d");
  if (!g) return;
  g.fillStyle = INK;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "rgba(243,245,247,0.35)";
  g.font = `400 34px "IBM Plex Mono", Consolas, monospace`;
  g.textAlign = "center";
  g.fillText("NO SIGNAL", c.width / 2, c.height / 2);
}
