/**
 * Parity vector set (spec §8, middle column): core-sim vs CesiumJS. Cesium is the parity oracle
 * only — a parity failure is reported separately and never fails the correctness set.
 *
 * Each ECEF→geodetic / altitude-scaling parity metric is paired with diagnostic metrics that
 * measure BOTH implementations against the independent oracle on the same points, so any parity
 * gap can be attributed to the side that is actually off.
 */
import { ecefToGeodetic, enuBasis, geodeticToEcef, scaleToAltitude } from "@blindrev/core-sim";
import { Cartesian3, Cartographic, Ellipsoid, Matrix4, Transforms } from "cesium";
import { MaxTracker, type Metric, angleDiff, fmtSample, metric } from "./metric";
import { geodeticSample, oracleEcefToGeodetic, oracleGeodeticToEcef, seededRandom } from "./oracle";

export const PARITY_SEED = 0x5eed_ce;
export const PARITY_N = 20000;

/** Terrain-to-GEO heights; Cesium's scaleToGeodeticSurface is undefined near the centre. */
const HEIGHTS = { minHeightM: -1e4, maxHeightM: 3.6e7 };

const compErr = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));

export function runParity(n = PARITY_N): Metric[] {
  const out: Metric[] = [];
  const ell = Ellipsoid.WGS84;
  const scratchC = new Cartesian3();
  const scratchG = new Cartographic();
  const scratchM = new Matrix4();

  // --- geodetic → ECEF ---------------------------------------------------------------------------
  {
    const t = new MaxTracker();
    for (const s of geodeticSample(PARITY_SEED, n, HEIGHTS)) {
      const c = Cartesian3.fromRadians(s.lon, s.lat, s.h, ell, scratchC);
      t.add(compErr(geodeticToEcef(s.lon, s.lat, s.h), c), () => fmtSample(s.lon, s.lat, s.h));
    }
    out.push(
      metric(
        {
          id: "P-G2E",
          set: "parity",
          op: "geodeticToEcef",
          quantity: "per-component vs Cartesian3.fromRadians",
          unit: "m",
          tolerance: 1e-6,
        },
        t,
      ),
    );
  }

  // --- ECEF → geodetic ---------------------------------------------------------------------------
  {
    const th = new MaxTracker();
    const ta = new MaxTracker();
    const dCes = new MaxTracker();
    const dOwn = new MaxTracker();
    let undefinedCount = 0;
    for (const s of geodeticSample(PARITY_SEED + 1, n, HEIGHTS)) {
      const p = geodeticToEcef(s.lon, s.lat, s.h);
      const c = Cartographic.fromCartesian(new Cartesian3(p.x, p.y, p.z), ell, scratchG);
      if (!c) {
        undefinedCount++;
        continue;
      }
      const g = ecefToGeodetic(p);
      const o = oracleEcefToGeodetic(p);
      const where = () => fmtSample(s.lon, s.lat, s.h);
      th.add(Math.abs(g.heightM - c.height), where);
      ta.add(Math.abs(g.latRad - c.latitude), where);
      if (Math.abs(s.lat) < Math.PI / 2 - 1e-9) ta.add(angleDiff(g.lonRad, c.longitude), where);
      dCes.add(Math.abs(c.height - o.h), where);
      dOwn.add(Math.abs(g.heightM - o.h), where);
    }
    const note = undefinedCount ? ` (Cesium undefined for ${undefinedCount})` : "";
    out.push(
      metric(
        {
          id: "P-E2G-H",
          set: "parity",
          op: "ecefToGeodetic",
          quantity: `height vs Cartographic.fromCartesian${note}`,
          unit: "m",
          tolerance: 1e-6,
        },
        th,
      ),
    );
    out.push(
      metric(
        {
          id: "P-E2G-ANG",
          set: "parity",
          op: "ecefToGeodetic",
          quantity: `lat/lon vs Cartographic.fromCartesian${note}`,
          unit: "rad",
          tolerance: 1e-9,
        },
        ta,
      ),
    );
    out.push(
      metric(
        {
          id: "D-E2G-H-CESIUM",
          set: "parity",
          op: "ecefToGeodetic",
          quantity: "diag: Cesium height vs independent oracle (same points)",
          unit: "m",
          tolerance: 1e-6,
          diagnostic: true,
        },
        dCes,
      ),
    );
    out.push(
      metric(
        {
          id: "D-E2G-H-CORESIM",
          set: "parity",
          op: "ecefToGeodetic",
          quantity: "diag: core-sim height vs independent oracle (same points)",
          unit: "m",
          tolerance: 1e-6,
          diagnostic: true,
        },
        dOwn,
      ),
    );
  }

  // --- ENU basis ---------------------------------------------------------------------------------
  {
    const t = new MaxTracker();
    for (const s of geodeticSample(PARITY_SEED + 2, n, HEIGHTS)) {
      const origin = Cartesian3.fromRadians(s.lon, s.lat, 0, ell, scratchC);
      const m = Transforms.eastNorthUpToFixedFrame(origin, ell, scratchM);
      const { east, north, up } = enuBasis(s.lon, s.lat);
      // Matrix4 is column-major: column j = elements [4j, 4j+1, 4j+2]
      const col = (j: number) => ({ x: m[4 * j] as number, y: m[4 * j + 1] as number, z: m[4 * j + 2] as number });
      t.add(Math.max(compErr(east, col(0)), compErr(north, col(1)), compErr(up, col(2))), () =>
        fmtSample(s.lon, s.lat, 0),
      );
    }
    out.push(
      metric(
        {
          id: "P-ENU",
          set: "parity",
          op: "enuBasis",
          quantity: "components vs Transforms.eastNorthUpToFixedFrame",
          unit: "1",
          tolerance: 1e-9,
        },
        t,
      ),
    );
  }

  // --- altitude scaling --------------------------------------------------------------------------
  {
    const tCarto = new MaxTracker();
    const tNormal = new MaxTracker();
    const dCarto = new MaxTracker();
    const dNormal = new MaxTracker();
    const dOwn = new MaxTracker();
    const rand = seededRandom(PARITY_SEED + 3);
    const surf = new Cartesian3();
    const nrm = new Cartesian3();
    for (const s of geodeticSample(PARITY_SEED + 4, n, HEIGHTS)) {
      const h1 = rand() < 0.5 ? (rand() * 2 - 1) * 1e4 : rand() * 3.6e7;
      const p = geodeticToEcef(s.lon, s.lat, s.h);
      const cp = new Cartesian3(p.x, p.y, p.z);
      const where = () => `${fmtSample(s.lon, s.lat, s.h)} → h1=${h1.toPrecision(9)}`;
      const truth = oracleGeodeticToEcef(s.lon, s.lat, h1);
      const q = scaleToAltitude(p, h1);
      dOwn.add(compErr(q, truth), where);
      // (a) Cesium via Cartographic: fromCartesian → fromRadians(λ, φ, h1)
      const c = Cartographic.fromCartesian(cp, ell, scratchG);
      if (c) {
        const cq = Cartesian3.fromRadians(c.longitude, c.latitude, h1, ell, scratchC);
        tCarto.add(compErr(q, cq), where);
        dCarto.add(compErr(cq, truth), where);
      }
      // (b) Cesium via surface normal: scaleToGeodeticSurface + h1·geodeticSurfaceNormal
      const sp = ell.scaleToGeodeticSurface(cp, surf);
      if (sp) {
        const nv = ell.geodeticSurfaceNormal(sp, nrm);
        if (nv) {
          const cq2 = { x: sp.x + h1 * nv.x, y: sp.y + h1 * nv.y, z: sp.z + h1 * nv.z };
          tNormal.add(compErr(q, cq2), where);
          dNormal.add(compErr(cq2, truth), where);
        }
      }
    }
    out.push(
      metric(
        {
          id: "P-SCALE-NORMAL",
          set: "parity",
          op: "scaleToAltitude",
          quantity: "vs Ellipsoid.scaleToGeodeticSurface + h₁·geodeticSurfaceNormal",
          unit: "m",
          tolerance: 1e-6,
        },
        tNormal,
      ),
    );
    out.push(
      metric(
        {
          id: "P-SCALE-CARTO",
          set: "parity",
          op: "scaleToAltitude",
          quantity: "vs Cartographic.fromCartesian → Cartesian3.fromRadians(h₁)",
          unit: "m",
          tolerance: 1e-6,
        },
        tCarto,
      ),
    );
    out.push(
      metric(
        {
          id: "D-SCALE-CESIUM-NORMAL",
          set: "parity",
          op: "scaleToAltitude",
          quantity: "diag: Cesium normal path vs independent oracle",
          unit: "m",
          tolerance: 1e-6,
          diagnostic: true,
        },
        dNormal,
      ),
    );
    out.push(
      metric(
        {
          id: "D-SCALE-CESIUM-CARTO",
          set: "parity",
          op: "scaleToAltitude",
          quantity: "diag: Cesium Cartographic path vs independent oracle",
          unit: "m",
          tolerance: 1e-6,
          diagnostic: true,
        },
        dCarto,
      ),
    );
    out.push(
      metric(
        {
          id: "D-SCALE-CORESIM",
          set: "parity",
          op: "scaleToAltitude",
          quantity: "diag: core-sim vs independent oracle (same points)",
          unit: "m",
          tolerance: 1e-6,
          diagnostic: true,
        },
        dOwn,
      ),
    );
  }
  return out;
}
