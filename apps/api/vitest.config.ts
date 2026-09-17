import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75
      }
    }
  }
});

