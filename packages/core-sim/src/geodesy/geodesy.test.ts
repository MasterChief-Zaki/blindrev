import { describe, expect, it } from "vitest";
import {
  WGS84_A,
  WGS84_B,
  WGS84_E2,
  clampLatDeg,
  degToRad,
  ecefToGeodetic,
  enuBasis,
  geodeticToEcef,
  inverseMeridianArc,
  meridianArc,
  radToDeg,
  rhumbDirect,
  rhumbInverse,
  scaleToAltitude,
  vec3Cross,
  vec3Distance,
  vec3Dot,
  vec3Length,
  wrap360Deg,
  wrapLonDeg,
  wrapLonRad,
} from "./index";

/** Small deterministic PRNG for test sampling (xorshift32). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const dms = (d: number, m: number, s: number) => degToRad(d + m / 60 + s / 3600);

describe("constants", () => {
  it("WGS84 derived values", () => {
    expect(WGS84_B).toBeCloseTo(6356752.314245, 6);
    expect(WGS84_E2).toBeCloseTo(0.00669437999014, 14);
  });
});

describe("angles", () => {
  it("wrapLonDeg into (-180, 180]", () => {
    expect(wrapLonDeg(180)).toBe(180);
    expect(wrapLonDeg(-180)).toBe(180);
    expect(wrapLonDeg(181)).toBe(-179);
    expect(wrapLonDeg(-181)).toBe(179);
    expect(wrapLonDeg(540)).toBe(180);
    expect(wrapLonDeg(-540)).toBe(180);
    expect(wrapLonDeg(360)).toBe(0);
    expect(Object.is(wrapLonDeg(-0), 0)).toBe(true);
    expect(wrapLonDeg(-180.00000000000003)).toBeCloseTo(179.99999999999997, 12);
    expect(wrapLonDeg(1e6 + 0.5)).toBeCloseTo(-79.5, 6);
    expect(Number.isNaN(wrapLonDeg(Number.NaN))).toBe(true);
    for (let x = -1000; x <= 1000; x += 7.3) {
      const w = wrapLonDeg(x);
      expect(w).toBeGreaterThan(-180);
      expect(w).toBeLessThanOrEqual(180);
    }
  });
  it("wrapLonRad / wrap360Deg / clampLatDeg / deg-rad", () => {
    expect(wrapLonRad(-Math.PI)).toBe(Math.PI);
    expect(wrapLonRad(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrap360Deg(-1)).toBe(359);
    expect(wrap360Deg(720)).toBe(0);
    expect(wrap360Deg(-1e-15)).toBeLessThan(360);
    expect(clampLatDeg(95, 89.5)).toBe(89.5);
    expect(clampLatDeg(-95, 89.5)).toBe(-89.5);
    expect(clampLatDeg(12, 89.5)).toBe(12);
    expect(clampLatDeg(95)).toBe(90);
    expect(radToDeg(degToRad(123.456))).toBeCloseTo(123.456, 12);
  });
});

describe("geodeticToEcef", () => {
  it("analytic cases", () => {
    const p0 = geodeticToEcef(0, 0, 0);
    expect(p0).toEqual({ x: WGS84_A, y: 0, z: 0 });
    const pn = geodeticToEcef(0, Math.PI / 2, 100);
    expect(Math.abs(pn.x)).toBeLessThan(1e-6);
    expect(pn.z).toBeCloseTo(WGS84_B + 100, 6);
    const ps = geodeticToEcef(1.234, -Math.PI / 2, 0);
    expect(ps.z).toBeCloseTo(-WGS84_B, 6);
    const pe = geodeticToEcef(Math.PI / 2, 0, 1000);
    expect(pe.y).toBeCloseTo(WGS84_A + 1000, 6);
    expect(Math.abs(pe.x)).toBeLessThan(1e-6);
    // φ = 30°: sin = 1/2 exactly → N = a/√(1 − e²/4)
    const n30 = WGS84_A / Math.sqrt(1 - WGS84_E2 / 4);
    const p30 = geodeticToEcef(0, Math.PI / 6, 0);
    expect(p30.x).toBeCloseTo(n30 * (Math.sqrt(3) / 2), 6);
    expect(p30.z).toBeCloseTo(n30 * (1 - WGS84_E2) * 0.5, 6);
  });
  it("EPSG Guidance Note 7-2 worked example (geographic/geocentric, WGS 84)", () => {
    // φ = 53°48'33.820"N, λ = 2°07'46.380"E, h = 73.0 m → X 3771793.968, Y 140253.342, Z 5124304.349
    const p = geodeticToEcef(dms(2, 7, 46.38), dms(53, 48, 33.82), 73.0);
    expect(Math.abs(p.x - 3771793.968)).toBeLessThan(5e-4);
    expect(Math.abs(p.y - 140253.342)).toBeLessThan(5e-4);
    expect(Math.abs(p.z - 5124304.349)).toBeLessThan(5e-4);
    const g = ecefToGeodetic({ x: 3771793.968, y: 140253.342, z: 5124304.349 });
    expect(Math.abs(g.latRad - dms(53, 48, 33.82))).toBeLessThan(1e-9); // published to 0.001"
    expect(Math.abs(g.lonRad - dms(2, 7, 46.38))).toBeLessThan(1e-9);
    expect(Math.abs(g.heightM - 73.0)).toBeLessThan(1e-3);
  });
  it("writes into out", () => {
    const out = { x: 0, y: 0, z: 0 };
    const r = geodeticToEcef(0.1, 0.2, 3, out);
    expect(r).toBe(out);
  });
});

describe("ecefToGeodetic", () => {
  it("round-trip closure ≤ 1e-6 m over a seeded sample incl. poles and extreme heights", () => {
    const rand = rng(0xc1);
    let maxPos = 0;
    let maxH = 0;
    let maxAng = 0;
    const heights = [-12000, -1000, 0, 1, 8848, 1e5, 7.5e5, 3.6e7, 3.84e8];
    for (let i = 0; i < 20000; i++) {
      const lon = (rand() * 2 - 1) * Math.PI;
      let lat = (rand() * 2 - 1) * (Math.PI / 2);
      if (i % 50 === 0) lat = i % 100 === 0 ? Math.PI / 2 : -Math.PI / 2;
      if (i % 50 === 1) lat = Math.sign(rand() - 0.5) * (Math.PI / 2) * (1 - 1e-12);
      const h = i % 3 === 0 ? (heights[i % heights.length] as number) : (rand() * 2 - 1) * 1e5;
      const p = geodeticToEcef(lon, lat, h);
      const g = ecefToGeodetic(p);
      const q = geodeticToEcef(g.lonRad, g.latRad, g.heightM);
      maxPos = Math.max(maxPos, vec3Distance(p, q));
      maxH = Math.max(maxH, Math.abs(g.heightM - h));
      maxAng = Math.max(maxAng, Math.abs(g.latRad - lat));
      if (Math.abs(lat) < Math.PI / 2 - 1e-9) {
        let dl = Math.abs(g.lonRad - lon);
        if (dl > Math.PI) dl = 2 * Math.PI - dl;
        maxAng = Math.max(maxAng, dl);
      }
    }
    expect(maxPos).toBeLessThan(1e-6);
    expect(maxH).toBeLessThan(1e-6);
    expect(maxAng).toBeLessThan(1e-9);
  });
  it("poles: λ = 0, φ = ±90°, exact height", () => {
    const n = ecefToGeodetic({ x: 0, y: 0, z: WGS84_B + 500 });
    expect(n.lonRad).toBe(0);
    expect(n.latRad).toBe(Math.PI / 2);
    expect(n.heightM).toBeCloseTo(500, 8);
    const s = ecefToGeodetic({ x: 0, y: 0, z: -WGS84_B - 7.5e5 });
    expect(s.latRad).toBe(-Math.PI / 2);
    expect(s.heightM).toBeCloseTo(7.5e5, 7);
  });
  it("near the Earth's centre (inside the evolute) stays finite and closes", () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 20000, y: 0, z: 0 },
      { x: 42000, y: 0, z: 1e-3 },
      { x: 42000, y: 0, z: -1e-3 },
      { x: 1000, y: -2000, z: 3000 },
      { x: -30000, y: 25000, z: -10 },
    ];
    for (const p of pts) {
      const g = ecefToGeodetic(p);
      expect(Number.isFinite(g.latRad) && Number.isFinite(g.lonRad) && Number.isFinite(g.heightM)).toBe(true);
      const q = geodeticToEcef(g.lonRad, g.latRad, g.heightM);
      expect(vec3Distance(p, q)).toBeLessThan(1e-6);
    }
    const c = ecefToGeodetic({ x: 0, y: 0, z: 0 });
    expect(c.latRad).toBe(Math.PI / 2);
    expect(c.heightM).toBeCloseTo(-WGS84_B, 6);
    // the foot point must be the nearest surface point: |h| ≤ distance to any surface sample
    const p = { x: 30000, y: 0, z: 2000 };
    const g = ecefToGeodetic(p);
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k <= 200000; k++) {
      const phi = -Math.PI / 2 + (Math.PI * k) / 200000;
      best = Math.min(best, vec3Distance(p, geodeticToEcef(0, phi, 0)));
    }
    expect(Math.abs(g.heightM)).toBeLessThanOrEqual(best + 1e-6);
  });
  it("longitude in (-π, π]", () => {
    expect(ecefToGeodetic({ x: -WGS84_A, y: -0, z: 0 }).lonRad).toBe(Math.PI);
    expect(ecefToGeodetic({ x: -WGS84_A, y: 0, z: 0 }).lonRad).toBe(Math.PI);
  });
});

describe("enuBasis", () => {
  it("orthonormal and right-handed to 1e-12 everywhere incl. poles", () => {
    const rand = rng(7);
    let worst = 0;
    for (let i = 0; i < 5000; i++) {
      const lon = (rand() * 2 - 1) * Math.PI;
      const lat =
        i < 4 ? ([Math.PI / 2, -Math.PI / 2, 0, degToRad(89.5)][i] as number) : (rand() * 2 - 1) * (Math.PI / 2);
      const { east, north, up } = enuBasis(lon, lat);
      worst = Math.max(
        worst,
        Math.abs(vec3Length(east) - 1),
        Math.abs(vec3Length(north) - 1),
        Math.abs(vec3Length(up) - 1),
        Math.abs(vec3Dot(east, north)),
        Math.abs(vec3Dot(east, up)),
        Math.abs(vec3Dot(north, up)),
        vec3Distance(vec3Cross(east, north), up),
      );
    }
    expect(worst).toBeLessThan(1e-12);
  });
  it("up is the geodetic normal: d/dh of geodeticToEcef", () => {
    const lon = 0.7;
    const lat = -0.4;
    const { up } = enuBasis(lon, lat);
    const a = geodeticToEcef(lon, lat, 0);
    const b = geodeticToEcef(lon, lat, 1000);
    expect((b.x - a.x) / 1000).toBeCloseTo(up.x, 12);
    expect((b.y - a.y) / 1000).toBeCloseTo(up.y, 12);
    expect((b.z - a.z) / 1000).toBeCloseTo(up.z, 12);
  });
});

describe("scaleToAltitude", () => {
  it("keeps lon/lat and sets the height", () => {
    const rand = rng(99);
    for (let i = 0; i < 2000; i++) {
      const lon = (rand() * 2 - 1) * Math.PI;
      const lat = (rand() * 2 - 1) * (Math.PI / 2);
      const h0 = (rand() * 2 - 1) * 1e6;
      const h1 = rand() * 4e7 - 1e4;
      const p = geodeticToEcef(lon, lat, h0);
      const q = scaleToAltitude(p, h1);
      const expected = geodeticToEcef(lon, lat, h1);
      expect(vec3Distance(q, expected)).toBeLessThan(1e-6);
      expect(Math.abs(ecefToGeodetic(q).heightM - h1)).toBeLessThan(1e-6);
    }
  });
});

describe("meridian arc / rhumb", () => {
  it("quarter meridian ≈ 10 001 965.729 m and matches numeric quadrature", () => {
    expect(Math.abs(meridianArc(Math.PI / 2) - 10001965.729)).toBeLessThan(1e-3);
    const quad = (phi: number) => {
      const N = 20000;
      const h = phi / N;
      let s = 0;
      for (let i = 0; i <= N; i++) {
        const x = i * h;
        const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
        const sn = Math.sin(x);
        s += (w * WGS84_A * (1 - WGS84_E2)) / (1 - WGS84_E2 * sn * sn) ** 1.5;
      }
      return (s * h) / 3;
    };
    for (const d of [-60, 10, 45, 80, 89.5]) {
      expect(Math.abs(meridianArc(degToRad(d)) - quad(degToRad(d)))).toBeLessThan(1e-5);
      expect(Math.abs(inverseMeridianArc(meridianArc(degToRad(d))) - degToRad(d))).toBeLessThan(1e-14);
    }
  });
  it("rhumb steps are path-consistent (n small steps == one big step)", () => {
    const lim = degToRad(89.5);
    for (const az of [0, 0.3, Math.PI / 2, 2.0, Math.PI, -1.1]) {
      const big = rhumbDirect(degToRad(10), degToRad(40), az, 500000, lim);
      let ll = { lonRad: degToRad(10), latRad: degToRad(40) };
      for (let i = 0; i < 1000; i++) ll = rhumbDirect(ll.lonRad, ll.latRad, az, 500, lim);
      const p = geodeticToEcef(big.lonRad, big.latRad, 0);
      const q = geodeticToEcef(ll.lonRad, ll.latRad, 0);
      expect(vec3Distance(p, q)).toBeLessThan(1e-4);
    }
  });
  it("east-west motion keeps latitude exactly and distance matches the parallel arc", () => {
    const lat = degToRad(60);
    const r = rhumbDirect(0, lat, Math.PI / 2, 100000, degToRad(89.5));
    expect(r.latRad).toBe(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
    expect(r.lonRad * n * Math.cos(lat)).toBeCloseTo(100000, 6);
  });
  it("inverse recovers distance and azimuth", () => {
    const r = rhumbDirect(0.2, 0.3, 0.8, 1234567, degToRad(89.5));
    const inv = rhumbInverse(0.2, 0.3, r.lonRad, r.latRad);
    expect(inv.distM).toBeCloseTo(1234567, 3);
    expect(inv.azimuthRad).toBeCloseTo(0.8, 10);
  });
  it("latitude wall: poleward motion stops at the limit, east component slides", () => {
    const lim = degToRad(89.5);
    const r = rhumbDirect(0, degToRad(89.4), 0, 1e6, lim);
    expect(r.latRad).toBe(lim);
    const r2 = rhumbDirect(0, degToRad(89.5), Math.PI / 4, 10000, lim);
    expect(r2.latRad).toBe(lim);
    expect(r2.lonRad).toBeGreaterThan(0);
    const r3 = rhumbDirect(0, degToRad(-89.49), Math.PI, 5000, lim);
    expect(r3.latRad).toBe(-lim);
  });
  it("antimeridian wrap both directions", () => {
    const e = rhumbDirect(degToRad(179.9), 0, Math.PI / 2, 50000, degToRad(89.5));
    expect(radToDeg(e.lonRad)).toBeLessThan(-179);
    const w = rhumbDirect(degToRad(-179.9), 0, -Math.PI / 2, 50000, degToRad(89.5));
    expect(radToDeg(w.lonRad)).toBeGreaterThan(179);
  });
});
