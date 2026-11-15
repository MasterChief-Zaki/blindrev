/**
 * Pure keyboard / wheel mapping for the custom ENU camera (spec §7). No DOM, no Cesium.
 * Keys are KeyboardEvent.code values (physical positions, layout independent).
 */

export const CAMERA_KEY_CODES: ReadonlySet<string> = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyZ",
  "KeyX",
  "KeyQ",
  "KeyE",
  "KeyR",
  "KeyF",
]);

/** Screen-relative intent, each axis in [-1, 1]. forward/right are relative to the camera heading. */
export interface CameraIntent {
  forward: number;
  right: number;
  zoom: number; // > 0 = zoom in (Z)
  rotate: number; // > 0 = heading increases (E, clockwise seen from above)
  tilt: number; // > 0 = tilt toward the horizon (R)
}

export const ZERO_INTENT: Readonly<CameraIntent> = Object.freeze({ forward: 0, right: 0, zoom: 0, rotate: 0, tilt: 0 });

export function keysToIntent(held: ReadonlySet<string>): CameraIntent {
  const axis = (pos: string, neg: string): number => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
  let forward = axis("KeyW", "KeyS");
  let right = axis("KeyD", "KeyA");
  const len = Math.hypot(forward, right);
  if (len > 1) {
    forward /= len;
    right /= len;
  }
  return {
    forward,
    right,
    zoom: axis("KeyZ", "KeyX"),
    rotate: axis("KeyE", "KeyQ"),
    tilt: axis("KeyR", "KeyF"),
  };
}

/**
 * Rotate a heading-relative pan (forward/right) into the local East–North plane.
 * Heading is clockwise from north (degrees). forward = (sin h, cos h), right = (cos h, -sin h) in (E, N).
 */
export function headingRelativeToEastNorth(
  forward: number,
  right: number,
  headingDeg: number,
): { east: number; north: number } {
  const h = (headingDeg * Math.PI) / 180;
  const s = Math.sin(h);
  const c = Math.cos(h);
  const east = forward * s + right * c;
  const north = forward * c - right * s;
  return { east: clampUnit(east), north: clampUnit(north) };
}

export function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : Math.min(v, 1);
}

/**
 * Normalise a WheelEvent delta into zoom "notches" (positive = zoom in, matching CamInput.zoom).
 * deltaMode 0 = pixels (100 px ≈ one notch), 1 = lines (3 lines ≈ one notch), 2 = pages.
 * Clamped to ±4 notches per event so trackpad bursts stay controllable.
 */
export function wheelDeltaToNotches(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const perNotch = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : 100;
  const n = -deltaY / perNotch;
  return n < -4 ? -4 : Math.min(n, 4);
}

/** True when keyboard focus sits in an element that owns typing (HUD inputs, dialogs). */
export function isTypingTarget(
  el: {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (sel: string) => unknown;
  } | null,
): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === "function") {
    const hit = el.closest('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
    if (hit) return true;
  }
  return false;
}
