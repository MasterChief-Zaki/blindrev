import { defineConfig, devices } from "@playwright/test";

/**
 * BlindRev Playwright suite (SPEC §14–§15).
 *
 * - `gating`: offline deterministic fixture (`?stub=1&offline=1`, fixed clock), no network, CI gate.
 * - `streaming`: real renderers with network allowed, tagged `@streaming`, non-gating.
 *
 * The app is built into `packages/app-shell/dist-e2e` (its own copy; `dist/` belongs to the desktop build)
 * and served by `vite preview` on port 4174. Set `E2E_BUILD=1` (or run under CI) to rebuild first.
 */
const PORT = 4174;
const filter = "pnpm --filter @blindrev/app-shell exec";
const preview = `${filter} vite preview --outDir dist-e2e --port ${PORT} --strictPort`;
const build = `${filter} vite build --outDir dist-e2e`;
const rebuild = !!process.env.CI || process.env.E2E_BUILD === "1";

export default defineConfig({
  testDir: ".",
  outputDir: "../../test-results/e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide", scale: "css" },
  },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["json", { outputFile: "../../test-results/e2e/results.json" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
  },
  projects: [
    {
      name: "gating",
      grepInvert: /@streaming/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        launchOptions: { args: ["--force-color-profile=srgb", "--font-render-hinting=none"] },
      },
    },
    // Non-gating streaming project: only when BLINDREV_STREAMING=1 (the CI streaming job sets it),
    // so a plain `pnpm e2e` runs the gating project alone.
    ...(process.env.BLINDREV_STREAMING === "1"
      ? [
          {
            name: "streaming",
            grep: /@streaming/,
            timeout: 180_000,
            use: {
              ...devices["Desktop Chrome"],
              viewport: { width: 1920, height: 1080 },
              deviceScaleFactor: 1,
              launchOptions: {
                args: [
                  "--use-angle=d3d11",
                  "--use-gl=angle",
                  "--ignore-gpu-blocklist",
                  "--enable-gpu",
                  "--enable-webgl",
                ],
              },
            },
          },
        ]
      : []),
  ],
  webServer: {
    command: rebuild ? `${build} && ${preview}` : preview,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: rebuild ? 600_000 : 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
