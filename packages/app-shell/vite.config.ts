import { cpSync, createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

/** Locate cesium's Build/Cesium folder. app-shell may or may not list cesium directly (pnpm is strict),
 *  so fall back to resolving it from renderer-globe, which must depend on it. */
function findCesiumBuild(): string | null {
  const candidates = [resolve(here, "package.json"), resolve(repoRoot, "packages/renderer-globe/package.json")];
  for (const from of candidates) {
    if (!existsSync(from)) continue;
    try {
      const req = createRequire(from);
      const pkgDir = dirname(req.resolve("cesium/package.json"));
      const build = resolve(pkgDir, "Build/Cesium");
      if (existsSync(build)) return build;
    } catch {
      /* try next */
    }
  }
  return null;
}

const cesiumBuild = findCesiumBuild();
/** Build only: copy Build/Cesium/{Workers,ThirdParty,Assets,Widgets} → <outDir>/cesium/ (plain fs.cpSync;
 *  vite-plugin-static-copy v4 kept the absolute pnpm path structure, which broke CESIUM_BASE_URL). */
function cesiumBuildAssets(root: string | null): Plugin {
  let outDir = "dist";
  return {
    name: "blindrev-cesium-build-assets",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    writeBundle() {
      if (!root) {
        this.warn("cesium Build/Cesium not found — globe assets not copied");
        return;
      }
      for (const d of ["Workers", "ThirdParty", "Assets", "Widgets"]) {
        cpSync(resolve(root, d), resolve(outDir, "cesium", d), { recursive: true });
      }
    },
  };
}

const MIME: Record<string, string> = {
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  css: "text/css",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  wasm: "application/wasm",
  xml: "application/xml",
  glb: "model/gltf-binary",
  ktx2: "image/ktx2",
  woff: "font/woff",
  woff2: "font/woff2",
};

/** Dev only: serve node_modules/cesium/Build/Cesium at /cesium/* (cesiumBuildAssets handles the production build). */
function cesiumDevAssets(root: string | null): Plugin {
  return {
    name: "blindrev-cesium-dev-assets",
    apply: "serve",
    configureServer(server) {
      if (!root) return;
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        const m = /^\/(?:[^?]*\/)?cesium\/(.+)$/.exec(url);
        if (!m?.[1]) return next();
        const rel = decodeURIComponent(m[1]);
        if (rel.includes("..")) return next();
        const file = resolve(root, rel);
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        const ext = file.split(".").pop()?.toLowerCase() ?? "";
        res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
  };
}

/** `virtual:blindrev-credits`: unique license + attribution pairs from data/assets.manifest.json, resolved at
 *  build time so the Credits screen cannot drift from the shipped assets. */
function assetCredits(): Plugin {
  const id = "virtual:blindrev-credits";
  const resolved = `\0${id}`;
  const manifest = resolve(repoRoot, "data/assets.manifest.json");
  return {
    name: "blindrev-asset-credits",
    resolveId(src) {
      return src === id ? resolved : null;
    },
    load(src) {
      if (src !== resolved) return null;
      this.addWatchFile(manifest);
      const out: { license: string; attribution: string; source: string; folders: string[] }[] = [];
      if (existsSync(manifest)) {
        const m = JSON.parse(readFileSync(manifest, "utf8")) as {
          files?: { path: string; license?: string; attribution?: string; source?: string }[];
        };
        const byKey = new Map<string, (typeof out)[number]>();
        for (const f of m.files ?? []) {
          if (!f.license || !f.attribution) continue;
          const key = `${f.license}\u0000${f.attribution}`;
          const folder = f.path.split("/").slice(0, -1).join("/") || ".";
          const e = byKey.get(key);
          if (e) {
            if (!e.folders.includes(folder) && e.folders.length < 6) e.folders.push(folder);
          } else
            byKey.set(key, {
              license: f.license,
              attribution: f.attribution,
              source: f.source ?? "",
              folders: [folder],
            });
        }
        out.push(...byKey.values());
      }
      return `export default ${JSON.stringify(out)};`;
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), assetCredits(), cesiumDevAssets(cesiumBuild), cesiumBuildAssets(cesiumBuild)],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  preview: { port: 4173, strictPort: true },
  // Pre-bundle the heavy renderer deps up front: discovering them at the first lazy import() would make the
  // dev server re-optimise and reload the page mid-route-switch.
  optimizeDeps: {
    include: [
      "cesium",
      "three",
      "postprocessing",
      "satellite.js",
      "zod",
      "zustand",
      "react",
      "react-dom",
      "react-dom/client",
    ],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  worker: { format: "es" },
});
