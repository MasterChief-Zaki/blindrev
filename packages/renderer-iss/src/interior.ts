import * as THREE from "three";
import { Batch } from "./batch";
import { drawBanner, drawPanel, drawTiles, makeCanvas } from "./canvasArt";
import { AMBER, CYAN, GRAPHITE, INDIGO, INK, MAGENTA } from "./palette";

/**
 * The NISAR Hub hall — a 3D take on the owner-supplied background plate (ARCHITECTURE §10):
 * big chamfered hexagonal viewport, heavy faceted pillars with vertical cyan + magenta light strips,
 * low consoles with small amber indicator lights, dark glossy floor, indigo-violet dusk.
 * World units ≈ metres. Camera sits on +Z looking toward -Z.
 */
export const LAYOUT = {
  ceilingY: 7.4,
  viewZ: -5.6,
  wallT: 0.5,
  /** Viewport opening: half width, bottom y, top y, chamfer. */
  view: { hw: 5.5, y0: 1.05, y1: 6.1, ch: 1.35 },
  pillarX: 6.15,
} as const;

export interface Lantern {
  pivot: THREE.Group;
  glass: THREE.Mesh;
  phase: number;
  amp: number;
}

export interface InteriorRig {
  group: THREE.Group;
  bloomMeshes: THREE.Object3D[];
  lanterns: Lantern[];
  sun: THREE.DirectionalLight;
  lights: THREE.Light[];
  textures: THREE.Texture[];
  materials: THREE.Material[];
}

function std(
  color: THREE.ColorRepresentation,
  rough = 0.82,
  metal = 0.2,
  extra: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true, ...extra });
}

