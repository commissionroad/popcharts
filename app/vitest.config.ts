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
        // Storybook stories are fixture/demo surfaces; behavior is covered by
        // the component tests and browser Storybook verification.
        "src/**/*.stories.{ts,tsx}",
        "src/tests/**",
        "src/test/**",
        "src/**/fixtures.ts",
        "src/**/generated/**",
        // Type-only modules and the protocol ABI re-export shim: no
        // executable statements to cover.
        "src/domain/market-creation/types.ts",
        "src/domain/receipts/types.ts",
        "src/integrations/contracts/pregrad-manager.ts",
        // Server-component page shells and layout chrome are exercised by the
        // Playwright smoke e2e, not unit tests. API route handlers under
        // src/app/api/** intentionally stay in the coverage denominator.
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/app/loading.tsx",
        "src/app/not-found.tsx",
        "src/app/error.tsx",
        "src/app/global-error.tsx",
        // Third-party provider wiring (Privy/wagmi); no meaningful unit seam.
        "src/integrations/wallet/wallet-provider.tsx",
        "src/integrations/wallet/privy-wallet-provider.tsx",
        "src/integrations/wallet/local-wallet-provider.tsx",
        "src/integrations/wallet/wallet-config.ts",
      ],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      // Ratchet: the suite reached 100% lines (PR #136). The sub-100 floors
      // allow only the documented dead defensive branches (see
      // skills/engineering/frontend-testing). Raise these if coverage rises;
      // never lower them to make a PR pass.
      thresholds: {
        branches: 99.7,
        functions: 99.2,
        lines: 100,
        statements: 99.7,
      },
    },
  },
});
