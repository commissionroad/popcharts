import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/tests/**",
        "src/test/**",
        "src/**/fixtures.ts",
        "src/**/generated/**",
      ],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
