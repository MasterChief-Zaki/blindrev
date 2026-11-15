import type { Bounds, GridSpec, MaskAsset, MaskGrid } from "../contracts";
import { sha256Hex } from "../util/digest";
import { assertGridSpec, pixelCentreLats, pixelCentreLons } from "./rasterize";

export class MaskDecodeError extends Error {
  readonly maskId: string;
  constructor(maskId: string, message: string) {
    super(message);
    this.name = "MaskDecodeError";
    this.maskId = maskId;
  }
}

export interface DecodeMaskOptions {
  /**
   * Verify `asset.sha256` against the bytes (default true). Skipped when `asset.sha256` is not a
   * 64-char hex string (e.g. a placeholder).
   */
  verifySha256?: boolean;
}

/**
 * Decode a `.bin` mask (raw Uint8, row-major, width*height bytes) into a `MaskGrid`.
 * Values are normalised to 0/1 (any non-zero byte = 1) in a fresh array. Throws `MaskDecodeError`
 * on a non-EPSG:4326 asset, a bad grid spec, a byte-length mismatch or a SHA-256 mismatch — a
 * corrupted answer key must never be scored silently.
 */
export function decodeMask(asset: MaskAsset, bytes: ArrayBuffer | Uint8Array, opts: DecodeMaskOptions = {}): MaskGrid {
  const id = asset.maskId ?? "(unknown mask)";
  if (asset.crs !== "EPSG:4326") {
    throw new MaskDecodeError(id, `Mask ${id} is ${String(asset.crs)}; scoring masks must be EPSG:4326`);
  }
  try {
    assertGridSpec(asset, `mask ${id}`);
  } catch (err) {
    throw new MaskDecodeError(id, err instanceof Error ? err.message : String(err));
  }
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const expected = asset.width * asset.height;
  if (src.length !== expected) {
    throw new MaskDecodeError(
      id,
      `Mask ${id} has ${src.length} bytes; expected ${expected} (${asset.width}×${asset.height})`,
    );
  }
  const verify = opts.verifySha256 ?? true;
  if (verify && typeof asset.sha256 === "string" && /^[0-9a-f]{64}$/i.test(asset.sha256)) {
    const actual = sha256Hex(src);
    if (actual !== asset.sha256.toLowerCase()) {
      throw new MaskDecodeError(id, `Mask ${id} failed its integrity check (sha256 ${actual} ≠ ${asset.sha256})`);
    }
  }
  const data = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) data[i] = src[i] !== 0 ? 1 : 0;
  return {
    width: asset.width,
    height: asset.height,
    bounds: [asset.bounds[0], asset.bounds[1], asset.bounds[2], asset.bounds[3]],
    crs: "EPSG:4326",
    data,
  };
}

/** A mask delivered on a Web-Mercator (EPSG:3857) grid. `bounds` are its corners in degrees. */
export interface MercatorMaskGrid {
  width: number;
  height: number;
  bounds: Bounds;
  crs: "EPSG:3857";
  /** Row-major, row 0 = north, rows uniform in Mercator y. Non-zero = valid/inside. */
  data: Uint8Array;
}

const MERC_R = 6_378_137;
const MERC_MAX_LAT = 85.051_128_779_806_59;
const DEG = Math.PI / 180;

function mercY(latDeg: number): number {
  const lat = Math.max(-MERC_MAX_LAT, Math.min(MERC_MAX_LAT, latDeg));
  return MERC_R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
}

/**
 * Resample an EPSG:3857 mask onto an EPSG:4326 `GridSpec` (nearest neighbour at target pixel centres;
 * outside the source = 0). Use this in the data pipeline — never mix CRS at pixel level in scoring.
 * Uses `Math.log`/`Math.tan`, so it is deterministic within one JS engine but not guaranteed
 * bit-identical across engines; scoring itself never calls it.
 */
export function reprojectMercatorMaskTo4326(src: MercatorMaskGrid, target: GridSpec): MaskGrid {
  if (src.crs !== "EPSG:3857") throw new RangeError(`reprojectMercatorMaskTo4326: source is ${String(src.crs)}`);
  assertGridSpec({ ...src, crs: "EPSG:4326" }, "mercator source");
  assertGridSpec(target, "target grid");
  if (src.data.length !== src.width * src.height)
    throw new RangeError("reprojectMercatorMaskTo4326: data length mismatch");
  const [sw, ss, se, sn] = src.bounds;
  const x0 = MERC_R * sw * DEG;
  const x1 = MERC_R * se * DEG;
  const y0 = mercY(ss);
  const y1 = mercY(sn);
  const lons = pixelCentreLons(target);
  const lats = pixelCentreLats(target);
  const out = new Uint8Array(target.width * target.height);
  const cols = new Int32Array(target.width);
  for (let c = 0; c < target.width; c++) {
    const x = MERC_R * (lons[c] as number) * DEG;
    cols[c] = Math.floor(((x - x0) / (x1 - x0)) * src.width);
  }
  for (let r = 0; r < target.height; r++) {
    const y = mercY(lats[r] as number);
    const sr = Math.floor(((y1 - y) / (y1 - y0)) * src.height);
    if (sr < 0 || sr >= src.height) continue;
    for (let c = 0; c < target.width; c++) {
      const sc = cols[c] as number;
      if (sc < 0 || sc >= src.width) continue;
      out[r * target.width + c] = src.data[sr * src.width + sc] !== 0 ? 1 : 0;
    }
  }
  return {
    width: target.width,
    height: target.height,
    bounds: [target.bounds[0], target.bounds[1], target.bounds[2], target.bounds[3]],
    crs: "EPSG:4326",
    data: out,
  };
}
