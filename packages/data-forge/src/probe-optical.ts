/**
 * Date finder for sharp optical context (network): scores GIBS HLS true-colour days over the padded
 * window from one low-zoom tile per day — coverage (opaque fraction) and cloud fraction (bright, unsaturated).
 *
 *   tsx src/probe-optical.ts <layerId> <fromDate> <toDate> [zoom=7]
 */
import { PNG } from "pngjs";
import type { Bounds } from "@blindrev/core-sim";
import { GIBS_3857, OPTICAL_WINDOW } from "./config";
import { tilesForBounds } from "./tiles";

function* days(from: string, to: string): Generator<string> {
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000)
    yield new Date(t).toISOString().slice(0, 10);
}

function pixLat(y: number, z: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
}

export async function scoreDay(
  layerId: string,
  day: string,
  z: number,
  win: Bounds,
): Promise<{ day: string; coverage: number; cloud: number }> {
  let px = 0;
  let opaque = 0;
  let cloud = 0;
  for (const t of tilesForBounds(win, z, z)) {
    const res = await fetch(
      `${GIBS_3857}/${layerId}/default/${day}/GoogleMapsCompatible_Level12/${t.z}/${t.y}/${t.x}.png`,
      {
        headers: { "User-Agent": "blindrev-data-forge/0.1 (build-time probe)" },
      },
    );
    if (res.status !== 200) {
      px += 1;
      continue;
    }
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    for (let r = 0; r < png.height; r++) {
      const lat = pixLat(t.y + (r + 0.5) / png.height, z);
      if (lat < win[1] || lat > win[3]) continue;
      for (let c = 0; c < png.width; c++) {
        const lon = ((t.x + (c + 0.5) / png.width) / 2 ** z) * 360 - 180;
        if (lon < win[0] || lon > win[2]) continue;
        const o = (r * png.width + c) * 4;
        px++;
        if ((png.data[o + 3] as number) < 200) continue;
        opaque++;
        const R = png.data[o] as number;
        const G = png.data[o + 1] as number;
        const B = png.data[o + 2] as number;
        if (Math.min(R, G, B) > 175 && Math.max(R, G, B) - Math.min(R, G, B) < 30) cloud++;
      }
    }
  }
  return { day, coverage: px ? opaque / px : 0, cloud: opaque ? cloud / opaque : 1 };
}

async function main(): Promise<void> {
  const [layerId, from, to, zs] = process.argv.slice(2);
  if (!layerId || !from || !to) throw new Error("usage: probe-optical.ts <layerId> <from> <to> [zoom]");
  const z = Number(zs ?? 7);
  const list = [...days(from, to)];
  const out: { day: string; coverage: number; cloud: number }[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (i < list.length) {
        const d = list[i++] as string;
        out.push(await scoreDay(layerId, d, z, OPTICAL_WINDOW));
      }
    }),
  );
  out.sort((a, b) => (a.day < b.day ? -1 : 1));
  for (const r of out)
    if (r.coverage > 0.5)
      console.log(
        `${layerId} ${r.day} coverage ${(r.coverage * 100).toFixed(1)} % cloud ${(r.cloud * 100).toFixed(1)} %`,
      );
}

if (process.argv[1] && /probe-optical\.ts$/.test(process.argv[1]))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
