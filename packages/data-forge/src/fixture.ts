/**
 * PENDING path (spec §5 "Open input #1"): while the AOI decision is PENDING the mission runs on a
 * labelled TEST_FIXTURE AOI with synthetic PLACEHOLDER tiles. Small, deterministic, obviously fake.
 */
import type { LonLat, MaskAsset, MissionManifest, TemporalStep } from "@blindrev/core-sim";
import { FIXTURE_BOUNDS, LEGEND_LABELS, RAMP, THRESHOLDS_MM } from "./config";
import { stableJson } from "./paths";
import { encodeIndexedPng } from "./png";
import {
  centreLat,
  centreLon,
  encodeMaskPng,
  encodeQaPng,
  evidencePalette,
  makeGrid,
  rasterizePolygonsPnpoly,
} from "./raster";

type Emit = (relUnderPublic: string, data: Uint8Array | string) => { sha256: string };

const BASE = "mission-data/_fixture-pending";
const FIX_MASK = 128;
const FIX_DISPLAY = 256;

const STEPS = [
  { stepId: "f01", day: "2001-01-01", available: true, growth: 0 },
  { stepId: "f02", day: "2001-01-13", available: false, growth: 0 },
  { stepId: "f03", day: "2001-01-25", available: true, growth: 0.5 },
  { stepId: "f04", day: "2001-02-06", available: true, growth: 1 },
];

