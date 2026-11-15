import { describe, expect, it } from "vitest";
import { normLon, splitAtAntimeridian } from "../src/pure/antimeridian";
import { normaliseTemplate, parseBasemap } from "../src/pure/basemap";
import { isTypingTarget, keysToIntent, wheelDeltaToNotches } from "../src/pure/input";
import { Emitter, isSimpleRing, TileProgress } from "../src/pure/misc";
import {
  cubicBezier,
  dragToEastNorthMetres,
  easeBrand,
  FixedStepper,
  interpolatePose,
  offsetLonLat,
  shortestDeltaDeg,
} from "../src/pure/motion";

describe("antimeridian", () => {
  it("normalises longitudes to (-180, 180]", () => {
    expect(normLon(180)).toBe(180);
    expect(normLon(-180)).toBe(180);
    expect(normLon(190)).toBe(-170);
    expect(normLon(-540)).toBe(180);
  });
  it("splits an eastward crossing with interpolated meridian vertices", () => {
    const parts = splitAtAntimeridian([
      { lon: 178, lat: 0 },
      { lon: -178, lat: 4 },
      { lon: -176, lat: 6 },
    ]);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.at(-1)).toEqual({ lon: 180, lat: 2 });
    expect(parts[1]?.[0]).toEqual({ lon: -180, lat: 2 });
    expect(parts[1]?.at(-1)).toEqual({ lon: -176, lat: 6 });
  });
  it("splits a westward crossing", () => {
    const parts = splitAtAntimeridian([
      { lon: -179, lat: 10 },
      { lon: 179, lat: 12 },
    ]);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.at(-1)?.lon).toBe(-180);
    expect(parts[1]?.[0]?.lon).toBe(180);
    expect(parts[0]?.at(-1)?.lat).toBeCloseTo(11, 9);
  });
  it("leaves non-crossing tracks intact and breaks on NaN", () => {
    expect(
      splitAtAntimeridian([
        { lon: 0, lat: 0 },
        { lon: 10, lat: 1 },
      ]),
    ).toHaveLength(1);
    const p = splitAtAntimeridian([
      { lon: 0, lat: 0 },
      { lon: 1, lat: 0 },
      { lon: Number.NaN, lat: 0 },
      { lon: 2, lat: 0 },
      { lon: 3, lat: 0 },
    ]);
    expect(p).toHaveLength(2);
  });
});

