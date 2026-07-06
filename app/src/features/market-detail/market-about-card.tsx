import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import type { Market } from "@/domain/markets/types";
import { formatAddress, formatDateTime } from "@/lib/format";

export function MarketAboutCard({ market }: { market: Market }) {
  const sources = resolutionSourceUrls(market);

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="mb-3 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
        About this market
      </div>
      <p className="max-w-2xl text-[13px] leading-6 text-[var(--text-secondary)]">
        {market.description}
      </p>

      {market.resolutionCriteria ? (
        <div className="mt-5 border-t border-[var(--border-soft)] pt-5">
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Resolution criteria
          </div>
          <p className="max-w-2xl text-[13px] leading-6 text-[var(--text-secondary)]">
            {market.resolutionCriteria}
          </p>
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="mt-5 border-t border-[var(--border-soft)] pt-5">
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Resolution sources
          </div>
          <ul className="flex flex-col gap-1.5">
            {sources.map((source) => (
              <li key={source}>
                <a
                  className="inline-flex items-center gap-1.5 font-mono text-[12px] break-all text-[var(--pc-cyan)] transition-opacity hover:opacity-70"
                  href={source}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {sourceLabel(source)}
                  <ExternalLink className="shrink-0" size={12} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 border-t border-[var(--border-soft)] pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem label="Closes" value={formatDateTime(market.closesAt)} />
        {market.createdAt ? (
          <DetailItem label="Created" value={formatDateTime(market.createdAt)} />
        ) : null}
        {market.creator ? (
          <DetailItem
            label="Creator"
            value={<span title={market.creator}>{formatAddress(market.creator)}</span>}
          />
        ) : null}
        {market.metadataHash ? (
          <DetailItem
            label="Metadata hash"
            value={
              <span title={market.metadataHash}>
                {formatAddress(market.metadataHash)}
              </span>
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
        {label}
      </div>
      <div className="mt-1 font-mono text-[13px] text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function resolutionSourceUrls(market: Market) {
  const urls = [market.resolutionUrl, ...(market.resolutionSources ?? [])];

  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

function sourceLabel(url: string) {
  try {
    const parsed = new URL(url);

    return parsed.hostname + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return url;
  }
}
