import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Collects static geometry per material and merges it into one mesh per material
 * (keeps the hub at a few dozen draw calls).
 */
export class Batch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, "YXZ");

  add(
    mat: THREE.Material,
    geo: THREE.BufferGeometry,
    pos: THREE.Vector3Like = { x: 0, y: 0, z: 0 },
    rot: { x?: number; y?: number; z?: number } = {},
    scale: THREE.Vector3Like = { x: 1, y: 1, z: 1 },
  ): void {
    this.e.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0, "YXZ");
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(pos.x, pos.y, pos.z), this.q, new THREE.Vector3(scale.x, scale.y, scale.z));
    this.addMatrix(mat, geo, this.m);
  }

  addMatrix(mat: THREE.Material, geo: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    // Prototype geometries passed in are never uploaded to the GPU, so the caller may reuse them freely.
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    // Keep only the attributes every part has, so mergeGeometries never rejects a mismatch.
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      const n = g.attributes.position?.count ?? 0;
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.morphAttributes = {};
    g.clearGroups();
    const list = this.parts.get(mat);
    if (list) list.push(g);
    else this.parts.set(mat, [g]);
  }

  build(opts: { castShadow?: (m: THREE.Material) => boolean; receiveShadow?: boolean } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = opts.castShadow ? opts.castShadow(mat) : true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}