describe("input mapping", () => {
  it("maps WASD/ZX/QE/RF to a normalised intent", () => {
    const i = keysToIntent(new Set(["KeyW", "KeyD", "KeyZ", "KeyE", "KeyR"]));
    expect(Math.hypot(i.forward, i.right)).toBeCloseTo(1, 12);
    expect(i.zoom).toBe(1);
    expect(i.rotate).toBe(1);
    expect(i.tilt).toBe(1);
    const j = keysToIntent(new Set(["KeyS", "KeyA", "KeyX", "KeyQ", "KeyF"]));
    expect(j.forward).toBeLessThan(0);
    expect(j.zoom).toBe(-1);
    expect(j.rotate).toBe(-1);
    expect(j.tilt).toBe(-1);
    expect(keysToIntent(new Set(["KeyW", "KeyS"])).forward).toBe(0);
  });
  it("normalises wheel deltas (negative deltaY = zoom in) and clamps bursts", () => {
    expect(wheelDeltaToNotches(-100, 0)).toBe(1);
    expect(wheelDeltaToNotches(3, 1)).toBe(-1);
    expect(wheelDeltaToNotches(-10000, 0)).toBe(4);
    expect(wheelDeltaToNotches(Number.NaN, 0)).toBe(0);
  });
  it("detects typing targets and dialogs", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON", closest: (s: string) => (s.includes("dialog") ? {} : null) })).toBe(
      true,
    );
    expect(isTypingTarget({ tagName: "BUTTON", closest: () => null })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("motion helpers", () => {
  it("fixed stepper consumes exact steps and clamps big gaps", () => {
    const s = new FixedStepper(1 / 60, 0.1, 6);
    expect(s.advance(1 / 60)).toBe(1);
    expect(s.advance(1 / 120)).toBe(0);
    expect(s.advance(1 / 120)).toBe(1);
    expect(s.advance(5)).toBe(6);
    expect(s.advance(-1)).toBe(0);
  });
  it("brand easing matches cubic-bezier endpoints and is monotone", () => {
    expect(easeBrand(0)).toBe(0);
    expect(easeBrand(1)).toBe(1);
    let prev = 0;
    for (let t = 0.05; t < 1; t += 0.05) {
      const v = easeBrand(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 5);
  });
  it("interpolates poses along the short way round", () => {
    expect(shortestDeltaDeg(170, -170)).toBe(20);
    const mid = interpolatePose(
      { lonDeg: 170, latDeg: 0, rangeM: 1e6, headingDeg: 350, pitchDeg: -90 },
      { lonDeg: -170, latDeg: 10, rangeM: 1e6, headingDeg: 10, pitchDeg: -50 },
      0.5,
    );
    expect(mid.lonDeg).toBeCloseTo(180, 9);
    expect(mid.latDeg).toBeCloseTo(5, 9);
    expect(((mid.headingDeg % 360) + 360) % 360).toBeCloseTo(0, 9);
    expect(mid.rangeM).toBeGreaterThan(1e6); // hop over a 2200 km flight
  });
  it("drag maps to grab-pan in the heading frame", () => {
    const north = dragToEastNorthMetres(0, 100, 1000, Math.PI / 3, 1000, 0);
    expect(north.north).toBeGreaterThan(0);
    expect(Math.abs(north.east)).toBeLessThan(1e-9);
    const east = dragToEastNorthMetres(-100, 0, 1000, Math.PI / 3, 1000, 90);
    expect(east.north).toBeCloseTo(-dragToEastNorthMetres(-100, 0, 1000, Math.PI / 3, 1000, 0).east, 6);
  });
  it("offsets lon/lat with wrap and latitude wall", () => {
    const a = offsetLonLat(179.999, 0, 1000, 0, 89.5);
    expect(a.lonDeg).toBeLessThan(-179.99);
    const b = offsetLonLat(0, 89.49, 0, 50000, 89.5);
    expect(b.latDeg).toBe(89.5);
  });
});

describe("misc", () => {
  it("tile progress counts a burst", () => {
    const p = new TileProgress();
    expect(p.update(5)).toEqual({ loaded: 0, pending: 5 });
    expect(p.update(2)).toEqual({ loaded: 3, pending: 2 });
    expect(p.update(0)).toEqual({ loaded: 5, pending: 0 });
    expect(p.update(4)).toEqual({ loaded: 0, pending: 4 });
  });
  it("ring simplicity guard rejects bow-ties and duplicates", () => {
    expect(
      isSimpleRing([
        { lon: 0, lat: 0 },
        { lon: 1, lat: 0 },
        { lon: 1, lat: 1 },
        { lon: 0, lat: 1 },
      ]),
    ).toBe(true);
    expect(
      isSimpleRing([
        { lon: 0, lat: 0 },
        { lon: 1, lat: 1 },
        { lon: 1, lat: 0 },
        { lon: 0, lat: 1 },
      ]),
    ).toBe(false);
    expect(
      isSimpleRing([
        { lon: 0, lat: 0 },
        { lon: 0, lat: 0 },
        { lon: 1, lat: 1 },
      ]),
    ).toBe(false);
    expect(
      isSimpleRing([
        { lon: 0, lat: 0 },
        { lon: 1, lat: 1 },
      ]),
    ).toBe(false);
  });
  it("emitter isolates listener errors and supports unsubscribe", () => {
    const e = new Emitter<{ a: number; b: void }>();
    const got: number[] = [];
    const off = e.on("a", (n) => got.push(n));
    e.on("a", () => {
      throw new Error("boom");
    });
    const orig = console.error;
    console.error = () => {};
    e.emit("a", 1);
    off();
    e.emit("a", 2);
    console.error = orig;
    expect(got).toEqual([1]);
  });
});

describe("basemap parsing", () => {
  it("reads D's online/offline shape incl. regional zooms", () => {
    const b = parseBasemap({
      online: {
        urlTemplate: "https://x/{z}/{y}/{x}.jpeg",
        crs: "EPSG:3857",
        minZoom: 0,
        maxZoom: 8,
        attribution: "NASA GIBS",
      },
      offline: {
        urlTemplate: "offline-tiles/bm/{z}/{y}/{x}.jpeg",
        minZoom: 0,
        maxZoom: 5,
        regionalMaxZoom: 8,
        regionalBounds: [-122, 34, -118, 38],
      },
    });
    expect(b.online?.maxZoom).toBe(8);
    expect(b.online?.attribution).toBe("NASA GIBS");
    expect(b.offline?.maxZoom).toBe(5);
    expect(b.offline?.regional?.minZoom).toBe(6);
    expect(b.offline?.regional?.maxZoom).toBe(8);
    expect(b.offline?.regional?.bounds).toEqual([-122, 34, -118, 38]);
  });
  it("maps WMTS placeholders and tolerates junk", () => {
    expect(normaliseTemplate("a/{TileMatrix}/{TileRow}/{TileCol}.png")).toBe("a/{z}/{y}/{x}.png");
    expect(parseBasemap(null)).toEqual({ online: null, offline: null });
    expect(parseBasemap({ online: "https://gibs/epsg4326/{z}/{y}/{x}" }).online?.crs).toBe("EPSG:4326");
  });
});
