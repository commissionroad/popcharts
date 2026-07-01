import postgres from "postgres";

import {
  getDatabaseConnectionString,
  requiresDatabaseSsl,
} from "src/config/database";

const connectionString = getDatabaseConnectionString();
const sql = postgres(connectionString, {
  ssl: requiresDatabaseSsl(connectionString) ? "require" : false,
});

const UNIQUE_INDEX_REPAIRS = [
  {
    columns: ["address", "chain_id"],
    constraint: "contracts_address_chain_idx",
    table: "contracts",
  },
  {
    columns: ["chain_id", "metadata_hash"],
    constraint: "market_metadata_chain_hash_idx",
    table: "market_metadata",
  },
  {
    columns: ["chain_id", "market_id"],
    constraint: "markets_chain_market_idx",
    table: "markets",
  },
  {
    columns: ["chain_id", "market_id", "metadata_hash"],
    constraint: "markets_chain_market_hash_idx",
    table: "markets",
  },
  {
    columns: ["created_transaction_hash", "created_log_index"],
    constraint: "markets_created_tx_log_idx",
    table: "markets",
  },
] as const;

async function main() {
  for (const repair of UNIQUE_INDEX_REPAIRS) {
    await convertIndexToConstraint(repair);
  }
}

async function convertIndexToConstraint({
  columns,
  constraint,
  table,
}: {
  columns: readonly string[];
  constraint: string;
  table: string;
}) {
  const columnList = columns.map((column) => `"${column}"`).join(", ");

  await sql.unsafe(`
    do $$
    begin
      if to_regclass('public.${table}') is not null
        and not exists (
          select 1
          from pg_constraint
          where conname = '${constraint}'
            and conrelid = to_regclass('public.${table}')
        )
      then
        if to_regclass('public.${constraint}') is not null then
          execute 'alter table public.${table} add constraint ${constraint} unique using index ${constraint}';
        else
          execute 'alter table public.${table} add constraint ${constraint} unique (${columnList})';
        end if;
      end if;
    end $$;
  `);
}

if (import.meta.main) {
  main()
    .catch((error) => {
      console.error("[local schema] failed to ensure unique constraints", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await sql.end({ timeout: 5 });
    });
}
