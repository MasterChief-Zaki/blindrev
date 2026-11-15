import { describe, expect, it } from "vitest";
import { sha256, utf8Encode } from "./digest";
import { daysBetween, digestHex, mulberry32, parseIsoUtcMs, sha256Hex } from "./index";

describe("sha256 / digestHex (FIPS 180-4 vectors)", () => {
  it("matches the standard test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("covers every padding boundary length (55/56/63/64/65 bytes) consistently", () => {
    for (const len of [55, 56, 57, 63, 64, 65, 119, 120, 128]) {
      const bytes = new Uint8Array(len).fill(0x61);
      expect(sha256Hex(bytes)).toBe(sha256Hex("a".repeat(len)));
      expect(sha256(bytes)).toHaveLength(32);
    }
  });

  it("UTF-8 encodes strings like TextEncoder (incl. surrogate pairs)", () => {
    expect(Array.from(utf8Encode("é"))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8Encode("€"))).toEqual([0xe2, 0x82, 0xac]);
    expect(Array.from(utf8Encode("😀"))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    expect(Array.from(utf8Encode("\ud800"))).toEqual([0xef, 0xbf, 0xbd]);
    expect(digestHex("km²")).toBe(digestHex(utf8Encode("km²")));
  });

  it("digestHex is 64 lower-case hex chars and input-sensitive", () => {
    const d = digestHex("blindrev");
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(digestHex("blindrev")).toBe(d);
    expect(digestHex("blindreV")).not.toBe(d);
  });
});

describe("mulberry32", () => {
  it("is deterministic per seed and in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10_000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("different seeds give different streams", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const sa = Array.from({ length: 8 }, () => a());
    const sb = Array.from({ length: 8 }, () => b());
    expect(sa).not.toEqual(sb);
  });

  it("regression pin (values recorded from this implementation; guards accidental changes)", () => {
    const r = mulberry32(12345);
    const first = [r(), r(), r()].map((x) => Math.round(x * 2 ** 32));
    // Integers in [0, 2^32): exact. Recorded at implementation time.
    expect(first).toEqual(MULBERRY_PIN_12345);
  });
});

// Regression pin recorded from the first run of this implementation (not an external oracle).
const MULBERRY_PIN_12345 = [4207900869, 1317490944, 2079646450];

describe("parseIsoUtcMs / daysBetween", () => {
  it("agrees with Date.UTC on Z-suffixed and zone-less inputs (zone-less = UTC)", () => {
    expect(parseIsoUtcMs("2026-11-15T17:42:08Z")).toBe(Date.UTC(2026, 10, 15, 17, 42, 8));
    expect(parseIsoUtcMs("2026-11-15T17:42:08")).toBe(Date.UTC(2026, 10, 15, 17, 42, 8));
    expect(parseIsoUtcMs("2026-11-15")).toBe(Date.UTC(2026, 10, 15));
    expect(parseIsoUtcMs("1970-01-01T00:00:00Z")).toBe(0);
    expect(parseIsoUtcMs("2000-02-29T12:00:00.250Z")).toBe(Date.UTC(2000, 1, 29, 12, 0, 0, 250));
    expect(parseIsoUtcMs("1969-12-31T23:59:59Z")).toBe(-1000);
  });

  it("applies offsets", () => {
    expect(parseIsoUtcMs("2026-01-01T02:00:00+02:00")).toBe(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(parseIsoUtcMs("2026-01-01T00:00:00-0530")).toBe(Date.UTC(2026, 0, 1, 5, 30, 0));
  });

  it("rejects malformed or impossible dates with NaN", () => {
    for (const bad of [
      "",
      "2026-13-01",
      "2026-02-30",
      "2025-02-29",
      "2026-01-01T25:00:00Z",
      "yesterday",
      "2026/01/01",
    ]) {
      expect(parseIsoUtcMs(bad)).toBeNaN();
    }
    expect(daysBetween("2026-01-01", "nope")).toBeNaN();
  });

  it("daysBetween is signed B − A in days", () => {
    expect(daysBetween("2026-01-01", "2026-01-25")).toBe(24);
    expect(daysBetween("2026-01-25", "2026-01-01")).toBe(-24);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // leap year
    expect(daysBetween("2023-02-28", "2023-03-01")).toBe(1);
    expect(daysBetween("2026-01-01T00:00:00Z", "2026-01-01T12:00:00Z")).toBe(0.5);
    expect(daysBetween("2025-12-31T23:00:00-01:00", "2026-01-01T00:00:00Z")).toBe(0);
  });
});
