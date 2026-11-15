import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (packages/data-forge/src → ../../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function repoPath(...parts: string[]): string {
  return join(REPO_ROOT, ...parts);
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeFileEnsured(path: string, data: string | Uint8Array): void {
  ensureDir(dirname(path));
  writeFileSync(path, data);
}

/** Stable JSON: 2-space indent, trailing newline (byte-identical across runs). */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Forward-slash relative path (for manifests and URLs). */
export function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}
