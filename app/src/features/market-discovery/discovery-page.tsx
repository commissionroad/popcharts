import { getMarkets } from "@/domain/markets/queries";
import { DiscoveryBoard } from "@/features/market-discovery/discovery-board";

export function DiscoveryPage() {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[var(--accent)] uppercase">
            Discover
          </p>
          <h1 className="font-display text-4xl font-black tracking-normal">
            Markets popping off
          </h1>
        </div>
      </div>
      <DiscoveryBoard markets={getMarkets()} />
    </div>
  );
}
