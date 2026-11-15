/** Small pure helpers: progress tracking, ROI geometry checks, typed emitter. */

/** Tracks Cesium's tile-queue length into a {loaded, pending} pair for a progress bar. */
export class TileProgress {
  private lastPending = 0;
  loaded = 0;
  pending = 0;
  /** Feed the current queue length; returns the progress payload. A burst resets when the queue drains. */
  update(queueLength: number): { loaded: number; pending: number } {
    const n = Math.max(0, Math.floor(queueLength));
    if (this.lastPending === 0 && n > 0) this.loaded = 0;
    if (n < this.lastPending) this.loaded += this.lastPending - n;
    this.lastPending = n;
    this.pending = n;
    return { loaded: this.loaded, pending: this.pending };
  }
}

interface P {
  lon: number;
  lat: number;
}

function orient(a: P, b: P, c: P): number {
  const v = (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSeg(a: P, b: P, c: P): boolean {
  return (
    Math.min(a.lon, b.lon) <= c.lon &&
    c.lon <= Math.max(a.lon, b.lon) &&
    Math.min(a.lat, b.lat) <= c.lat &&
    c.lat <= Math.max(a.lat, b.lat)
  );
}

function segmentsIntersect(p1: P, p2: P, p3: P, p4: P): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (d1 !== d2 && d3 !== d4) return true;
  if (d1 === 0 && onSeg(p3, p4, p1)) return true;
  if (d2 === 0 && onSeg(p3, p4, p2)) return true;
  if (d3 === 0 && onSeg(p1, p2, p3)) return true;
  if (d4 === 0 && onSeg(p1, p2, p4)) return true;
  return false;
}

/**
 * True when a closed ring (implicitly closed, planar lon/lat) can be safely triangulated for a
 * display fill: ≥ 3 distinct vertices, finite, and no non-adjacent edges intersecting.
 * (Display guard only — the authoritative ROI validation lives in core-sim.)
 */
export function isSimpleRing(ring: ReadonlyArray<P>): boolean {
  const n = ring.length;
  if (n < 3) return false;
  for (const p of ring) if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) return false;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i] as P;
    const a2 = ring[(i + 1) % n] as P;
    if (a1.lon === a2.lon && a1.lat === a2.lat) return false;
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      const b1 = ring[j] as P;
      const b2 = ring[(j + 1) % n] as P;
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

/** Tiny typed event emitter. Listener errors are isolated (logged, never break the render loop). */
export class Emitter<E> {
  private readonly map = new Map<keyof E, Set<(p: never) => void>>();
  on<K extends keyof E>(ev: K, fn: (p: E[K]) => void): () => void {
    let set = this.map.get(ev);
    if (!set) {
      set = new Set();
      this.map.set(ev, set);
    }
    const f = fn as (p: never) => void;
    set.add(f);
    return () => {
      set?.delete(f);
    };
  }
  emit<K extends keyof E>(ev: K, payload: E[K]): void {
    const set = this.map.get(ev);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (p: E[K]) => void)(payload);
      } catch (err) {
        console.error(`[renderer-globe] listener for "${String(ev)}" threw`, err);
      }
    }
  }
  clear(): void {
    this.map.clear();
  }
}

/** Resolve a manifest-relative asset URL against the document base (ARCHITECTURE §2). */
export function resolveAssetUrl(rel: string, base: string): string {
  try {
    return new URL(rel, base).href;
  } catch {
    return rel;
  }
}
