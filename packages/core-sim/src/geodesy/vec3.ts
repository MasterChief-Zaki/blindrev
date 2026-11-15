/**
 * Minimal Float64 Vec3 helpers (structurally typed `{x,y,z}`, metres unless stated).
 * Every function takes an optional `out` so hot paths can reuse pre-allocated scratch objects
 * (spec §12). `out` may alias an input.
 */
import type { Vec3 } from "../contracts";

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function vec3Set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function vec3Copy(a: Vec3, out: Vec3 = vec3()): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function vec3Add(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function vec3Sub(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function vec3Scale(a: Vec3, s: number, out: Vec3 = vec3()): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

/** out = a + b * s */
export function vec3AddScaled(a: Vec3, b: Vec3, s: number, out: Vec3 = vec3()): Vec3 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Cross(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function vec3Length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Unit vector of `a`. A zero-length input yields (0,0,0) (never NaN). */
export function vec3Normalize(a: Vec3, out: Vec3 = vec3()): Vec3 {
  const len = vec3Length(a);
  if (len === 0 || !Number.isFinite(len)) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  const inv = 1 / len;
  out.x = a.x * inv;
  out.y = a.y * inv;
  out.z = a.z * inv;
  return out;
}

export function vec3IsFinite(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}
