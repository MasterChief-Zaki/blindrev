import * as THREE from "three";

/**
 * Earth seen from orbit: one sphere with a custom matte shader (day map, night lights,
 * drifting cloud layer, ocean glint, restrained atmosphere rim) + a back-side halo shell + stars.
 * Earth is never on the bloom layer.
 *
 * Texture packing (see public/textures/hub/ASSET_LICENSE.json):
 *   earth_day_*.jpg  RGB  sRGB   NASA Blue Marble (land + ocean)
 *   earth_aux_*.jpg  R = night lights, G = clouds, B = water mask (linear data)
 */

const EARTH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const EARTH_FRAG = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D auxMap;
uniform vec3 sunDir;
uniform float cloudOffset;
uniform float exposure;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);
  float ndl = dot(n, sunDir);
  float dayMix = smoothstep(-0.10, 0.22, ndl);
  vec3 day = texture2D(dayMap, vUv).rgb;
  vec3 aux = texture2D(auxMap, vUv).rgb;
  float cloud = texture2D(auxMap, vec2(vUv.x + cloudOffset, vUv.y)).g;
  float water = aux.b;
  float cl = smoothstep(0.18, 0.85, cloud);
  // Deep ocean tint (Blue Marble oceans are near-black navy).
  day = mix(day, day * vec3(0.55, 0.85, 1.15) + vec3(0.0, 0.006, 0.02), water);
  vec3 sun = vec3(1.0, 0.97, 0.92);
  float lambert = max(ndl, 0.0);
  float wrap = max((ndl + 0.15) / 1.15, 0.0);
  vec3 col = day * wrap * sun * 1.5;
  col = mix(col, vec3(0.95, 0.97, 1.0) * lambert * 1.45, cl * 0.92);
  // Ocean glint (matte overall; small and soft).
  vec3 h = normalize(sunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * water * (1.0 - cl);
  col += sun * spec * 0.35 * dayMix;
  // Night lights, warm, kept low (Earth never blooms).
  float city = pow(aux.r, 1.6);
  col += vec3(1.0, 0.70, 0.36) * city * (1.0 - dayMix) * (1.0 - cl * 0.85) * 0.75;
  // Twilight band + atmosphere rim on the disc.
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.5);
  float twilight = smoothstep(-0.25, 0.05, ndl) * (1.0 - smoothstep(0.05, 0.35, ndl));
  vec3 atm = vec3(0.24, 0.70, 0.95);
  col += atm * fres * (0.25 + 0.75 * smoothstep(-0.3, 0.5, ndl)) * 0.6;
  col += vec3(0.9, 0.45, 0.25) * twilight * 0.06;
  gl_FragColor = vec4(col * exposure, 1.0);
  #include <colorspace_fragment>
}
`;

const HALO_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const HALO_FRAG = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 earthCenter;
uniform float earthRadius;
uniform float haloRadius;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  // Distance of the view ray from the Earth centre -> altitude of the ray's closest approach.
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vPosW - ro);
  vec3 oc = earthCenter - ro;
  float tca = dot(oc, rd);
  float d = sqrt(max(dot(oc, oc) - tca * tca, 0.0));
  float h = clamp((d - earthRadius) / (haloRadius - earthRadius), 0.0, 1.0);
  float dens = pow(1.0 - h, 3.2);
  vec3 closest = ro + rd * tca;
  float sunF = 0.35 + 0.65 * smoothstep(-0.35, 0.55, dot(normalize(closest - earthCenter), sunDir));
  float line = pow(1.0 - h, 14.0);
  vec3 col = mix(vec3(0.20, 0.22, 0.85), vec3(0.24, 0.85, 0.95), dens) * dens * sunF * 0.95 + vec3(0.24, 0.88, 0.82) * line * sunF * 1.4;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const STAR_VERT = /* glsl */ `
