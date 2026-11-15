/**
 * Spike D runner: `pnpm --filter @blindrev/geodesy-verify verify [--json <file>] [--strict-parity]`
 * Prints a pass/fail table with measured max errors, correctness and parity reported separately.
 * Exit code: 1 if any CORRECTNESS metric fails. Parity-only failures are reported but exit 0
 * (spec §8: a parity-only failure must not block a provably correct implementation) unless
 * --strict-parity is given.
 */
import { writeFileSync } from "node:fs";
import { runCorrectness } from "./correctness";
import { type Metric, gating } from "./metric";

function fmt(v: number): string {
  if (v === 0) return "0";
  if (!Number.isFinite(v)) return String(v);
  return v.toExponential(3);
}

function table(title: string, rows: Metric[]): string {
  const head = ["id", "op", "quantity", "n", "tolerance", "max error", "result"];
  const body = rows.map((r) => [
    r.id,
    r.op,
    r.quantity,
    String(r.n),
    `${fmt(r.tolerance)} ${r.unit}`,
    `${fmt(r.maxError)} ${r.unit}`,
    r.diagnostic ? (r.pass ? "diag ≤ tol" : "diag > tol") : r.pass ? "PASS" : "FAIL",
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] as string).length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i] as number)).join(" | ")} |`;
  const sep = `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`;
  return [`\n## ${title}`, line(head), sep, ...body.map(line)].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf("--json");
  const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
  const strictParity = args.includes("--strict-parity");

  const t0 = performance.now();
  const correctness = runCorrectness();
  const t1 = performance.now();
  let parity: Metric[] = [];
  let parityError: string | null = null;
  try {
    const mod = await import("./parity");
    parity = mod.runParity();
  } catch (e) {
    parityError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const t2 = performance.now();

  const cOk = gating(correctness).every((m) => m.pass);
  const pOk = parityError === null && gating(parity).every((m) => m.pass);
  console.log("# geodesy-verify — Spike D (spec §8)");
  console.log(
    table(
      `Correctness (independent analytic oracles + closure) — ${cOk ? "PASS" : "FAIL"} (${(t1 - t0).toFixed(0)} ms)`,
      correctness,
    ),
  );
  if (parityError) console.log(`\n## Parity vs CesiumJS — NOT MEASURED (${parityError})`);
  else console.log(table(`Parity vs CesiumJS — ${pOk ? "PASS" : "FAIL"} (${(t2 - t1).toFixed(0)} ms)`, parity));
  for (const m of [...correctness, ...parity].filter((x) => !x.pass)) {
    console.log(`  worst case ${m.id}: ${fmt(m.maxError)} ${m.unit} at ${m.worst}`);
  }
  console.log(
    `\nCORRECTNESS: ${cOk ? "PASS" : "FAIL"}   PARITY: ${parityError ? "NOT MEASURED" : pOk ? "PASS" : "FAIL (non-blocking)"}`,
  );

  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify({ correctness, parity, parityError }, null, 2)}\n`);
  }
  process.exitCode = !cOk ? 1 : strictParity && !pOk ? 2 : 0;
}

void main();
