import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import { mulberry32, parseMissionManifest, rasterizeRings } from "@blindrev/core-sim";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import { AOI_BOUNDS, MASK_GRID_SIZE, STEP_DEFS } from "../src/config";
import { forge, lineOfSight } from "../src/forge";
import { deflateRaw, encodeIndexedPng, type PaletteEntry, zlibWrap } from "../src/png";
import { makeGrid, rasterizePolygonsPnpoly } from "../src/raster";
import { REFERENCE_POLYGONS } from "../src/reference";
import { REPO_ROOT } from "../src/paths";

const tmps: string[] = [];
afterAll(() => {
  for (const t of tmps) rmSync(t, { recursive: true, force: true });
});

describe("deterministic PNG encoder", () => {
  it("deflate output inflates back to the input", () => {
    const rnd = mulberry32(42);
    const data = new Uint8Array(70_000);
    for (let i = 0; i < data.length; i++) data[i] = rnd() < 0.7 ? 0 : Math.floor(rnd() * 4);
    const z = deflateRaw(data);
    expect(new Uint8Array(inflateRawSync(z))).toEqual(data);
    // and the zlib-wrapped form (with our Adler-32) passes zlib's own integrity check
    expect(new Uint8Array(inflateSync(zlibWrap(data)))).toEqual(data);
  });

  for (const nColours of [2, 4, 16, 200]) {
    it(`round-trips through pngjs with a ${nColours}-entry palette`, () => {
      const w = 37;
      const h = 23;
      const rnd = mulberry32(nColours);
      const idx = new Uint8Array(w * h).map(() => Math.floor(rnd() * nColours));
      const pal: PaletteEntry[] = Array.from({ length: nColours }, (_, i) => ({
        r: i,
        g: 255 - i,
        b: (i * 7) & 255,
        a: i === 0 ? 0 : 255,
      }));
      const png = PNG.sync.read(Buffer.from(encodeIndexedPng(w, h, idx, pal)));
      expect(png.width).toBe(w);
      expect(png.height).toBe(h);
      for (let i = 0; i < w * h; i++) {
        const p = pal[idx[i] as number] as PaletteEntry;
        expect([png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2], png.data[i * 4 + 3]]).toEqual([
          p.r,
          p.g,
          p.b,
          p.a,
        ]);
      }
    });
  }

  it("is byte-identical across calls", () => {
    const idx = new Uint8Array(64 * 64).map((_, i) => (i * 31) % 4);
    const pal: PaletteEntry[] = [0, 1, 2, 3].map((i) => ({ r: i * 60, g: 0, b: 0, a: 255 }));
    expect(encodeIndexedPng(64, 64, idx, pal)).toEqual(encodeIndexedPng(64, 64, idx, pal));
  });
});

describe("reference mask registration", () => {
  it("independent PNPOLY raster equals core-sim rasterizeRings (0 px)", () => {
    const g = makeGrid(AOI_BOUNDS, MASK_GRID_SIZE);
    expect(rasterizePolygonsPnpoly(REFERENCE_POLYGONS, g)).toEqual(rasterizeRings(REFERENCE_POLYGONS, g));
  });

  it("polygons have 10–16 vertices", () => {
    for (const ring of REFERENCE_POLYGONS) {
      expect(ring.length).toBeGreaterThanOrEqual(10);
      expect(ring.length).toBeLessThanOrEqual(16);
    }
  });
});

describe("geometry", () => {
  it("line of sight is a unit vector pointing up and west (left-looking descending pass)", () => {
    const l = lineOfSight(198.3, 45.5);
    expect(Math.hypot(l.east, l.north, l.up)).toBeCloseTo(1, 3);
    expect(l.up).toBeGreaterThan(0);
    expect(l.east).toBeLessThan(0);
  });
});

describe("forge", () => {
  it("is deterministic and produces valid manifests", () => {
    const a = mkdtempSync(join(tmpdir(), "df-test-a-"));
    const b = mkdtempSync(join(tmpdir(), "df-test-b-"));
    tmps.push(a, b);
    const r1 = forge({ outRoot: a, aoiFrom: REPO_ROOT });
    const r2 = forge({ outRoot: b, aoiFrom: REPO_ROOT });
    expect(r1.files.map((f) => [f.rel, f.sha256])).toEqual(r2.files.map((f) => [f.rel, f.sha256]));
    expect(r1.mission).not.toBeNull();
    const m = parseMissionManifest(JSON.parse(JSON.stringify(r1.mission)));
    expect(m.aoi.decision).toBe("INJECTED");
    expect(m.labels).toContain("SIMULATED");
    expect(m.steps).toHaveLength(STEP_DEFS.length);
    expect(m.steps.filter((s) => !s.isAvailable).length).toBeGreaterThanOrEqual(2);
    for (const s of r1.stats.filter((x) => x.isAvailable)) expect(s.coverage).toBeGreaterThanOrEqual(0.6);
    const fx = parseMissionManifest(JSON.parse(JSON.stringify(r1.fixture)));
    expect(fx.aoi.decision).toBe("PENDING");
    expect(fx.labels).toEqual(expect.arrayContaining(["TEST_FIXTURE", "PLACEHOLDER"]));
  }, 120_000);

  it("--pending builds only the fixture", () => {
    const c = mkdtempSync(join(tmpdir(), "df-test-c-"));
    tmps.push(c);
    const r = forge({ outRoot: c, pendingOnly: true, aoiFrom: REPO_ROOT });
    expect(r.mission).toBeNull();
    expect(r.files.some((f) => f.rel === "data/missions/_fixture-pending.example.json")).toBe(true);
    expect(r.files.some((f) => f.rel === "data/missions/sinking-city.json")).toBe(false);
  });
});
