import { getMarkets, usesFixtureMarkets } from "@/domain/markets/queries";
import { DiscoveryBoard } from "@/features/market-discovery/discovery-board";
import { DiscoveryLiveRefresh } from "@/features/market-discovery/discovery-live-refresh";

export async function DiscoveryPage() {
  const markets = await getMarkets();
  const sampleData = usesFixtureMarkets();

  return (
    <div>
      {/* Lifecycle transitions and new markets land for every viewer, not just
          the actor who caused them. Card prices/bars still settle on reload —
          bets do not route to this channel (see the island). */}
      <DiscoveryLiveRefresh />
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
      {sampleData ? (
        <p
          role="note"
          className="mb-6 rounded-md border border-[var(--border)] px-4 py-3 font-mono text-[11px] tracking-[0.1em] text-[var(--text-secondary)] uppercase"
        >
          Sample data — these markets are illustrative, not live trading.
        </p>
      ) : null}
      <DiscoveryBoard markets={markets} />
    </div>
  );
}
