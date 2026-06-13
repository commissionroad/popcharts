import { CreateMarketForm } from "@/features/market-create/create-market-form";

export function CreateMarketPage({ initialNow }: { initialNow: string }) {
  return (
    <div>
      <div className="mb-7">
        <p className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[var(--accent)] uppercase">
          Launchpad
        </p>
        <h1 className="font-display text-4xl font-black tracking-normal">
          Bake a market
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-[var(--text-secondary)]">
          No startup liquidity. It prices on a virtual curve from the first receipt and
          graduates when real opposing demand shows up.
        </p>
      </div>
      <CreateMarketForm initialNow={initialNow} />
    </div>
  );
}
