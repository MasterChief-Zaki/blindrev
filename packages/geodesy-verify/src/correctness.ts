/**
 * Correctness vector set (spec §8, right-hand column): independent analytic oracles + round-trip
 * closure. No Cesium import here — a Cesium problem can never fail this set.
 */
import { ecefToGeodetic, enuBasis, geodeticToEcef, scaleToAltitude } from "@blindrev/core-sim";
import { MaxTracker, type Metric, angleDiff, fmtSample, metric } from "./metric";
import {
  A,
  B,
  E2,
  type V3,
  geodeticSample,
  oracleEcefToGeodetic,
  oracleGeodeticToEcef,
  oracleSurfaceNormalAt,
  seededRandom,
} from "./oracle";

export const SEED = 0x5eed_c1;
export const SAMPLE_N = 20000;

const compErr = (p: V3, q: V3) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z));
const dist = (p: V3, q: V3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
const dms = (d: number, m: number, s: number) => ((d + m / 60 + s / 3600) * Math.PI) / 180;

/** Exact analytic forward vectors (trig values exact or closed-form). */
export function analyticForwardVectors(): { lon: number; lat: number; h: number; ecef: V3; label: string }[] {
  const s2 = Math.SQRT1_2;
  const n45 = A / Math.sqrt(1 - E2 / 2);
  const n30 = A / Math.sqrt(1 - E2 / 4);
  const n60 = A / Math.sqrt(1 - (3 * E2) / 4);
  const h = 1234.5;
  return [
    { label: "equator / prime meridian", lon: 0, lat: 0, h: 0, ecef: { x: A, y: 0, z: 0 } },
    { label: "equator / prime meridian, h", lon: 0, lat: 0, h, ecef: { x: A + h, y: 0, z: 0 } },
    { label: "equator / 90°E", lon: Math.PI / 2, lat: 0, h: 0, ecef: { x: 0, y: A, z: 0 } },
    { label: "equator / 180°", lon: Math.PI, lat: 0, h, ecef: { x: -(A + h), y: 0, z: 0 } },
    { label: "equator / 90°W", lon: -Math.PI / 2, lat: 0, h: -h, ecef: { x: 0, y: -(A - h), z: 0 } },
    { label: "north pole", lon: 0, lat: Math.PI / 2, h: 0, ecef: { x: 0, y: 0, z: B } },
    { label: "south pole, h", lon: 0, lat: -Math.PI / 2, h, ecef: { x: 0, y: 0, z: -(B + h) } },
    { label: "north pole, GEO height", lon: 0, lat: Math.PI / 2, h: 3.5786e7, ecef: { x: 0, y: 0, z: B + 3.5786e7 } },
    {
      label: "φ=45° λ=45°",
      lon: Math.PI / 4,
      lat: Math.PI / 4,
      h,
      ecef: { x: (n45 + h) * s2 * s2, y: (n45 + h) * s2 * s2, z: (n45 * (1 - E2) + h) * s2 },
    },
    {
      label: "φ=30° λ=0",
      lon: 0,
      lat: Math.PI / 6,
      h: 0,
      ecef: { x: n30 * (Math.sqrt(3) / 2), y: 0, z: n30 * (1 - E2) * 0.5 },
    },
    {
      label: "φ=−60° λ=180°",
      lon: Math.PI,
      lat: -Math.PI / 3,
      h,
      ecef: { x: -(n60 + h) * 0.5, y: 0, z: -(n60 * (1 - E2) + h) * (Math.sqrt(3) / 2) },
    },
  ];
}

/** EPSG Guidance Note 7-2 (IOGP 373-07-2), §2.2.1 geographic/geocentric example, WGS 84. */
export const EPSG_GN72 = {
  lon: dms(2, 7, 46.38),
  lat: dms(53, 48, 33.82),
  h: 73.0,
  ecef: { x: 3771793.968, y: 140253.342, z: 5124304.349 },
  /** values published to 1 mm / 0.001″ */
  linearTol: 5e-4,
  angularTol: (0.0005 / 3600) * (Math.PI / 180),
};

export function runCorrectness(n = SAMPLE_N): Metric[] {
  const out: Metric[] = [];

  // --- geodetic → ECEF -------------------------------------------------------------------------
  {
    const t = new MaxTracker();
    for (const v of analyticForwardVectors()) t.add(compErr(geodeticToEcef(v.lon, v.lat, v.h), v.ecef), () => v.label);
    out.push(
      metric(
        {
          id: "C-G2E-ANALYTIC",
          set: "correctness",
          op: "geodeticToEcef",
          quantity: "per-component error vs exact analytic vectors",
          unit: "m",
          tolerance: 1e-6,
        },
        t,
      ),
    );
  }
  {
    const t = new MaxTracker();
    for (const s of geodeticSample(SEED, n)) {
      t.add(compErr(geodeticToEcef(s.lon, s.lat, s.h), oracleGeodeticToEcef(s.lon, s.lat, s.h)), () =>
        fmtSample(s.lon, s.lat, s.h),
      );
    }
    out.push(
      metric(
        {
          id: "C-G2E-ORACLE",
          set: "correctness",
          op: "geodeticToEcef",
          quantity: "per-component error vs reduced-latitude oracle",
          unit: "m",
          tolerance: 1e-6,
        },
        t,
      ),
    );
  }
  {
    const t = new MaxTracker();
    t.add(
      compErr(geodeticToEcef(EPSG_GN72.lon, EPSG_GN72.lat, EPSG_GN72.h), EPSG_GN72.ecef),
      () => "EPSG GN7-2 example",
    );
    out.push(
      metric(
        {
          id: "C-G2E-EPSG",
          set: "correctness",
          op: "geodeticToEcef",
          quantity: "vs published EPSG GN7-2 vector (published to 1 mm)",
          unit: "m",
          tolerance: EPSG_GN72.linearTol,
        },
        t,
      ),
    );
  }
  {
    // geodetic → ECEF → geodetic → ECEF closure
    const t = new MaxTracker();
    for (const s of geodeticSample(SEED + 1, n)) {
      const p = geodeticToEcef(s.lon, s.lat, s.h);
      const g = ecefToGeodetic(p);
      t.add(dist(p, geodeticToEcef(g.lonRad, g.latRad, g.heightM)), () => fmtSample(s.lon, s.lat, s.h));
    }
    out.push(
      metric(
        {
          id: "C-G2E-ROUNDTRIP",
          set: "correctness",
          op: "geodeticToEcef",
          quantity: "round-trip closure |P − f(f⁻¹(P))|",
          unit: "m",
          tolerance: 1e-6,
        },
        t,
      ),
    );
  }

  // --- ECEF → geodetic -------------------------------------------------------------------------
  {
    const th = new MaxTracker();
    const ta = new MaxTracker();
    for (const s of geodeticSample(SEED + 2, n)) {
      const p = oracleGeodeticToEcef(s.lon, s.lat, s.h);
      const g = ecefToGeodetic(p);
      const o = oracleEcefToGeodetic(p);
      const where = () => fmtSample(s.lon, s.lat, s.h);
      th.add(Math.abs(g.heightM - o.h), where);
      ta.add(Math.abs(g.latRad - o.lat), where);
      if (Math.hypot(p.x, p.y) > 1e-3) ta.add(angleDiff(g.lonRad, o.lon), where);
    }
    out.push(
      metric(
        {
          id: "C-E2G-ORACLE-H",
          set: "correctness",
          op: "ecefToGeodetic",
          quantity: "height vs Eberly bisection oracle",
          unit: "m",
          tolerance: 1e-6,
        },
        th,
      ),
    );
    out.push(
      metric(
        {
          id: "C-E2G-ORACLE-ANG",
          set: "correctness",
          op: "ecefToGeodetic",
          quantity: "lat/lon vs Eberly bisection oracle",
          unit: "rad",
          tolerance: 1e-9,
        },
        ta,
      ),
    );
  }
  {
    // analytic inverse vectors
    const th = new MaxTracker();
    const ta = new MaxTracker();
    const cases: { p: V3; lon: number; lat: number; h: number; label: string }[] = [
      { label: "(a,0,0)", p: { x: A, y: 0, z: 0 }, lon: 0, lat: 0, h: 0 },
      { label: "(0,a+h,0)", p: { x: 0, y: A + 500, z: 0 }, lon: Math.PI / 2, lat: 0, h: 500 },
      { label: "(0,0,b+h)", p: { x: 0, y: 0, z: B + 1e6 }, lon: 0, lat: Math.PI / 2, h: 1e6 },
      { label: "(0,0,−b+h)", p: { x: 0, y: 0, z: -B + 100 }, lon: 0, lat: -Math.PI / 2, h: -100 },
      { label: "centre (0,0,0)", p: { x: 0, y: 0, z: 0 }, lon: 0, lat: Math.PI / 2, h: -B },
    ];
    for (const c of cases) {
      const g = ecefToGeodetic(c.p);
      th.add(Math.abs(g.heightM - c.h), () => c.label);
      ta.add(Math.max(Math.abs(g.latRad - c.lat), angleDiff(g.lonRad, c.lon)), () => c.label);
    }
    out.push(
      metric(
        {
          id: "C-E2G-ANALYTIC-H",
          set: "correctness",
          op: "ecefToGeodetic",
          quantity: "height vs exact analytic vectors",
          unit: "m",
          tolerance: 1e-6,
        },
        th,
      ),
    );
    out.push(
      metric(
        {
          id: "C-E2G-ANALYTIC-ANG",
          set: "correctness",
          op: "ecefToGeodetic",
          quantity: "lat/lon vs exact analytic vectors",
          unit: "rad",
          tolerance: 1e-9,
        },
        ta,
      ),
    );
    const te = new MaxTracker();
    const g = ecefToGeodetic(EPSG_GN72.ecef);
    te.add(
      Math.max(Math.abs(g.latRad - EPSG_GN72.lat), Math.abs(g.lonRad - EPSG_GN72.lon)),
      () => "EPSG GN7-2 example",
    );
    out.push(
      metric(
        {
          id: "C-E2G-EPSG-ANG",
          set: "correctness",
          op: "ecefToGeodetic",
          quantity: "lat/lon vs published EPSG GN7-2 (0.001″)",
          unit: "rad",
          tolerance: EPSG_GN72.angularTol,
        },
        te,
      ),
    );
  }
  {
    // ECEF → geodetic → ECEF closure, incl. points around the Earth's centre and in space
    const t = new MaxTracker();
    const rand = seededRandom(SEED + 3);
    for (let i = 0; i < n; i++) {
      const scale = [5e4, 7e6, 4.3e7, 4e8][i % 4] as number;
      const p = { x: (rand() * 2 - 1) * scale, y: (rand() * 2 - 1) * scale, z: (rand() * 2 - 1) * scale };
      if (i % 97 === 0) p.z = 0;
      if (i % 89 === 0) {
        p.x = 0;
        p.y = 0;
      }
      const g = ecefToGeodetic(p);
      t.add(dist(p, geodeticToEcef(g.lonRad, g.latRad, g.heightM)), () => `P=(${p.x}, ${p.y}, ${p.z})`);
    }
    out.push(
      metric(
        {
          id: "C-E2G-ROUNDTRIP",
          set: "correctness",
          op: "ecefToGeodetic",
          quantity: "closure |P − f(f⁻¹(P))| incl. near-centre & space",
          unit: "m",
          tolerance: 1e-6,
        },
        t,
      ),
    );
  }

  // --- ENU basis -------------------------------------------------------------------------------
  {
    const to = new MaxTracker();
    const tx = new MaxTracker();
    const tu = new MaxTracker();
    for (const s of geodeticSample(SEED + 4, n)) {
      const { east: e, north: nn, up: u } = enuBasis(s.lon, s.lat);
      const where = () => fmtSample(s.lon, s.lat, 0);
      const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
      to.add(
        Math.max(
          Math.abs(dot(e, e) - 1),
          Math.abs(dot(nn, nn) - 1),
          Math.abs(dot(u, u) - 1),
          Math.abs(dot(e, nn)),
          Math.abs(dot(e, u)),
          Math.abs(dot(nn, u)),
        ),
        where,
      );
      const c = { x: e.y * nn.z - e.z * nn.y, y: e.z * nn.x - e.x * nn.z, z: e.x * nn.y - e.y * nn.x };
      tx.add(compErr(c, u), where);
      tu.add(compErr(u, oracleSurfaceNormalAt(oracleGeodeticToEcef(s.lon, s.lat, 0))), where);
    }
    out.push(
      metric(
        {
          id: "C-ENU-ORTHO",
          set: "correctness",
          op: "enuBasis",
          quantity: "orthonormality max |eᵢ·eⱼ − δᵢⱼ|",
          unit: "1",
          tolerance: 1e-12,
        },
        to,
      ),
    );
    out.push(
      metric(
        {
          id: "C-ENU-HANDED",
          set: "correctness",
          op: "enuBasis",
          quantity: "east × north − up (per component)",
          unit: "1",
          tolerance: 1e-12,
        },
        tx,
      ),
    );
    out.push(
      metric(
        {
          id: "C-ENU-NORMAL",
          set: "correctness",
          op: "enuBasis",
          quantity: "up vs implicit-surface gradient normal",
          unit: "1",
          tolerance: 1e-12,
        },
        tu,
      ),
    );
  }

  // --- altitude scaling --------------------------------------------------------------------------
  {
    const t = new MaxTracker();
    const th = new MaxTracker();
    const rand = seededRandom(SEED + 5);
    for (const s of geodeticSample(SEED + 6, n, { maxHeightM: 3.6e7 })) {
      const h1 = rand() < 0.5 ? (rand() * 2 - 1) * 1e4 : rand() * 3.6e7;
      const p = oracleGeodeticToEcef(s.lon, s.lat, s.h);
      const q = scaleToAltitude(p, h1);
      const where = () => `${fmtSample(s.lon, s.lat, s.h)} → h1=${h1.toPrecision(9)}`;
      t.add(compErr(q, oracleGeodeticToEcef(s.lon, s.lat, h1)), where);
      th.add(Math.abs(oracleEcefToGeodetic(q).h - h1), where);
    }
    out.push(
      metric(
        {
          id: "C-SCALE-DIRECT",
          set: "correctness",
          op: "scaleToAltitude",
          quantity: "per-component vs oracle point at new height",
          unit: "m",
          tolerance: 1e-6,
        },
        t,
      ),
    );
    out.push(
      metric(
        {
          id: "C-SCALE-HEIGHT",
          set: "correctness",
          op: "scaleToAltitude",
          quantity: "oracle height of result − requested",
          unit: "m",
          tolerance: 1e-6,
        },
        th,
      ),
    );
  }

  return out;
}
