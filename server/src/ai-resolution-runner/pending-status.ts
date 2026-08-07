import { and, db, desc, eq, schema } from "src/db/client";

/**
 * One ADR 0026 pending audit row as the operator lens reports it: the
 * judgment's identity and verdict, its age, and the state of the job that
 * wrote it (null job fields when no job references the row).
 */
export type PendingRow = {
  ageMs: number;
  chainId: number;
  createdAt: Date;
  jobAttempts: string | null;
  jobLastError: string | null;
  jobStatus: string | null;
  marketId: string;
  provider: string;
  question: string | null;
  verdict: string;
};

/**
 * Every `market_resolutions` row the runner committed before proposing that
 * the indexer has not yet confirmed, newest first, joined to the job that
 * wrote it and the market's question. A short-lived row is the normal
 * in-flight state; a long-lived one is a proposal that never landed, a stalled
 * indexer, or a same-side external proposal whose event predated the row.
 * (An opposite-side event settles the row as `superseded` and pages, so
 * mismatches do not linger here — ADR 0026.)
 */
export async function collectPendingRows(now: Date): Promise<PendingRow[]> {
  const rows = await db
    .select({
      attemptCount: schema.marketResolutionJobs.attemptCount,
      chainId: schema.marketResolutions.chainId,
      createdAt: schema.marketResolutions.createdAt,
      jobStatus: schema.marketResolutionJobs.status,
      lastError: schema.marketResolutionJobs.lastError,
      marketId: schema.marketResolutions.marketId,
      maxAttempts: schema.marketResolutionJobs.maxAttempts,
      provider: schema.marketResolutions.provider,
      question: schema.marketMetadata.question,
      verdict: schema.marketResolutions.verdict,
    })
    .from(schema.marketResolutions)
    .leftJoin(
      schema.marketResolutionJobs,
      eq(schema.marketResolutionJobs.resolutionId, schema.marketResolutions.id),
    )
    .leftJoin(
      schema.marketMetadata,
      and(
        eq(schema.marketMetadata.chainId, schema.marketResolutions.chainId),
        eq(
          schema.marketMetadata.metadataHash,
          schema.marketResolutions.metadataHash,
        ),
      ),
    )
    .where(eq(schema.marketResolutions.commitState, "pending"))
    .orderBy(desc(schema.marketResolutions.createdAt));

  return rows.map((row) => ({
    ageMs: now.getTime() - row.createdAt.getTime(),
    chainId: row.chainId,
    createdAt: row.createdAt,
    jobAttempts:
      row.attemptCount === null
        ? null
        : `${row.attemptCount}/${row.maxAttempts}`,
    jobLastError: row.lastError,
    jobStatus: row.jobStatus,
    marketId: row.marketId.toString(),
    provider: row.provider,
    question: row.question,
    verdict: row.verdict,
  }));
}

/** Renders 93_784_000 as "1d 2h", 8_040_000 as "2h 14m", 42_000 as "42s". */
export function formatAge(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
