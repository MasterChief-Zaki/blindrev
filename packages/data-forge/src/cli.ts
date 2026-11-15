/**
 * `pnpm --filter @blindrev/data-forge forge [--pending] [--out <dir>]`
 *
 * Offline + deterministic. Default: forges the INJECTED mission (unless data/missions/sinking-city.json
 * says aoi.decision = "PENDING") and always refreshes the PENDING-path fixture example.
 * --pending  only build the TEST_FIXTURE mission (data/missions/_fixture-pending.example.json)
 * --out DIR  write into DIR (mirrors the repo layout) instead of the repo root
 */
import { resolve } from "node:path";
import { forge } from "./forge";
import { REPO_ROOT } from "./paths";

function main(): void {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outRoot = outIdx >= 0 && args[outIdx + 1] ? resolve(args[outIdx + 1] as string) : REPO_ROOT;
  const pendingOnly = args.includes("--pending");
  const t0 = performance.now();
  const res = forge({ outRoot, pendingOnly, aoiFrom: REPO_ROOT, log: (m) => console.log(m) });
  const bytes = res.files.reduce((s, f) => s + f.bytes, 0);
  console.log(
    `forge: ${res.files.length} files, ${(bytes / 1e6).toFixed(2)} MB → ${outRoot} (${((performance.now() - t0) / 1000).toFixed(1)} s)`,
  );
  if (res.mission) {
    console.log(
      `mission ${res.mission.missionId}: ${res.mission.steps.length} steps, labels ${res.mission.labels.join(", ")}`,
    );
  }
}

main();
