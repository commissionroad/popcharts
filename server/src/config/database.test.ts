import { describe, expect, test } from "bun:test";

import {
  getDatabaseConnectionString,
  requiresDatabaseSsl,
} from "./database";

describe("getDatabaseConnectionString", () => {
  test("uses DATABASE_URL when present", () => {
    expect(
      getDatabaseConnectionString({
        DATABASE_HOST: "ignored.example.com",
        DATABASE_PASSWORD: "ignored",
        DATABASE_URL: "postgresql://user:pass@example.com:5432/app",
      }),
    ).toBe("postgresql://user:pass@example.com:5432/app");
  });

  test("falls back to the local docker-compose database", () => {
    expect(getDatabaseConnectionString({})).toBe(
      "postgresql://postgres:postgres@localhost:5433/popcharts",
    );
  });

  test("builds an RDS-style URL from component environment variables", () => {
    expect(
      getDatabaseConnectionString({
        DATABASE_HOST: "popcharts.cluster-abc123.us-east-1.rds.amazonaws.com",
        DATABASE_NAME: "popcharts",
        DATABASE_PASSWORD: "secret",
        DATABASE_PORT: "5432",
        DATABASE_USER: "popcharts",
      }),
    ).toBe(
      "postgresql://popcharts:secret@popcharts.cluster-abc123.us-east-1.rds.amazonaws.com:5432/popcharts?sslmode=require",
    );
  });

  test("requires a password when DATABASE_HOST is configured", () => {
    expect(() =>
      getDatabaseConnectionString({
        DATABASE_HOST: "popcharts.cluster-abc123.us-east-1.rds.amazonaws.com",
      }),
    ).toThrow("DATABASE_PASSWORD is required");
  });
});

describe("requiresDatabaseSsl", () => {
  test("requires SSL for RDS hosts, explicit sslmode, or DATABASE_SSL=true", () => {
    expect(
      requiresDatabaseSsl(
        "postgresql://user:pass@popcharts.us-east-1.rds.amazonaws.com:5432/app",
        {},
      ),
    ).toBe(true);
    expect(
      requiresDatabaseSsl(
        "postgresql://user:pass@example.com:5432/app?sslmode=require",
        {},
      ),
    ).toBe(true);
    expect(
      requiresDatabaseSsl("postgresql://user:pass@example.com:5432/app", {
        DATABASE_SSL: "true",
      }),
    ).toBe(true);
  });
});
