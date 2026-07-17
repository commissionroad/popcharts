import { BASE_DATABASE_NAME } from "./ports.ts";

/**
 * Rejects database names outside ADR 0020's derived `popcharts[_slot]` shape
 * before they are interpolated into local administrative SQL.
 */
export function assertLocalStackDatabaseName(dbName: string): void {
  const slotSuffix = dbName.slice(BASE_DATABASE_NAME.length + 1);
  const isDerivedName =
    dbName === BASE_DATABASE_NAME ||
    (dbName.startsWith(`${BASE_DATABASE_NAME}_`) &&
      /^[0-9]+$/.test(slotSuffix));
  if (!isDerivedName) {
    throw new Error(`Invalid local stack database name: ${dbName}`);
  }
}
