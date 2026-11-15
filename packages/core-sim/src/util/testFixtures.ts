/**
 * Test-only fixtures for C2's suites (TEST_FIXTURE data). Not re-exported from the package index.
 */
import type { TemporalStep } from "../contracts";

export function makeStep(
  stepId: string,
  date: string,
  isAvailable: boolean,
  over: Partial<TemporalStep> = {},
): TemporalStep {
  return {
    schemaVersion: 2,
    stepId,
    date,
    acquisitionStart: date,
    acquisitionEnd: date,
    isAvailable,
    platform: "NISAR",
    instrument: "L-SAR",
    processingVersion: "TEST_FIXTURE-1",
    sourceId: "TEST_FIXTURE",
    layerId: `layer-${stepId}`,
    tileUrlTemplate: isAvailable ? `mission-data/test/${stepId}.png` : "",
    crs: "EPSG:4326",
    bounds: [-120, 36, -119, 37],
    resolutionMeters: 30,
    noDataValue: null,
    displacement: {
      quantity: "los",
      unit: "mm",
      signConvention: "positive = towards satellite",
      referenceStepId: null,
      referencePoint: null,
      incidenceAngleDeg: null,
      lineOfSight: null,
    },
    acquisition: { track: 1, frame: 1, orbitDirection: "ASCENDING" },
    tiling: { tileMatrixSet: "SINGLE_TILE", minZoom: 0, maxZoom: 0 },
    qaMaskId: isAvailable ? `qa-${stepId}` : null,
    qaMaskUrlTemplate: null,
    evidenceMaskId: null,
    evidenceMaskUrlTemplate: null,
    uncertainty: null,
    uncertaintyType: "none",
    license: "TEST_FIXTURE",
    attribution: "TEST_FIXTURE",
    citation: "TEST_FIXTURE",
    ...over,
  };
}

/** An optical (cloud-masked) step: no displacement product, optical instrument. */
export function makeOpticalStep(stepId: string, date: string, isAvailable = true): TemporalStep {
  return makeStep(stepId, date, isAvailable, { platform: "Landsat 9", instrument: "OLI-2", displacement: null });
}
