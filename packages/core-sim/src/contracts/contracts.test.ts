import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ContractValidationError,
  MaskAssetSchema,
  parseCameraConfig,
  parseGameConstants,
  parseMissionManifest,
  parseQualityPresets,
  parseTemporalStep,
  parseTleSnapshot,
  tleLineChecksumOk,
} from "./schemas";
import type { MaskAsset, MissionManifest, TemporalStep } from "./types";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const readJson = (rel: string): unknown => JSON.parse(readFileSync(`${repoRoot}${rel}`, "utf8"));

const BOUNDS: [number, number, number, number] = [-120.2, 35.9, -119.8, 36.3];
const SHA = "a".repeat(64);

function step(over: Partial<TemporalStep> = {}): TemporalStep {
  return {
    schemaVersion: 2,
    stepId: "s01",
    date: "2025-11-01",
    acquisitionStart: "2025-11-01T13:50:00Z",
    acquisitionEnd: "2025-11-01T13:51:00Z",
    isAvailable: true,
    platform: "NISAR",
    instrument: "L-SAR",
    processingVersion: "sim-1",
    sourceId: "SIMULATED",
    layerId: "evidence",
    tileUrlTemplate: "mission-data/test/evidence/s01.png",
    crs: "EPSG:4326",
    bounds: BOUNDS,
    resolutionMeters: 80,
    noDataValue: null,
    displacement: {
      quantity: "los",
      unit: "mm",
      signConvention: "positive = toward satellite",
      referenceStepId: null,
      referencePoint: null,
      incidenceAngleDeg: 37,
      lineOfSight: { east: 0.6, north: -0.1, up: 0.8 },
    },
    acquisition: { track: 12, frame: 34, orbitDirection: "ASCENDING" },
    tiling: { tileMatrixSet: "SINGLE_TILE", minZoom: 0, maxZoom: 0 },
    qaMaskId: "qa-s01",
    qaMaskUrlTemplate: "mission-data/test/qa/s01.png",
    evidenceMaskId: null,
    evidenceMaskUrlTemplate: null,
    uncertainty: 5,
    uncertaintyType: "rmse_mm",
    license: "CC0",
    attribution: "Simulated",
    citation: "",
    ...over,
  };
}

function mask(maskId: string): MaskAsset {
  return {
    maskId,
    version: "1",
    width: 64,
    height: 64,
    bounds: BOUNDS,
    crs: "EPSG:4326",
    binUrl: `mission-data/test/masks/${maskId}.bin`,
    pngUrl: `mission-data/test/masks/${maskId}.png`,
    sha256: SHA,
  };
}

function manifest(): MissionManifest {
  return {
    schemaVersion: 1,
    missionId: "test",
    caseId: "CASE_000",
    title: "Test case",
    kicker: "Look closer.",
    theme: "subsidence",
    aoi: { decision: "PENDING", bounds: null, name: null, source: null, injectedBy: null, injectedAt: null },
    effectiveBounds: BOUNDS,
    labels: ["TEST_FIXTURE", "SIMULATED"],
    briefing: {
      question: "Where is it sinking?",
      summary: "",
      body: [],
      location: "",
      dates: "",
      source: "",
      facts: [],
    },
    steps: [
      step(),
      step({ stepId: "s02", date: "2025-11-13", isAvailable: false, tileUrlTemplate: "", qaMaskId: null }),
      step({ stepId: "s03", date: "2025-12-07", qaMaskId: "qa-s01" }),
    ],
    masks: { "qa-s01": mask("qa-s01"), ref: mask("ref") },
    referenceMaskId: "ref",
    referencePolygons: [
      [
        { lon: -120, lat: 36 },
        { lon: -119.9, lat: 36 },
        { lon: -119.9, lat: 36.1 },
      ],
    ],
    contextLayers: [],
    legend: {
      ramp: ["#8F5236", "#C9784A", "#E2B08A"],
      labels: ["low", "mid", "high"],
      unit: "mm",
      thresholds: [-20, -60],
    },
    camera: { home: { lon: -119, lat: 36, heightM: 2e6 }, aoi: { lon: -120, lat: 36.1, heightM: 6e4 } },
    attributions: [],
  };
}

