/** @blindrev/data-forge — build-time data pipeline (Node only; run with tsx). */
export * from "./config";
export { forge, lineOfSight, readAoiDecision, sha256Hex, FORGE_VERSION } from "./forge";
export type { ForgedFile, ForgeOptions, ForgeResult, StepStats } from "./forge";
export { buildAssetsManifest, findLicense, listPublicFiles } from "./assets-manifest";
export type { AssetEntry, AssetsManifest, LicenseRecord } from "./assets-manifest";
export { runVerify } from "./verify";
export type { Check } from "./verify";
export { encodeIndexedPng, deflateRaw, crc32, adler32 } from "./png";
export { rasterizePolygonsPnpoly, makeGrid } from "./raster";
export { REFERENCE_POLYGONS } from "./reference";
export { BasemapPrefabSchema, AssetsManifestSchema, AssetLicenseSchema } from "./schemas";
export type { BasemapPrefab } from "./schemas";
export { tilesForBounds, globalTiles, tileBounds, lonToTileX, latToTileY } from "./tiles";