/** Emissive accent material (the only things that may bloom). HDR value = token colour × gain. */
export function glow(hex: string, gain: number): THREE.MeshBasicMaterial {
  const c = new THREE.Color(hex).multiplyScalar(gain);
  return new THREE.MeshBasicMaterial({ color: c, fog: false });
}

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function roundedFrameGeometry(
  w: number,
  h: number,
  r: number,
  border: number,
  depth: number,
  bevel = 0.02,
): THREE.BufferGeometry {
  const outer = roundedRectShape(w, h, r);
  const inner = roundedRectShape(w - border * 2, h - border * 2, Math.max(r - border * 0.6, 0.01));
  outer.holes.push(new THREE.Path(inner.getPoints(8).reverse()));
  return new THREE.ExtrudeGeometry(outer, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
}

/** Chamfered-hexagon outline (wide octagon with long horizontal edges), counter-clockwise. */
export function chamferPts(hw: number, y0: number, y1: number, ch: number, grow = 0): THREE.Vector2[] {
  const a = hw + grow;
  const b0 = y0 - grow;
  const b1 = y1 + grow;
  const c = ch + grow * 0.41;
  return [
    new THREE.Vector2(-a + c, b0),
    new THREE.Vector2(a - c, b0),
    new THREE.Vector2(a, b0 + c),
    new THREE.Vector2(a, b1 - c),
    new THREE.Vector2(a - c, b1),
    new THREE.Vector2(-a + c, b1),
    new THREE.Vector2(-a, b1 - c),
    new THREE.Vector2(-a, b0 + c),
  ];
}

/** A box spanning two points (strut / beam). */
function strut(batch: Batch, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, w: number, d: number): void {
  const len = a.distanceTo(b);
  const geo = new THREE.BoxGeometry(w, len, d);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  batch.addMatrix(mat, geo, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
}

/** Faceted prism (bevelled box) from an extruded chamfered rectangle — reads "low-poly, chunky". */
function chamferBox(w: number, h: number, d: number, c: number): THREE.BufferGeometry {
  const s = new THREE.Shape([
    new THREE.Vector2(-w / 2 + c, -d / 2),
    new THREE.Vector2(w / 2 - c, -d / 2),
    new THREE.Vector2(w / 2, -d / 2 + c),
    new THREE.Vector2(w / 2, d / 2 - c),
    new THREE.Vector2(w / 2 - c, d / 2),
    new THREE.Vector2(-w / 2 + c, d / 2),
    new THREE.Vector2(-w / 2, d / 2 - c),
    new THREE.Vector2(-w / 2, -d / 2 + c),
  ]);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); // extrusion now runs up +Y, shape lies in XZ
  return g;
}

function canvasTex(c: HTMLCanvasElement, srgb: boolean, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

export function createInterior(opts: { shadows: boolean }): InteriorRig {
  const group = new THREE.Group();
  group.name = "interior";
  const textures: THREE.Texture[] = [];
  const bloomMeshes: THREE.Object3D[] = [];
  const { ceilingY, viewZ, wallT, view, pillarX } = LAYOUT;

  const panelC = makeCanvas(256, 256);
  drawPanel(panelC);
  const panelTex = canvasTex(panelC, true, [0.5, 0.5]);
  const tileC = makeCanvas(512, 512);
  drawTiles(tileC);
  const tileTex = canvasTex(tileC, true, [6, 4]);
  textures.push(panelTex, tileTex);

  // --- matte world materials (flat-shaded facets) ---
  const hull = std("#262c4c", 0.86, 0.15, { map: panelTex });
  const pillarMat = std("#2a3a52", 0.8, 0.25, { map: panelTex });
  const graphite = std(GRAPHITE, 0.74, 0.3);
  const frameMat = std("#2b2a5a", 0.7, 0.3);
  const ink = std(INK, 0.9, 0.1);
  const metalDark = std("#22273b", 0.5, 0.6);
  const rubber = std("#0b0c14", 0.95, 0.0);
  const floorMat = new THREE.MeshStandardMaterial({ color: "#151a34", roughness: 0.26, metalness: 0.6, map: tileTex });
  const materials: THREE.Material[] = [hull, pillarMat, graphite, frameMat, ink, metalDark, rubber, floorMat];

  const batch = new Batch();

  // --- viewport wall with the chamfered-hex opening ---
  {
    const s = new THREE.Shape([
      new THREE.Vector2(-11, 0),
      new THREE.Vector2(11, 0),
      new THREE.Vector2(11, ceilingY),
      new THREE.Vector2(-11, ceilingY),
    ]);
    s.holes.push(new THREE.Path(chamferPts(view.hw, view.y0, view.y1, view.ch).reverse()));
    batch.add(hull, new THREE.ExtrudeGeometry(s, { depth: wallT, bevelEnabled: false, curveSegments: 1 }), {
      x: 0,
      y: 0,
      z: viewZ - wallT,
    });
    // Heavy frame ring around the opening (two steps, faceted).
    const ring1 = new THREE.Shape(chamferPts(view.hw, view.y0, view.y1, view.ch, 0.55));
    ring1.holes.push(new THREE.Path(chamferPts(view.hw, view.y0, view.y1, view.ch, -0.02).reverse()));
    batch.add(
      frameMat,
      new THREE.ExtrudeGeometry(ring1, {
        depth: 0.32,
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: 0.08,
        bevelSegments: 1,
      }),
      { x: 0, y: 0, z: viewZ },
    );
    const ring2 = new THREE.Shape(chamferPts(view.hw, view.y0, view.y1, view.ch, 0.95));
    ring2.holes.push(new THREE.Path(chamferPts(view.hw, view.y0, view.y1, view.ch, 0.6).reverse()));
    batch.add(
      graphite,
      new THREE.ExtrudeGeometry(ring2, {
        depth: 0.16,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 1,
      }),
      { x: 0, y: 0, z: viewZ },
    );
    // Lower diagonal braces inside the opening (as on the plate).
    for (const sx of [-1, 1]) {
      strut(
        batch,
        frameMat,
        new THREE.Vector3(sx * view.hw, 3.25, viewZ - 0.25),
        new THREE.Vector3(sx * (view.hw - 1.55), view.y0, viewZ - 0.25),
        0.22,
        0.3,
      );
    }
    // Sill: a low panelled wall under the viewport with seams.
    batch.add(graphite, new THREE.BoxGeometry(view.hw * 2 + 1.2, view.y0, 0.7), {
      x: 0,
      y: view.y0 / 2,
      z: viewZ + 0.35,
    });
    for (let i = -3; i <= 3; i++) {
      batch.add(ink, new THREE.BoxGeometry(0.05, view.y0 * 0.7, 0.02), {
        x: i * 1.6,
        y: view.y0 * 0.5,
        z: viewZ + 0.71,
      });
    }
    batch.add(frameMat, new THREE.BoxGeometry(view.hw * 2 + 1.3, 0.1, 0.8), {
      x: 0,
      y: view.y0 + 0.02,
      z: viewZ + 0.33,
    });
  }
  batch.add(hull, new THREE.BoxGeometry(24, 0.4, 18), { x: 0, y: ceilingY + 0.2, z: 1 });
  for (const sx of [-1, 1]) {
    batch.add(frameMat, new THREE.BoxGeometry(0.6, 0.55, 14), { x: sx * 4.4, y: ceilingY - 0.27, z: 1.5 });
    strut(
      batch,
      frameMat,
      new THREE.Vector3(sx * 4.4, ceilingY - 0.3, viewZ + 1.6),
      new THREE.Vector3(sx * 6.4, ceilingY - 1.5, viewZ + 0.5),
      0.45,
      0.5,
    );
  }
  for (const z of [viewZ + 1.0, -0.8])
    batch.add(graphite, new THREE.BoxGeometry(9.4, 0.45, 0.6), { x: 0, y: ceilingY - 0.28, z });

  // --- floor ---
  batch.add(floorMat, new THREE.BoxGeometry(26, 0.2, 20), { x: 0, y: -0.1, z: 2 });

  // --- heavy faceted pillars (left/right), stepped like the plate ---
  const stripCyan = glow(CYAN, 2.6);
  const stripMagenta = glow(MAGENTA, 2.3);
  for (const sx of [-1, 1]) {
    const x = sx * pillarX;
    const z = -2.0;
    batch.add(pillarMat, chamferBox(1.9, 1.3, 2.2, 0.32), { x, y: 0, z });
    batch.add(pillarMat, chamferBox(1.45, ceilingY - 1.3, 1.8, 0.3), { x: x + sx * 0.12, y: 1.3, z });
    // Stepped chamfer block halfway up.
    batch.add(pillarMat, chamferBox(1.75, 0.9, 2.0, 0.4), { x: x + sx * 0.05, y: 4.6, z });
    batch.add(graphite, chamferBox(1.6, 0.14, 1.95, 0.32), { x: x + sx * 0.05, y: 1.26, z });
    batch.add(graphite, chamferBox(1.9, 0.12, 2.1, 0.35), { x: x + sx * 0.05, y: 5.5, z });
    // Light strips on the inner-front face (accents, bloom). Cyan outer, magenta inner — as on the plate.
    const faceZ = z + 0.91;
    const cy = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.25, 0.04), stripCyan);
    cy.position.set(x - sx * 0.2 + sx * 0.42, 3.55, faceZ);
    cy.name = "accent-strip-cyan";
    const mg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.55, 0.04), stripMagenta);
    mg.position.set(x - sx * 0.48, 3.15, faceZ);
    mg.name = "accent-strip-magenta";
    group.add(cy, mg);
    bloomMeshes.push(cy, mg);
  }

  // --- low consoles at the pillar feet, small amber indicator lights ---
  const amberLed = glow(AMBER, 3.4);
  const consoleScreen = glow(CYAN, 0.9);
  for (const sx of [-1, 1]) {
    const x = sx * 4.55;
    const z = -3.7;
    batch.add(graphite, chamferBox(1.5, 0.95, 0.95, 0.14), { x, y: 0, z });
    // Slanted top with a recessed screen.
    batch.add(graphite, new THREE.BoxGeometry(1.5, 0.12, 0.95), { x, y: 1.0, z: z + 0.05 }, { x: 0.5 });
    batch.add(graphite, chamferBox(0.75, 1.15, 0.85, 0.12), { x: x + sx * 1.15, y: 0, z: z - 0.1 });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), consoleScreen);
    scr.position.set(x, 1.1, z + 0.1);
    scr.rotation.x = -(Math.PI / 2 - 0.5);
    scr.name = "console-screen";
    group.add(scr);
    for (const dx of [-0.07, 0.07]) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), amberLed);
      led.position.set(x + dx, 0.55, z + 0.48);
      led.name = "accent-amber-indicator";
      group.add(led);
      bloomMeshes.push(led);
    }
  }

  // --- cables along the floor/sill (field-built feel) ---
  {
    const runs: THREE.Vector3[][] = [
      [
        new THREE.Vector3(-4.0, 0.05, -3.4),
        new THREE.Vector3(-2.2, 0.04, -4.2),
        new THREE.Vector3(0.4, 0.05, -4.6),
        new THREE.Vector3(3.2, 0.04, -4.1),
        new THREE.Vector3(4.0, 0.06, -3.4),
      ],
      [
        new THREE.Vector3(-5.6, ceilingY - 0.5, -0.8),
        new THREE.Vector3(-3.8, ceilingY - 1.15, -1.0),
        new THREE.Vector3(-1.6, ceilingY - 0.55, -0.8),
      ],
      [
        new THREE.Vector3(5.6, ceilingY - 0.5, -0.8),
        new THREE.Vector3(3.9, ceilingY - 1.25, -1.0),
        new THREE.Vector3(1.6, ceilingY - 0.55, -0.8),
      ],
    ];
    for (const pts of runs) {
      const curve = new THREE.CatmullRomCurve3(pts);
      for (let k = 0; k < 2; k++)
        batch.add(rubber, new THREE.TubeGeometry(curve, 32, 0.04, 6, false), { x: 0, y: k * -0.08, z: k * 0.07 });
    }
  }

  for (const m of batch.build({ castShadow: (m) => m !== floorMat, receiveShadow: true })) group.add(m);

  // --- caged amber lanterns hanging in front of the pillars (glass blooms; cage is matte) ---
  const lanterns: Lantern[] = [];
  const lampGlass = glow(AMBER, 3.6);
  const makeLantern = (pos: THREE.Vector3, cable: number, phase: number, amp: number): void => {
    const pivot = new THREE.Group();
    pivot.position.copy(pos);
    pivot.name = "lantern";
    const lb = new Batch();
    lb.add(rubber, new THREE.CylinderGeometry(0.012, 0.012, cable, 4), { x: 0, y: -cable / 2, z: 0 });
    const y0 = -cable;
    lb.add(metalDark, new THREE.CylinderGeometry(0.07, 0.17, 0.11, 8), { x: 0, y: y0 - 0.05, z: 0 });
    lb.add(metalDark, new THREE.CylinderGeometry(0.17, 0.17, 0.045, 8), { x: 0, y: y0 - 0.46, z: 0 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      lb.add(metalDark, new THREE.BoxGeometry(0.02, 0.38, 0.02), {
        x: Math.cos(a) * 0.155,
        y: y0 - 0.27,
        z: Math.sin(a) * 0.155,
      });
    }
    lb.add(metalDark, new THREE.TorusGeometry(0.155, 0.013, 4, 8), { x: 0, y: y0 - 0.27, z: 0 }, { x: Math.PI / 2 });
    for (const m of lb.build({ receiveShadow: false })) {
      m.castShadow = false;
      pivot.add(m);
    }
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.28, 8), lampGlass);
    glass.position.y = y0 - 0.26;
    glass.name = "accent-lamp-glass";
    pivot.add(glass);
    bloomMeshes.push(glass);
    group.add(pivot);
    lanterns.push({ pivot, glass, phase, amp });
  };
  makeLantern(new THREE.Vector3(-4.4, ceilingY - 0.55, -0.4), 1.6, 0, 0.03);
  makeLantern(new THREE.Vector3(4.4, ceilingY - 0.55, -0.4), 1.9, 1.9, 0.026);

  // --- magenta cloth banner with the cyan hex-ring mark, on the left pillar (matte, never blooms) ---
  {
    const bannerC = makeCanvas(512, 1280);
    drawBanner(bannerC);
    const g = bannerC.getContext("2d");
    if (g) {
      g.globalCompositeOperation = "destination-out";
      g.beginPath();
      g.moveTo(0, 1280);
      g.lineTo(256, 1120);
      g.lineTo(512, 1280);
      g.closePath();
      g.fill();
      g.globalCompositeOperation = "source-over";
    }
    const bannerTex = canvasTex(bannerC, true);
    textures.push(bannerTex);
    const geo = new THREE.PlaneGeometry(0.95, 2.4, 4, 12);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const bx = p.getX(i);
      const t = (1.2 - p.getY(i)) / 2.4;
      p.setZ(i, Math.sin(bx * 6.0 + 0.6) * 0.025 * (0.4 + t) + t * t * 0.05);
    }
    geo.computeVertexNormals();
    geo.translate(0, -1.2, 0);
    const mat = new THREE.MeshStandardMaterial({
      map: bannerTex,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
    });
    materials.push(mat);
    const banner = new THREE.Mesh(geo, mat);
    banner.position.set(-4.25, ceilingY - 0.62, -3.6);
    banner.rotation.y = 0.12;
    banner.castShadow = true;
    banner.receiveShadow = true;
    banner.name = "banner";
    group.add(banner);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.25, 6), metalDark);
    rod.rotation.z = Math.PI / 2;
    banner.add(rod);
  }

  // --- floor reflection streaks (additive, matte-safe: not on the bloom layer) ---
  {
    const streakC = makeCanvas(64, 256);
    const sg = streakC.getContext("2d");
    if (sg) {
      const grad = sg.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "rgba(255,255,255,0.9)");
      grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      sg.fillStyle = grad;
      sg.fillRect(0, 0, 64, 256);
      const side = sg.createLinearGradient(0, 0, 64, 0);
      side.addColorStop(0, "rgba(0,0,0,1)");
      side.addColorStop(0.5, "rgba(0,0,0,0)");
      side.addColorStop(1, "rgba(0,0,0,1)");
      sg.globalCompositeOperation = "destination-out";
      sg.fillStyle = side;
      sg.fillRect(0, 0, 64, 256);
    }
    const streakTex = canvasTex(streakC, true);
    textures.push(streakTex);
    const mk = (hex: string, gain: number, x: number, z: number, w: number, len: number): void => {
      const m = new THREE.MeshBasicMaterial({
        map: streakTex,
        color: new THREE.Color(hex).multiplyScalar(gain),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      materials.push(m);
      const q = new THREE.Mesh(new THREE.PlaneGeometry(w, len), m);
      q.rotation.x = -Math.PI / 2;
      q.position.set(x, 0.006, z + len / 2);
      q.name = "floor-reflection";
      q.renderOrder = 2;
      group.add(q);
    };
    for (const sx of [-1, 1]) mk(AMBER, 0.35, sx * 4.55, -3.15, 0.5, 1.8);
    mk(CYAN, 0.16, 0, viewZ + 0.75, 7.5, 6.0);
  }

  // --- lights: dusk indigo ambience, warm practicals, accent spill for glossy floor streaks ---
  const lights: THREE.Light[] = [];
  lights.push(new THREE.HemisphereLight("#4a3f9a", "#0b0c18", 0.9));
  const sun = new THREE.DirectionalLight("#b9c4ff", 0.45);
  sun.castShadow = opts.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -10;
  sc.right = 10;
  sc.top = 9;
  sc.bottom = -9;
  sc.near = 1;
  sc.far = 40;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  lights.push(sun);
  const horizon = new THREE.PointLight(CYAN, 2.2, 12, 1.4);
  horizon.position.set(0, 3.2, viewZ - 0.6);
  lights.push(horizon);
  for (const sx of [-1, 1]) {
    const lamp = new THREE.PointLight(AMBER, 6.5, 8, 1.6);
    lamp.position.set(sx * 4.4, ceilingY - 2.6, -0.3);
    const cyanSpill = new THREE.PointLight(CYAN, 2.2, 6, 1.6);
    cyanSpill.position.set(sx * (pillarX - 0.2), 3.6, -0.6);
    const magSpill = new THREE.PointLight(MAGENTA, 2.0, 6, 1.6);
    magSpill.position.set(sx * (pillarX - 0.5), 3.0, -0.5);
    const consoleGlow = new THREE.PointLight(AMBER, 0.9, 3, 2);
    consoleGlow.position.set(sx * 4.55, 0.6, -2.9);
    lights.push(lamp, cyanSpill, magSpill, consoleGlow);
  }
  const rim = new THREE.DirectionalLight(INDIGO, 0.38);
  rim.position.set(0, 4, -8);
  lights.push(rim);
  for (const l of lights) group.add(l);
  group.add(sun.target);

  return { group, bloomMeshes, lanterns, sun, lights, textures, materials };
}
