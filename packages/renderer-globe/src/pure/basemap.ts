/**
 * Tolerant reader for data/prefabs/basemap.json (owned by agent D). The renderer only needs, for
 * each of `online` and `offline`: an XYZ URL template, its CRS, zoom range and attribution.
 * Accepts the common spellings so the renderer is not coupled to one exact key name.
 */

export type BasemapCrs = "EPSG:3857" | "EPSG:4326";

export interface BasemapSource {
  urlTemplate: string;
  crs: BasemapCrs;
  minZoom: number;
  maxZoom: number;
  attribution: string;
  title: string;
  tileSize: number;
  /** Optional coverage [w,s,e,n] in degrees (bundled tiles may only cover part of the world). */
  bounds: [number, number, number, number] | null;
  /** Optional higher-zoom regional coverage for bundled tiles (e.g. the AOI), drawn on top. */
  regional: BasemapSource | null;
}

export interface BasemapConfig {
  online: BasemapSource | null;
  offline: BasemapSource | null;
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickStr(o: Rec, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickNum(o: Rec, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Map WMTS REST placeholders to the XYZ placeholders Cesium's UrlTemplateImageryProvider uses. */
export function normaliseTemplate(t: string): string {
  return t
    .replaceAll("{TileMatrix}", "{z}")
    .replaceAll("{TileRow}", "{y}")
    .replaceAll("{TileCol}", "{x}")
    .replaceAll("{Z}", "{z}")
    .replaceAll("{Y}", "{y}")
    .replaceAll("{X}", "{x}");
}

function readBounds(o: Rec): [number, number, number, number] | null {
  for (const k of ["bounds", "coverage", "extent", "rectangle"]) {
    const v = o[k];
    if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return [v[0] as number, v[1] as number, v[2] as number, v[3] as number];
    }
  }
  return null;
}

export function readSource(v: unknown, depth = 0): BasemapSource | null {
  if (typeof v === "string") {
    return {
      urlTemplate: normaliseTemplate(v),
      crs: /epsg:?4326/i.test(v) ? "EPSG:4326" : "EPSG:3857",
      minZoom: 0,
      maxZoom: 8,
      attribution: "",
      title: "",
      tileSize: 256,
      bounds: null,
      regional: null,
    };
  }
  if (!isRec(v)) return null;
  const url = pickStr(v, ["urlTemplate", "tileUrlTemplate", "template", "url", "tiles"]);
  if (!url) return null;
  const tiling = isRec(v.tiling) ? v.tiling : {};
  const crsRaw = pickStr(v, ["crs", "projection", "srs"]) ?? pickStr(tiling, ["crs"]) ?? "";
  const crs: BasemapCrs = /4326/.test(crsRaw) || (!crsRaw && /epsg:?4326/i.test(url)) ? "EPSG:4326" : "EPSG:3857";
  const minZoom = pickNum(v, ["minZoom", "minimumLevel", "minLevel"]) ?? pickNum(tiling, ["minZoom"]) ?? 0;
  const maxZoom = pickNum(v, ["maxZoom", "maximumLevel", "maxLevel"]) ?? pickNum(tiling, ["maxZoom"]) ?? 8;
  const regionalRaw = depth === 0 ? (v.regional ?? v.aoi ?? v.detail ?? null) : null;
  const src: BasemapSource = {
    urlTemplate: normaliseTemplate(url),
    crs,
    minZoom,
    maxZoom,
    attribution: pickStr(v, ["attribution", "credit"]) ?? "",
    title: pickStr(v, ["title", "name", "layerId", "layer"]) ?? "",
    tileSize: pickNum(v, ["tileSize", "tileWidth"]) ?? 256,
    bounds: readBounds(v),
    regional: regionalRaw ? readSource(regionalRaw, depth + 1) : null,
  };
  // D's form: same template, z(maxZoom+1)..regionalMaxZoom only inside regionalBounds.
  const regMax = pickNum(v, ["regionalMaxZoom"]);
  const regBounds = readBounds({ bounds: v.regionalBounds });
  if (depth === 0 && !src.regional && regMax !== null && regMax > maxZoom && regBounds) {
    src.regional = { ...src, minZoom: maxZoom + 1, maxZoom: regMax, bounds: regBounds, regional: null };
  }
  return src;
}

export function parseBasemap(json: unknown): BasemapConfig {
  if (!isRec(json)) return { online: null, offline: null };
  return {
    online: readSource(json.online ?? json.gibs ?? json.remote ?? null),
    offline: readSource(json.offline ?? json.bundled ?? json.local ?? null),
  };
}
