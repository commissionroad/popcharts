import { defineConfig, globalIgnores } from "eslint/config";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Boundary guard (docs/architecture.md): server-derived data enters the app
 * only through the indexer adapter, so generated-client value imports live in
 * src/integrations/indexer/ (and src/domain/markets/ mapping code). Type-only
 * model imports are fine anywhere — they erase at build time and keep feature
 * props honest.
 */
const apiClientImportPattern = {
  allowTypeImports: true,
  group: ["@popcharts/api-client", "@popcharts/api-client/*"],
  message:
    "Value-import the generated indexer client only inside src/integrations/indexer/ or src/domain/markets/; features consume the adapter. Type-only imports are allowed.",
};

/**
 * Protocol package guard: contract ABIs and constants enter through the
 * src/integrations/contracts/ shims. The deliberate exception is pure
 * price-policy/tick-math imports in src/domain/postgrad-trading/.
 */
const protocolImportPattern = {
  group: ["@popcharts/protocol", "@popcharts/protocol/*"],
  message:
    "Import @popcharts/protocol only through the src/integrations/contracts/ shims (pure price-policy/tick-math in src/domain/postgrad-trading/ excepted).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/exports": "warn",
      "simple-import-sort/imports": "warn",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [apiClientImportPattern, protocolImportPattern] },
      ],
    },
  },
  {
    // The indexer adapter (and domain market mapping) may value-import the
    // generated client; the protocol restriction still applies.
    files: [
      "src/integrations/indexer/**/*.{ts,tsx}",
      "src/domain/markets/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [protocolImportPattern] },
      ],
    },
  },
  {
    // Contract shims (and blessed pure math in postgrad trading) may import
    // the protocol package; the generated-client restriction still applies.
    files: [
      "src/integrations/contracts/**/*.{ts,tsx}",
      "src/domain/postgrad-trading/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [apiClientImportPattern] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "storybook-static/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