attribute float size;
attribute vec3 tint;
uniform float pixelRatio;
varying vec3 vTint;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * pixelRatio;
  gl_Position = projectionMatrix * mv;
}
`;
const STAR_FRAG = /* glsl */ `
varying vec3 vTint;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(p));
  gl_FragColor = vec4(vTint * a, 1.0);
  #include <colorspace_fragment>
}
`;

export interface EarthRig {
  group: THREE.Group;
  earth: THREE.Mesh;
  /** Rotates with the planet; Earth mesh is its child. */
  spin: THREE.Group;
  material: THREE.ShaderMaterial;
  halo: THREE.Mesh;
  stars: THREE.Points;
  setTextures(day: THREE.Texture, aux: THREE.Texture): void;
  setSun(dirWorld: THREE.Vector3): void;
  setPixelRatio(pr: number): void;
  center: THREE.Vector3;
  radius: number;
}

export function createEarth(center: THREE.Vector3, radius: number, segments: number): EarthRig {
  const group = new THREE.Group();
  group.name = "earth-rig";
  const spin = new THREE.Group();
  spin.position.copy(center);
  group.add(spin);

  const placeholder = new THREE.DataTexture(new Uint8Array([10, 14, 40, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    vertexShader: EARTH_VERT,
    fragmentShader: EARTH_FRAG,
    uniforms: {
      dayMap: { value: placeholder },
      auxMap: { value: placeholder },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      cloudOffset: { value: 0 },
      exposure: { value: 1 },
    },
    fog: false,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.round(segments / 2)), material);
  earth.name = "earth";
  spin.add(earth);

  const haloR = radius * 1.035;
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    uniforms: {
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      earthCenter: { value: center.clone() },
      earthRadius: { value: radius },
      haloRadius: { value: haloR },
    },
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(haloR, 96, 48), haloMat);
  halo.position.copy(center);
  halo.name = "earth-halo";
  group.add(halo);

  // Stars: deterministic, on a far sphere; Earth occludes them by depth.
  const N = 2600;
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const tint = new Float32Array(N * 3);
  let s = 0x9e3779b9;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const R = 4200;
    pos[i * 3] = R * r * Math.cos(th);
    pos[i * 3 + 1] = R * u;
    pos[i * 3 + 2] = R * r * Math.sin(th);
    const m = rnd();
    size[i] = 0.9 + m * m * m * 2.6;
    const b = 0.35 + m * 0.9;
    const t = rnd();
    // Mostly white, some cool blue, a few warm.
    const c = t < 0.15 ? [1.0, 0.85, 0.7] : t < 0.45 ? [0.75, 0.85, 1.0] : [1, 1, 1];
    tint[i * 3] = (c[0] ?? 1) * b;
    tint[i * 3 + 1] = (c[1] ?? 1) * b;
    tint[i * 3 + 2] = (c[2] ?? 1) * b;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  sg.setAttribute("size", new THREE.BufferAttribute(size, 1));
  sg.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: { pixelRatio: { value: 1 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(sg, starMat);
  stars.name = "stars";
  stars.frustumCulled = false;
  stars.renderOrder = -10;
  group.add(stars);

  return {
    group,
    earth,
    spin,
    material,
    halo,
    stars,
    center: center.clone(),
    radius,
    setTextures(day, aux) {
      const u = material.uniforms;
      if (u.dayMap) u.dayMap.value = day;
      if (u.auxMap) u.auxMap.value = aux;
    },
    setSun(dir) {
      const a = material.uniforms.sunDir;
      if (a) (a.value as THREE.Vector3).copy(dir);
      const b = haloMat.uniforms.sunDir;
      if (b) (b.value as THREE.Vector3).copy(dir);
    },
    setPixelRatio(pr) {
      const u = starMat.uniforms.pixelRatio;
      if (u) u.value = pr;
    },
  };
}

/** Local (Earth-mesh) unit direction for geodetic lon/lat, matching THREE.SphereGeometry's equirect UVs. */
export function earthLocalDir(lonDeg: number, latDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const lon = THREE.MathUtils.degToRad(lonDeg);
  const lat = THREE.MathUtils.degToRad(latDeg);
  return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

/**
 * Orientation that puts (lon, lat) directly under `upWorld` (from the Earth centre) with the ground-track
 * heading (deg clockwise from north) pointing along `forwardWorld`.
 */
export function earthOrientation(
  lonDeg: number,
  latDeg: number,
  headingDeg: number,
  upWorld: THREE.Vector3,
  forwardWorld: THREE.Vector3,
  out = new THREE.Quaternion(),
): THREE.Quaternion {
  const up = earthLocalDir(lonDeg, latDeg);
  const northPole = new THREE.Vector3(0, 1, 0);
  let east = new THREE.Vector3().crossVectors(northPole, up);
  if (east.lengthSq() < 1e-8) east = new THREE.Vector3(0, 0, -1);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const h = THREE.MathUtils.degToRad(headingDeg);
  const track = north
    .clone()
    .multiplyScalar(Math.cos(h))
    .add(east.clone().multiplyScalar(Math.sin(h)))
    .normalize();
  const side = new THREE.Vector3().crossVectors(track, up).normalize();
  const local = new THREE.Matrix4().makeBasis(track, up, side);
  const fw = forwardWorld
    .clone()
    .sub(upWorld.clone().multiplyScalar(forwardWorld.dot(upWorld)))
    .normalize();
  const sideW = new THREE.Vector3().crossVectors(fw, upWorld).normalize();
  const world = new THREE.Matrix4().makeBasis(fw, upWorld, sideW);
  // R * local = world  =>  R = world * local^T
  const r = world.multiply(local.transpose());
  return out.setFromRotationMatrix(r);
}
