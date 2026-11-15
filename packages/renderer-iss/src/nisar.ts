import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * NISAR spacecraft (NASA/JPL-Caltech, NASA Eyes on the Earth asset — see public/models/nisar/ASSET_LICENSE.json).
 * Loaded as-is; materials keep their PBR values and get a small space environment map so the
 * metallic foil/bus read correctly (metallic surfaces are black without an environment).
 */
export async function loadNisar(url: string, manager: THREE.LoadingManager): Promise<THREE.Group> {
  const loader = new GLTFLoader(manager);
  const gltf = await loader.loadAsync(url);
  const root = new THREE.Group();
  root.name = "nisar";
  root.add(gltf.scene);
  // The source reflector is two coincident alpha-blended sheets with hair-line wire art: it reads as a
  // see-through dish and mis-sorts against the atmosphere shell. Replace it with ONE opaque, matte
  // gold-mesh surface (the real reflector is a gold-plated wire mesh); the truss rim is a separate mesh.
  let reflectorMat: THREE.MeshStandardMaterial | null = null;
  const retired = new Set<THREE.Material>();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isReflector = !Array.isArray(mesh.material) && mats.some((m) => m.transparent || m.name === "Antenna");
    if (isReflector) {
      for (const m of mats) retired.add(m);
      if (reflectorMat) {
        mesh.visible = false; // second coincident sheet: the double-sided one below covers both faces
        return;
      }
      reflectorMat = new THREE.MeshStandardMaterial({
        name: "reflector-gold-mesh",
        color: "#ffffff",
        map: goldMeshTexture(),
        roughness: 0.82,
        metalness: 0.25,
        side: THREE.DoubleSide,
        transparent: false,
        depthWrite: true,
        fog: false,
      });
      reflectorMat.envMapIntensity = 0.35;
      mesh.material = reflectorMat;
      mesh.renderOrder = 0;
      return;
    }
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.isMeshStandardMaterial) {
        sm.fog = false;
        sm.envMapIntensity = 1.0;
      }
    }
  });
  for (const m of retired) {
    const map = (m as THREE.MeshStandardMaterial).map;
    if (map) {
      const img = map.image as ImageBitmap | undefined;
      map.dispose();
      if (img && typeof img.close === "function") img.close();
    }
    m.dispose();
  }
  return root;
}

/** Matte gold wire-mesh weave (tiled); opaque, no alpha — sorts like any solid surface. */
function goldMeshTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#7d5d1f";
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#d9b45c";
    g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 128);
      g.moveTo(0, i);
      g.lineTo(128, i);
      g.stroke();
    }
    g.strokeStyle = "rgba(240,206,120,0.55)";
    g.lineWidth = 1.5;
    for (let i = -128; i <= 128; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 128, 128);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.anisotropy = 8;
  return tex;
}

/** Tiny procedural "space around Earth" environment for PBR reflections on the spacecraft. */
export function buildSpaceEnvironment(
  renderer: THREE.WebGLRenderer,
  sunDir: THREE.Vector3,
  earthDir: THREE.Vector3,
): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { sunDir: { value: sunDir.clone().normalize() }, earthDir: { value: earthDir.clone().normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir; uniform vec3 earthDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float e = smoothstep(0.55, 0.75, dot(d, earthDir));
        vec3 col = mix(vec3(0.004, 0.005, 0.012), vec3(0.06, 0.12, 0.24), e);
        float s = pow(max(dot(d, sunDir), 0.0), 600.0) * 60.0 + pow(max(dot(d, sunDir), 0.0), 12.0) * 0.6;
        col += vec3(1.0, 0.96, 0.9) * s;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const geo = new THREE.SphereGeometry(10, 32, 16);
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  return rt;
}

export function applyEnv(root: THREE.Object3D, env: THREE.Texture | null): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.isMeshStandardMaterial) {
        sm.envMap = env;
        sm.needsUpdate = true;
      }
    }
  });
}
