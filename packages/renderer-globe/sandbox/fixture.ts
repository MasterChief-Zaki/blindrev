/**
 * TEST_FIXTURE mission for the sandbox, used only when D's data/missions/sinking-city.json is
 * absent. Rasters are drawn at runtime into data: URLs (no binary files in the repo).
 */
import type { Bounds, MissionManifest, TemporalStep } from "@blindrev/core-sim";

const AOI: Bounds = [-120.25, 35.85, -119.75, 36.25];

function raster(seed: number, kind: "evidence" | "qa" | "ref"): string {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (!g) return "";
  const ramp = ["#8F5236", "#C9784A", "#E2B08A"];
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const dx = (x - 70) / 40;
      const dy = (y - 60) / 28;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (kind === "evidence") {
        const v = Math.max(0, 1.2 - r) * (0.4 + seed * 0.15);
        if (v < 0.08) continue;
        g.fillStyle = ramp[v > 0.55 ? 0 : v > 0.25 ? 1 : 2] as string;
        g.globalAlpha = 1;
        g.fillRect(x, y, 1, 1);
      } else if (kind === "qa") {
        if ((x * 7 + y * 13 + seed * 31) % 97 < 9 || (x > 100 && y > 90)) {
          g.fillStyle = "#0E1020";
          g.globalAlpha = 0.7;
          g.fillRect(x, y, 1, 1);
        }
      } else if (r < 0.75) {
        g.fillStyle = "#E0489B";
        g.globalAlpha = 0.9;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  return c.toDataURL("image/png");
}

export function buildFixtureMission(): MissionManifest {
  const dates = ["2026-07-02", "2026-07-14", "2026-07-26", "2026-08-07", "2026-08-19", "2026-08-31"];
  const masks: MissionManifest["masks"] = {};
  const steps: TemporalStep[] = dates.map((date, i) => {
    const available = i !== 3;
    const qaId = `qa-${i}`;
    if (available) {
      masks[qaId] = {
        maskId: qaId,
        version: "fixture",
        width: 128,
        height: 128,
        bounds: AOI,
        crs: "EPSG:4326",
        binUrl: "",
        pngUrl: raster(i, "qa"),
        sha256: "",
      };
    }
    return {
      schemaVersion: 2,
      stepId: `s${String(i).padStart(2, "0")}`,
      date,
      acquisitionStart: `${date}T13:50:00Z`,
      acquisitionEnd: `${date}T13:50:30Z`,
      isAvailable: available,
      platform: "NISAR",
      instrument: "L-SAR",
      processingVersion: "fixture",
      sourceId: "TEST_FIXTURE",
      layerId: "displacement",
      tileUrlTemplate: available ? raster(i, "evidence") : "",
      crs: "EPSG:4326",
      bounds: AOI,
      resolutionMeters: 300,
      noDataValue: null,
      displacement: null,
      acquisition: null,
      tiling: { tileMatrixSet: "SINGLE_TILE", minZoom: 0, maxZoom: 0 },
      qaMaskId: available ? qaId : null,
      qaMaskUrlTemplate: null,
      evidenceMaskId: null,
      evidenceMaskUrlTemplate: null,
      uncertainty: null,
      uncertaintyType: "none",
      license: "TEST_FIXTURE",
      attribution: "TEST_FIXTURE raster",
      citation: "",
    };
  });
  masks.ref = {
    maskId: "ref",
    version: "fixture",
    width: 128,
    height: 128,
    bounds: AOI,
    crs: "EPSG:4326",
    binUrl: "",
    pngUrl: raster(0, "ref"),
    sha256: "",
  };
  return {
    schemaVersion: 1,
    missionId: "fixture",
    caseId: "CASE_000",
    title: "Fixture",
    kicker: "TEST_FIXTURE",
    theme: "subsidence",
    aoi: { decision: "PENDING", bounds: null, name: null, source: null, injectedBy: null, injectedAt: null },
    effectiveBounds: AOI,
    labels: ["TEST_FIXTURE", "SIMULATED"],
    briefing: { question: "", summary: "", body: [], location: "", dates: "", source: "", facts: [] },
    steps,
    masks,
    referenceMaskId: "ref",
    referencePolygons: [
      [
        { lon: -120.08, lat: 36.12 },
        { lon: -119.9, lat: 36.1 },
        { lon: -119.88, lat: 35.98 },
        { lon: -120.05, lat: 35.97 },
      ],
    ],
    contextLayers: [],
    legend: { ramp: ["#8F5236", "#C9784A", "#E2B08A"], labels: ["high", "mid", "low"], unit: "cm", thresholds: [2, 5] },
    camera: { home: { lon: -100, lat: 30, heightM: 15000000 }, aoi: { lon: -120.0, lat: 36.05, heightM: 70000 } },
    attributions: [],
  };
}

export const FIXTURE_BASEMAP = {
  online: {
    urlTemplate:
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
    crs: "EPSG:3857",
    minZoom: 0,
    maxZoom: 8,
    attribution: "NASA GIBS — Blue Marble Shaded Relief & Bathymetry",
  },
  offline: {
    urlTemplate: "offline-tiles/bluemarble/{z}/{y}/{x}.jpeg",
    crs: "EPSG:3857",
    minZoom: 0,
    maxZoom: 5,
    attribution: "NASA GIBS — Blue Marble (bundled, OFFLINE)",
  },
};
