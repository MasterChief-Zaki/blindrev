/**
 * Authoring aid (run once, by hand): proposes answer-key polygon vertices by casting rays from each
 * bowl centre and stopping where the noise-free persistent signal at full growth weakens past
 * AUTHOR_CONTOUR_MM. The printed vertices were reviewed, rounded and frozen in src/reference.ts —
 * the forge never recomputes them, so tuning the simulation cannot silently move the answer key.
 *
 *   tsx src/author-polygons.ts
 */
import { AOI_BOUNDS, BOWLS, STEP_DEFS } from "./config";
import { makeFieldContext, persistentSignal, toKm } from "./field";

const AUTHOR_CONTOUR_MM = -25;
const VERTS: Record<string, number> = { main: 16, "north-east": 12 };

const ctx = makeFieldContext(AOI_BOUNDS, STEP_DEFS);
for (const b of BOWLS) {
  const n = VERTS[b.id] ?? 12;
  const c = toKm(ctx.frame, b.center.lon, b.center.lat);
  const ring: { lon: number; lat: number }[] = [];
  for (let k = 0; k < n; k++) {
    const az = (k / n) * Math.PI * 2;
    let r = 0;
    while (r < 40 && persistentSignal(ctx, c.x + Math.sin(az) * r, c.y + Math.cos(az) * r) <= AUTHOR_CONTOUR_MM)
      r += 0.05;
    const x = c.x + Math.sin(az) * r;
    const y = c.y + Math.cos(az) * r;
    ring.push({
      lon: Math.round((x / ctx.frame.kx + ctx.frame.lon0) * 10000) / 10000,
      lat: Math.round((y / ctx.frame.ky + ctx.frame.lat0) * 10000) / 10000,
    });
  }
  console.log(`// ${b.id}: ${n} vertices, contour ${AUTHOR_CONTOUR_MM} mm`);
  console.log(JSON.stringify(ring));
}