export function buildFixture(emit: Emit, _sha: (d: Uint8Array) => string): MissionManifest {
  const bounds = FIXTURE_BOUNDS;
  const mg = makeGrid(bounds, FIX_MASK);
  const dg = makeGrid(bounds, FIX_DISPLAY);
  const cLon = (bounds[0] + bounds[2]) / 2;
  const cLat = (bounds[1] + bounds[3]) / 2;
  const rDeg = 0.08;
  const disc = (lon: number, lat: number) => Math.hypot(lon - cLon, lat - cLat) / rDeg;

  emit(
    `${BASE}/ASSET_LICENSE.json`,
    stableJson({
      license: "CC0-1.0 (BlindRev data-forge output; TEST_FIXTURE / PLACEHOLDER)",
      attribution: "BlindRev data-forge — synthetic placeholder tiles for the PENDING-AOI path. Not real data.",
      source: "packages/data-forge/src/fixture.ts",
      notes:
        "TEST_FIXTURE mission over fixture bounds; PLACEHOLDER evidence (checker pattern + synthetic disc). Proves the PENDING path.",
      deterministic: true,
      generator: "@blindrev/data-forge (pnpm --filter @blindrev/data-forge forge --pending)",
    }),
  );

  const masks: Record<string, MaskAsset> = {};
  const steps: TemporalStep[] = [];
  for (const s of STEPS) {
    const common = {
      schemaVersion: 2 as const,
      stepId: s.stepId,
      date: s.day,
      acquisitionStart: s.day,
      acquisitionEnd: s.day,
      platform: "TEST_FIXTURE",
      instrument: "PLACEHOLDER",
      layerId: "blindrev-fixture-placeholder",
      crs: "EPSG:4326" as const,
      bounds: [...bounds] as typeof bounds,
      resolutionMeters: 200,
      noDataValue: null,
      tiling: { tileMatrixSet: "SINGLE_TILE", minZoom: 0, maxZoom: 0 },
      evidenceMaskId: null,
      evidenceMaskUrlTemplate: null,
      license: "CC0-1.0 (TEST_FIXTURE)",
      attribution: "BlindRev data-forge TEST_FIXTURE (PLACEHOLDER tiles)",
    };
    if (!s.available) {
      steps.push({
        ...common,
        isAvailable: false,
        processingVersion: "NONE (no acquisition — fixture)",
        sourceId: `TEST_FIXTURE:${s.stepId}:no-acquisition`,
        tileUrlTemplate: "",
        displacement: null,
        acquisition: null,
        qaMaskId: null,
        qaMaskUrlTemplate: null,
        uncertainty: null,
        uncertaintyType: "none",
        citation: "TEST_FIXTURE: deliberate no-acquisition step for the PENDING path.",
      });
      continue;
    }
    // PLACEHOLDER evidence: 32-px checker of LOW (low contrast) + a growing synthetic disc
    const idx = new Uint8Array(FIX_DISPLAY * FIX_DISPLAY);
    for (let r = 0; r < FIX_DISPLAY; r++) {
      for (let c = 0; c < FIX_DISPLAY; c++) {
        const dd = disc(centreLon(dg, c), centreLat(dg, r));
        const sub = s.growth * 80 * Math.max(0, 1 - dd * dd * 0.5);
        let k = sub >= THRESHOLDS_MM[1] ? 3 : sub >= THRESHOLDS_MM[0] ? 2 : sub >= 12 ? 1 : 0;
        if (k === 0 && ((r >> 5) + (c >> 5)) % 2 === 0 && (r + c) % 16 === 0) k = 1; // placeholder checker dots
        idx[r * FIX_DISPLAY + c] = k;
      }
    }
    emit(`${BASE}/evidence/${s.stepId}.png`, encodeIndexedPng(FIX_DISPLAY, FIX_DISPLAY, idx, evidencePalette(RAMP)));
    const valid = new Uint8Array(FIX_MASK * FIX_MASK).fill(1);
    for (let r = 8; r < 40; r++) for (let c = 80; c < 112; c++) valid[r * FIX_MASK + c] = 0; // one low-coherence square
    const qa = emit(`${BASE}/qa/${s.stepId}.bin`, valid);
    emit(`${BASE}/qa/${s.stepId}.png`, encodeQaPng(valid, mg));
    const qaId = `qa-${s.stepId}`;
    masks[qaId] = {
      ...mg,
      bounds: [...mg.bounds] as typeof bounds,
      maskId: qaId,
      version: "fixture-1",
      binUrl: `${BASE}/qa/${s.stepId}.bin`,
      pngUrl: `${BASE}/qa/${s.stepId}.png`,
      sha256: qa.sha256,
    };
    steps.push({
      ...common,
      isAvailable: true,
      processingVersion: "PLACEHOLDER/fixture-1",
      sourceId: `TEST_FIXTURE:${s.stepId}`,
      tileUrlTemplate: `${BASE}/evidence/${s.stepId}.png`,
      displacement: {
        quantity: "los",
        unit: "mm",
        signConvention: "TEST_FIXTURE: negative = away from the sensor (subsidence)",
        referenceStepId: "f01",
        referencePoint: { lon: bounds[0] + 0.02, lat: bounds[3] - 0.02, heightM: 0 },
        incidenceAngleDeg: null,
        lineOfSight: null,
      },
      acquisition: null,
      qaMaskId: qaId,
      qaMaskUrlTemplate: `${BASE}/qa/${s.stepId}.png`,
      uncertainty: null,
      uncertaintyType: "none",
      citation: "TEST_FIXTURE: PLACEHOLDER tiles generated by BlindRev data-forge; not real data.",
    });
  }

  const ring: LonLat[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    ring.push({
      lon: Math.round((cLon + Math.sin(a) * rDeg * 1.1) * 1e4) / 1e4,
      lat: Math.round((cLat + Math.cos(a) * rDeg * 1.1) * 1e4) / 1e4,
    });
  }
  const ref = rasterizePolygonsPnpoly([ring], mg);
  const refBin = emit(`${BASE}/reference/mask-fixture.bin`, ref);
  emit(`${BASE}/reference/mask-fixture.png`, encodeMaskPng(ref, mg));
  masks["reference-fixture"] = {
    ...mg,
    bounds: [...mg.bounds] as typeof bounds,
    maskId: "reference-fixture",
    version: "fixture-1",
    binUrl: `${BASE}/reference/mask-fixture.bin`,
    pngUrl: `${BASE}/reference/mask-fixture.png`,
    sha256: refBin.sha256,
  };

  return {
    schemaVersion: 1,
    missionId: "fixture-pending",
    caseId: "CASE_000",
    title: "Test fixture (AOI pending)",
    kicker: "Placeholder",
    theme: "subsidence",
    aoi: { decision: "PENDING", bounds: null, name: null, source: null, injectedBy: null, injectedAt: null },
    effectiveBounds: [...bounds] as typeof bounds,
    labels: ["TEST_FIXTURE", "PLACEHOLDER", "SIMULATED"],
    briefing: {
      question: "Where has the ground changed?",
      summary:
        "The mission area is not chosen yet. This is a TEST_FIXTURE with PLACEHOLDER tiles so the game can still run.",
      body: ["Everything here is synthetic. The real case loads once the AOI is injected."],
      location: "TEST_FIXTURE bounds (no real place)",
      dates: "Fixture dates (not real acquisitions)",
      source: "BlindRev data-forge PENDING path",
      facts: [
        {
          text: "This mission is a placeholder while the AOI decision is PENDING.",
          source: "docs/SPEC.md §5 (Open input #1)",
        },
      ],
    },
    steps,
    masks,
    referenceMaskId: "reference-fixture",
    referencePolygons: [ring],
    contextLayers: [],
    legend: { ramp: [...RAMP], labels: [...LEGEND_LABELS], unit: "mm (PLACEHOLDER)", thresholds: [...THRESHOLDS_MM] },
    camera: { home: { lon: cLon, lat: cLat, heightM: 1_500_000 }, aoi: { lon: cLon, lat: cLat, heightM: 90_000 } },
    attributions: ["TEST_FIXTURE: synthetic PLACEHOLDER data generated by BlindRev data-forge."],
  };
}
