# Pop Charts App

Production frontend for Pop Charts. This package uses Next.js App Router,
TypeScript, Tailwind CSS v4, and the Pop Charts design system.

## Commands

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:e2e:smoke
pnpm build
```

## Product Shape

Pop Charts starts where a Polymarket-style venue cannot: before a market has
real liquidity. Users can browse markets, launch new binary markets, place
pre-graduation receipts on a virtual LMSR curve, watch matched liquidity build
toward graduation, and inspect which price bands clear into backed YES/NO
complete sets.

After graduation, the mental model becomes familiar: fixed-payout YES/NO
outcome tokens, market pages, trading panels, positions, and resolution. Before
graduation, the app must be more explicit than a normal prediction market:
receipts are priced intents, fills are partial and not guaranteed, unmatched
segments refund at exact path cost, and graduation is the bridge into standard
market infrastructure.

## Structure

```txt
src/app/          Next.js routes and route-local states
src/components/   shared UI, layout, and chart components
src/design-system Pop Charts tokens and global styling
src/domain/       pure TypeScript market, LMSR, receipt, clearing logic
src/features/     product flows and feature-specific UI
src/integrations/ wallet, contracts, indexer, analytics boundaries
src/lib/          small app-level helpers
src/tests/e2e/    Playwright browser flows
```

Read `CONTEXT.md` before naming domain types or user-facing states.
