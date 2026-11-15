import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// UI gallery (dev only): `pnpm --filter @blindrev/ui-hud dev` → http://localhost:5183/
// Serves app-shell/public as the public dir so the real audio files resolve at `audio/…`.
export default defineConfig({
  root: fileURLToPath(new URL("./gallery", import.meta.url)),
  base: "./",
  publicDir: fileURLToPath(new URL("../app-shell/public", import.meta.url)),
  plugins: [react()],
  server: { port: 5183, strictPort: true },
  preview: { port: 5183, strictPort: true },
});
