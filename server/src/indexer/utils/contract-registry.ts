import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

const contractIdCache = new Map<string, number>();

export async function getOrCreateContractId(address: string, name: string) {
  const normalizedAddress = address.toLowerCase();
  const cacheKey = `${config.chainId}:${normalizedAddress}`;
  const cached = contractIdCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const existing = await db.query.contracts.findFirst({
    where: and(
      eq(schema.contracts.address, normalizedAddress),
      eq(schema.contracts.chainId, config.chainId),
    ),
  });

  if (existing) {
    contractIdCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const [inserted] = await db
    .insert(schema.contracts)
    .values({
      address: normalizedAddress,
      chainId: config.chainId,
      name,
    })
    .onConflictDoNothing()
    .returning({ id: schema.contracts.id });

  if (inserted) {
    contractIdCache.set(cacheKey, inserted.id);
    return inserted.id;
  }

  const afterRace = await db.query.contracts.findFirst({
    where: and(
      eq(schema.contracts.address, normalizedAddress),
      eq(schema.contracts.chainId, config.chainId),
    ),
  });

  if (!afterRace) {
    throw new Error(`Failed to create contract registry row for ${address}`);
  }

  contractIdCache.set(cacheKey, afterRace.id);
  return afterRace.id;
}
