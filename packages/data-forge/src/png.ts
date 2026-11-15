/**
 * Deterministic indexed-colour PNG encoder (pure TypeScript, no zlib).
 *
 * Why not zlib/pngjs for writing: Node's bundled zlib (Chromium fork) may pick CPU-specific
 * hashing, so the same pixels can compress to different bytes on different machines. Our own
 * LZ77 + fixed-Huffman deflate makes every output byte a pure function of the pixels, which the
 * asset-manifest gate (re-forge → identical SHA-256) depends on. pngjs is used only to read back.
 */

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = start; i < end; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + 5552);
    for (; i < end; i++) {
      a += bytes[i] as number;
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// ---------------------------------------------------------------------------
// Bit writer (LSB-first, as deflate requires)
// ---------------------------------------------------------------------------

class BitWriter {
  private buf: Uint8Array;
  private pos = 0;
  private bitBuf = 0;
  private bitCount = 0;
  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(1024, capacity));
  }
  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.pos + n));
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }
  /** write `n` bits of `value`, LSB first */
  bits(value: number, n: number): void {
    this.bitBuf |= (value & ((1 << n) - 1)) << this.bitCount;
    this.bitCount += n;
    while (this.bitCount >= 8) {
      this.ensure(1);
      this.buf[this.pos++] = this.bitBuf & 0xff;
      this.bitBuf >>>= 8;
      this.bitCount -= 8;
    }
  }
  /** write a Huffman code of length `n`, MSB of the code first */
  code(code: number, n: number): void {
    let rev = 0;
    for (let i = 0; i < n; i++) rev |= ((code >>> i) & 1) << (n - 1 - i);
    this.bits(rev, n);
  }
  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.ensure(1);
      this.buf[this.pos++] = this.bitBuf & 0xff;
      this.bitBuf = 0;
      this.bitCount = 0;
    }
    return this.buf.slice(0, this.pos);
  }
}

// ---------------------------------------------------------------------------
// Deflate: greedy LZ77 (hash chains) + one fixed-Huffman block (RFC 1951 §3.2.6)
// ---------------------------------------------------------------------------

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function writeLiteral(w: BitWriter, v: number): void {
  if (v <= 143) w.code(0x30 + v, 8);
  else if (v <= 255) w.code(0x190 + (v - 144), 9);
  else if (v <= 279) w.code(v - 256, 7);
  else w.code(0xc0 + (v - 280), 8);
}

function writeMatch(w: BitWriter, len: number, dist: number): void {
  let li = LEN_BASE.length - 1;
  while ((LEN_BASE[li] as number) > len) li--;
  writeLiteral(w, 257 + li);
  if ((LEN_EXTRA[li] as number) > 0) w.bits(len - (LEN_BASE[li] as number), LEN_EXTRA[li] as number);
  let di = DIST_BASE.length - 1;
  while ((DIST_BASE[di] as number) > dist) di--;
  w.code(di, 5);
  if ((DIST_EXTRA[di] as number) > 0) w.bits(dist - (DIST_BASE[di] as number), DIST_EXTRA[di] as number);
}

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const MAX_CHAIN = 48;

export function deflateRaw(data: Uint8Array): Uint8Array {
  const w = new BitWriter(Math.ceil(data.length / 4) + 64);
  w.bits(1, 1); // BFINAL
  w.bits(1, 2); // BTYPE = 01 (fixed Huffman)
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(WINDOW).fill(-1);
  const n = data.length;
  const hashAt = (i: number) =>
    ((((data[i] as number) << 10) ^ ((data[i + 1] as number) << 5) ^ (data[i + 2] as number)) * 2654435761) >>>
    (32 - HASH_BITS);
  const insert = (i: number) => {
    if (i + MIN_MATCH > n) return;
    const h = hashAt(i);
    prev[i & (WINDOW - 1)] = head[h] as number;
    head[h] = i;
  };
  let i = 0;
  while (i < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + MIN_MATCH <= n) {
      let cand = head[hashAt(i)] as number;
      let chain = 0;
      const maxLen = Math.min(MAX_MATCH, n - i);
      while (cand >= 0 && i - cand <= WINDOW && chain < MAX_CHAIN) {
        if (data[cand + bestLen] === data[i + bestLen]) {
          let l = 0;
          while (l < maxLen && data[cand + l] === data[i + l]) l++;
          if (l > bestLen) {
            bestLen = l;
            bestDist = i - cand;
            if (l === maxLen) break;
          }
        }
        const p = prev[cand & (WINDOW - 1)] as number;
        if (p >= cand) break;
        cand = p;
        chain++;
      }
    }
    if (bestLen >= MIN_MATCH) {
      writeMatch(w, bestLen, bestDist);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      writeLiteral(w, data[i] as number);
      insert(i);
      i++;
    }
  }
  writeLiteral(w, 256); // end of block
  return w.finish();
}

export function zlibWrap(data: Uint8Array): Uint8Array {
  const body = deflateRaw(data);
  const out = new Uint8Array(2 + body.length + 4);
  out[0] = 0x78;
  out[1] = 0x01; // (0x78 * 256 + 0x01) % 31 === 0, fastest-compression flag
  out.set(body, 2);
  const a = adler32(data);
  out[out.length - 4] = (a >>> 24) & 0xff;
  out[out.length - 3] = (a >>> 16) & 0xff;
  out[out.length - 2] = (a >>> 8) & 0xff;
  out[out.length - 1] = a & 0xff;
  return out;
}

// ---------------------------------------------------------------------------
// PNG container
// ---------------------------------------------------------------------------

function u32be(v: number): Uint8Array {
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32be(crc32(out, 4, 8 + data.length)), 8 + data.length);
  return out;
}

export interface PaletteEntry {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = Number.parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

/**
 * Encode an indexed-colour PNG (colour type 3) with a tRNS chunk.
 * `indices` is row-major width*height palette indices. Bit depth is chosen from the palette size.
 */
export function encodeIndexedPng(
  width: number,
  height: number,
  indices: Uint8Array,
  palette: PaletteEntry[],
): Uint8Array {
  if (indices.length !== width * height) throw new Error("encodeIndexedPng: indices length mismatch");
  if (palette.length < 1 || palette.length > 256) throw new Error("encodeIndexedPng: palette size must be 1..256");
  const bitDepth = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8;
  const perByte = 8 / bitDepth;
  const rowBytes = Math.ceil(width / perByte);
  const raw = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (rowBytes + 1);
    raw[o] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const v = indices[y * width + x] as number;
      if (v >= palette.length) throw new Error(`encodeIndexedPng: index ${v} out of palette`);
      const byteIdx = o + 1 + Math.floor(x / perByte);
      const shift = 8 - bitDepth * ((x % perByte) + 1);
      raw[byteIdx] = (raw[byteIdx] as number) | (v << shift);
    }
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = bitDepth;
  ihdr[9] = 3; // indexed colour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const plte = new Uint8Array(palette.length * 3);
  const trns = new Uint8Array(palette.length);
  palette.forEach((p, i) => {
    plte[i * 3] = p.r;
    plte[i * 3 + 1] = p.g;
    plte[i * 3 + 2] = p.b;
    trns[i] = p.a;
  });
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("tRNS", trns),
    chunk("IDAT", zlibWrap(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
