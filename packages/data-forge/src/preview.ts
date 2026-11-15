/**
 * Dev aid: composite evidence + QA (+ optional reference outline) over a flat grey ground into one
 * opaque RGBA PNG for eyeballing. Decodes with pngjs, i.e. also proves our encoder's output is valid.
 *
 *   tsx src/preview.ts <stepId> <out.png> [--reference] [--context <dir-of-z-y-x-tiles>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { MISSION_DATA_REL, PUBLIC_DIR } from "./config";
import { repoPath } from "./paths";

export function decodePng(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

function main(): void {
  const [stepId, out] = process.argv.slice(2);
  if (!stepId || !out) throw new Error("usage: preview.ts <stepId> <out.png> [--reference]");
  const withRef = process.argv.includes("--reference");
  const ev = decodePng(repoPath(PUBLIC_DIR, MISSION_DATA_REL, "evidence", `${stepId}.png`));
  const qa = decodePng(repoPath(PUBLIC_DIR, MISSION_DATA_REL, "qa", `${stepId}.png`));
  const ref = withRef ? decodePng(repoPath(PUBLIC_DIR, MISSION_DATA_REL, "reference", "mask-v1.png")) : null;
  const W = ev.width;
  const H = ev.height;
  const img = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let r = 92;
      let g = 96;
      let b = 104;
      const blend = (src: Buffer, so: number) => {
        const a = (src[so + 3] as number) / 255;
        r = r * (1 - a) + (src[so] as number) * a;
        g = g * (1 - a) + (src[so + 1] as number) * a;
        b = b * (1 - a) + (src[so + 2] as number) * a;
      };
      blend(ev.data, o);
      const qx = Math.floor((x * qa.width) / W);
      const qy = Math.floor((y * qa.height) / H);
      blend(qa.data, (qy * qa.width + qx) * 4);
      if (ref) blend(ref.data, (qy * ref.width + qx) * 4);
      img.data[o] = Math.round(r);
      img.data[o + 1] = Math.round(g);
      img.data[o + 2] = Math.round(b);
      img.data[o + 3] = 255;
    }
  }
  writeFileSync(out, PNG.sync.write(img));
  console.log(`preview ${stepId} → ${out} (${W}×${H})`);
}

if (process.argv[1] && /preview\.ts$/.test(process.argv[1])) main();
