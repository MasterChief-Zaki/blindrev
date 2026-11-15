import { defineConfig } from "vitest/config";

// Two separately reported projects (spec §8): `correctness` (gating) and `parity` (vs Cesium).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "correctness",
          include: ["test/correctness/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "parity",
          include: ["test/parity/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
        },
      },
    ],
  },
});
