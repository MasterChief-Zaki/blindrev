import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const uiHudModules = fileURLToPath(new URL("../../ui-hud/node_modules/", import.meta.url));

// Hub sandbox: full-window hub with sample missions. publicDir = the app's runtime asset root.
export default defineConfig({
  root: here,
  base: "./",
  publicDir: fileURLToPath(new URL("../../app-shell/public", import.meta.url)),
  resolve: {
    // Brand fonts are a ui-hud dependency; borrow them for the sandbox only (the app loads them itself).
    alias: { "@fontsource": `${uiHudModules}@fontsource` },
  },
  server: { port: 5182, strictPort: true, fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] } },
});
