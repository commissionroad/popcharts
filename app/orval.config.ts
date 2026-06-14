import { defineConfig } from "orval";

export default defineConfig({
  popchartsApi: {
    input: {
      target: process.env.POPCHARTS_API_SPEC ?? "http://localhost:3001/openapi/json",
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
