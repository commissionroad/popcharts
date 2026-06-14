import type { Config } from "drizzle-kit";

import { getDatabaseConnectionString } from "./src/config/database";

export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: getDatabaseConnectionString(),
  },
} satisfies Config;
