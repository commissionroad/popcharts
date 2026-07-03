import { defineConfig } from "orval";

export default defineConfig({
  popchartsApi: {
    input: {
      // Default to the committed spec exported by `bun run openapi:generate`
      // in server/, so client generation is deterministic and does not need a
      // running API. Override with POPCHARTS_API_SPEC to point at a live one.
      target: process.env.POPCHARTS_API_SPEC ?? "../server/generated/openapi.json",
    },
    output: {
      client: "fetch",
      mode: "tags-split",
      prettier: true,
      schemas: "./src/integrations/indexer/generated/models",
      target: "./src/integrations/indexer/generated",
    },
  },
});
