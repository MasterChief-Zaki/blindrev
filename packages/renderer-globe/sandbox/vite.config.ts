import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

// Globe sandbox (port 5181). publicDir = app-shell/public (mission rasters, offline tiles);
// Cesium's static assets (Workers, Assets, ThirdParty, Widgets) are served at /cesium/;
// the repo's data/ folder (mission manifest, prefabs, TLE) is served read-only at /__data/.

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..");
const repoDir = resolve(pkgDir, "../..");
const cesiumBuild = resolve(pkgDir, "node_modules/cesium/Build/Cesium");

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
  ".txt": "text/plain",
  ".html": "text/html",
};

function staticDir(prefix: string, dir: string): Plugin {
  return {
    name: `static:${prefix}`,
    configureServer(server) {
      server.middlewares.use(prefix, (req, res, next) => {
        const url = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        const file = normalize(resolve(dir, `.${url}`));
        if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.setHeader("Content-Type", MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).on("error", next).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: resolve(pkgDir, "../app-shell/public"),
  server: { port: 5181, strictPort: true, fs: { allow: [repoDir] } },
  plugins: [staticDir("/cesium", cesiumBuild), staticDir("/__data", resolve(repoDir, "data"))],
  optimizeDeps: { include: ["cesium"] },
});
