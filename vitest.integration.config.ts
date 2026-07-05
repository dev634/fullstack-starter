import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Separate from vitest.config.ts on purpose: these tests hit a real
// Postgres via DATABASE_URL (no mocks), so they only run where one is
// available (CI's postgres service, or a local `docker compose up -d db`).
// `npm test` (unit tests, all mocked) never needs a live database.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests-integration/**/*.test.ts"],
    // Integration tests share one DB; running files in parallel workers
    // would race on the same rows.
    fileParallelism: false,
  },
});
