import {
  decodeMask,
  parseCameraConfig,
  parseGameConstants,
  parseMissionManifest,
  parseQualityPresets,
  parseTleSnapshot,
} from "@blindrev/core-sim";
import type {
  CameraConfig,
  GameConstants,
  MaskAsset,
  MaskGrid,
  MissionManifest,
  QualityPreset,
  TleSnapshot,
} from "@blindrev/core-sim";
import { assetUrl } from "../env";

/* Build-time imports of the declarative JSON (data/** lives outside the package; Vite inlines it).
 * Using import.meta.glob keeps the build working while a file is still missing; every value is
 * Zod-validated again at load time. */
const missionJson = import.meta.glob("../../../../data/missions/*.json", { eager: true, import: "default" });
const prefabJson = import.meta.glob("../../../../data/prefabs/*.json", { eager: true, import: "default" });
const tleJson = import.meta.glob("../../../../data/tle/*.json", { eager: true, import: "default" });

function pick(mods: Record<string, unknown>, fileName: string): unknown {
  for (const [k, v] of Object.entries(mods)) if (k.endsWith(`/${fileName}`)) return v;
  return undefined;
}

export class DataLoadError extends Error {
  constructor(
    readonly what: string,
    detail: string,
  ) {
    super(`${what}: ${detail}`);
    this.name = "DataLoadError";
  }
}

function zodMessage(e: unknown): string {
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    return (e as { issues: { path: (string | number)[]; message: string }[] }).issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }
  return e instanceof Error ? e.message : String(e);
}

export interface Prefabs {
  quality: Record<QualityPreset["id"], QualityPreset>;
  camera: CameraConfig;
  constants: GameConstants;
  basemap: unknown;
}

const FALLBACK_QUALITY: Record<QualityPreset["id"], QualityPreset> = {
  low: { id: "low", tileCacheSize: 100, maximumScreenSpaceError: 4, renderScale: 0.75, allow4k: false },
  medium: { id: "medium", tileCacheSize: 200, maximumScreenSpaceError: 2, renderScale: 1, allow4k: false },
  high: { id: "high", tileCacheSize: 400, maximumScreenSpaceError: 1.5, renderScale: 1, allow4k: true },
};

function parseQuality(raw: unknown): Record<QualityPreset["id"], QualityPreset> {
  if (raw === undefined) throw new DataLoadError("data/prefabs/quality.json", "missing");
  const list = Array.isArray(raw) ? raw : ((raw as { presets?: unknown })?.presets ?? raw);
  const out = {} as Record<QualityPreset["id"], QualityPreset>;
  for (const p of parseQualityPresets(list, "data/prefabs/quality.json")) out[p.id] = p;
  return out;
}

let prefabsCache: Prefabs | null = null;
export const loadWarnings: string[] = [];

export function loadPrefabs(): Prefabs {
  if (prefabsCache) return prefabsCache;
  let quality = FALLBACK_QUALITY;
  try {
    quality = parseQuality(pick(prefabJson, "quality.json"));
  } catch (e) {
    loadWarnings.push(`quality.json: ${zodMessage(e)} — using spec defaults`);
  }
  const camRaw = pick(prefabJson, "camera.json");
  const constRaw = pick(prefabJson, "constants.json");
  let camera: CameraConfig;
  let constants: GameConstants;
  try {
    camera = parseCameraConfig(camRaw, "data/prefabs/camera.json");
  } catch (e) {
    throw new DataLoadError("data/prefabs/camera.json", zodMessage(e));
  }
  try {
    constants = parseGameConstants(constRaw, "data/prefabs/constants.json");
  } catch (e) {
    throw new DataLoadError("data/prefabs/constants.json", zodMessage(e));
  }
  prefabsCache = { quality, camera, constants, basemap: pick(prefabJson, "basemap.json") ?? null };
  return prefabsCache;
}

export function loadTleSnapshot(): TleSnapshot {
  const raw = pick(tleJson, "nisar-65053.snapshot.json");
  try {
    return parseTleSnapshot(raw, "data/tle/nisar-65053.snapshot.json");
  } catch (e) {
    throw new DataLoadError("data/tle/nisar-65053.snapshot.json", zodMessage(e));
  }
}

/** All bundled missions, validated. The first (and today only) one is The Sinking City. */
export function loadMissions(): MissionManifest[] {
  const out: MissionManifest[] = [];
  for (const [path, raw] of Object.entries(missionJson)) {
    if (/\/_[^/]*$/.test(path)) continue; // `_*.json` = examples / fixtures, not shipped cases
    try {
      out.push(parseMissionManifest(raw, path.replace(/^(\.\.\/)+/, "")));
    } catch (e) {
      throw new DataLoadError(path.replace(/^(\.\.\/)+/, ""), zodMessage(e));
    }
  }
  return out;
}

export function loadMission(missionId = "sinking-city"): MissionManifest {
  const all = loadMissions();
  const m = all.find((x) => x.missionId === missionId) ?? all[0];
  if (!m) throw new DataLoadError("data/missions/sinking-city.json", "missing — mission data not built yet");
  return m;
}

const maskCache = new Map<string, Promise<MaskGrid>>();

/** Fetch a mask `.bin` and decode it into a MaskGrid (cached per maskId). */
export function fetchMask(asset: MaskAsset): Promise<MaskGrid> {
  const key = `${asset.maskId}@${asset.version}`;
  let p = maskCache.get(key);
  if (!p) {
    p = fetch(assetUrl(asset.binUrl))
      .then((r) => {
        if (!r.ok) throw new DataLoadError(asset.binUrl, `HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => decodeMask(asset, buf));
    p.catch(() => maskCache.delete(key));
    maskCache.set(key, p);
  }
  return p;
}

const f32Cache = new Map<string, Promise<Float32Array | null>>();

/** Optional per-step displacement grid (`.f32`, same grid as the step bounds). Null when absent. */
export function fetchF32(url: string, expectedLength: number): Promise<Float32Array | null> {
  let p = f32Cache.get(url);
  if (!p) {
    p = fetch(assetUrl(url))
      .then(async (r) => {
        if (!r.ok) return null;
        const ct = r.headers.get("content-type") ?? "";
        if (ct.includes("text/html")) return null; // dev-server SPA fallback
        const buf = await r.arrayBuffer();
        if (buf.byteLength !== expectedLength * 4) return null;
        return new Float32Array(buf);
      })
      .catch(() => null);
    f32Cache.set(url, p);
  }
  return p;
}