describe("prefab JSON files validate", () => {
  it("constants.json", () => {
    const c = parseGameConstants(readJson("data/prefabs/constants.json"));
    expect(c.scoring.dtMinDays).toBe(24);
    expect(c.roiNudgeCoarseFactor).toBe(10);
  });
  it("quality.json", () => {
    const q = parseQualityPresets(readJson("data/prefabs/quality.json"));
    expect(q.map((p) => p.id)).toEqual(["low", "medium", "high"]);
    expect(q.filter((p) => p.allow4k).map((p) => p.id)).toEqual(["high"]);
  });
  it("camera.json", () => {
    expect(parseCameraConfig(readJson("data/prefabs/camera.json")).k).toBe(0.1);
  });
  it("nisar TLE snapshot", () => {
    const t = parseTleSnapshot(readJson("data/tle/nisar-65053.snapshot.json"));
    expect(t.noradId).toBe(65053);
    expect(tleLineChecksumOk(t.line1)).toBe(true);
    expect(tleLineChecksumOk(t.line2)).toBe(true);
  });
});

describe("TemporalStep", () => {
  it("accepts a good step", () => {
    expect(parseTemporalStep(step()).stepId).toBe("s01");
  });
  it("requires an empty tileUrlTemplate on unavailable steps", () => {
    expect(() => parseTemporalStep(step({ isAvailable: false }))).toThrow(/tileUrlTemplate/);
  });
  it("rejects leading-slash asset URLs and bad dates", () => {
    expect(() => parseTemporalStep(step({ tileUrlTemplate: "/abs.png" }))).toThrow(/relative/);
    expect(() => parseTemporalStep(step({ date: "yesterday" }))).toThrow(/date/);
  });
  it("rejects wrong schemaVersion with a readable message", () => {
    try {
      parseTemporalStep({ ...step(), schemaVersion: 1 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ContractValidationError);
      expect((e as Error).message).toMatch(/^Invalid TemporalStep/);
      expect((e as Error).message).toContain("schemaVersion");
    }
  });
});

describe("MissionManifest", () => {
  it("accepts a good manifest", () => {
    expect(parseMissionManifest(manifest()).steps).toHaveLength(3);
  });
  it("rejects a missing reference mask and dangling qaMaskId", () => {
    const m = manifest();
    m.referenceMaskId = "nope";
    m.steps[0] = step({ qaMaskId: "ghost" });
    const err = (() => {
      try {
        parseMissionManifest(m, "fixture");
      } catch (e) {
        return e as ContractValidationError;
      }
      return null;
    })();
    expect(err).not.toBeNull();
    expect(err?.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["referenceMaskId", "steps[0].qaMaskId"]));
    expect(err?.message).toContain("(fixture)");
  });
  it("rejects non-chronological steps and INJECTED without bounds", () => {
    const m = manifest();
    m.steps = [step({ stepId: "a", date: "2026-01-01" }), step({ stepId: "b", date: "2025-01-01" })];
    m.aoi.decision = "INJECTED";
    expect(() => parseMissionManifest(m)).toThrow(/chronological[\s\S]*|INJECTED/);
  });
  it("rejects bad bounds and bad mask digests", () => {
    expect(MaskAssetSchema.safeParse({ ...mask("x"), sha256: "xyz" }).success).toBe(false);
    const m = manifest();
    m.effectiveBounds = [0, 10, 1, 5];
    expect(() => parseMissionManifest(m)).toThrow(/south < north/);
  });
});

describe("prefab negatives", () => {
  it("quality presets need exactly low/medium/high", () => {
    expect(() => parseQualityPresets((readJson("data/prefabs/quality.json") as unknown[]).slice(0, 2))).toThrow(
      /exactly one each/,
    );
  });
  it("camera config range ordering", () => {
    const c = readJson("data/prefabs/camera.json") as Record<string, unknown>;
    expect(() => parseCameraConfig({ ...c, rangeMinM: 1e9 })).toThrow(/rangeMinM/);
  });
  it("TLE checksum tamper is detected", () => {
    const t = readJson("data/tle/nisar-65053.snapshot.json") as Record<string, string>;
    const line2 = `${t.line2?.slice(0, 68)}0`;
    expect(() => parseTleSnapshot({ ...t, line2 })).toThrow(/checksum/);
  });
});
