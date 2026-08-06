import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { useDispute } from "@/integrations/contracts/hooks/use-dispute";
import { useFinalize } from "@/integrations/contracts/hooks/use-finalize";
import { useMarketDisputeState } from "@/integrations/contracts/hooks/use-market-dispute-state";
import type { MarketDisputeSnapshot } from "@/integrations/contracts/market-dispute-state";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { marketFactory } from "@/test/factories/markets";

import { MarketDisputePanel } from "./market-dispute-panel";

vi.mock("@/integrations/contracts/hooks/use-dispute", () => ({ useDispute: vi.fn() }));
vi.mock("@/integrations/contracts/hooks/use-finalize", () => ({
  useFinalize: vi.fn(),
}));
vi.mock("@/integrations/contracts/hooks/use-market-dispute-state", () => ({
  useMarketDisputeState: vi.fn(),
}));
vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const RESOLVER = "0x4444444444444444444444444444444444444444" as const;
const MARKET_ADDRESS = "0x2222222222222222222222222222222222222222";
const NOW = 1_700_000_000_000;
const CHAIN = { id: 31337, name: "Hardhat Local" };
const dispute = vi.fn();
const finalize = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
  vi.mocked(useDispute).mockReturnValue({
    dispute,
    error: null,
    result: null,
    status: "idle",
    step: null,
  });
  vi.mocked(useFinalize).mockReturnValue({
    error: null,
    finalize,
    result: null,
    status: "idle",
    step: null,
  });
  vi.mocked(useMarketDisputeState).mockReturnValue({
    error: null,
    loading: false,
    snapshot: snapshotFixture(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MarketDisputePanel", () => {
  it("renders nothing when the market has no postgrad contract", () => {
    const { postgrad: _postgrad, ...withoutPostgrad } = graduatedMarket();

    const { container } = render(<MarketDisputePanel market={withoutPostgrad} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["no dispute window is open", false, snapshotFixture({ phase: "none" })],
    ["the on-chain read is still in flight", true, null],
  ])("renders nothing when %s", (_label, loading, snapshot) => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading,
      snapshot,
    });

    const { container } = render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("surfaces a failed on-chain read instead of silently rendering nothing", () => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: "Could not read this market's resolution status.",
      loading: false,
      snapshot: null,
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByText("Resolution status unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Could not read this market's resolution status.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A dispute window may be open on this market/)
    ).toBeInTheDocument();
  });

  it("re-reads the chain when a failed read is retried", () => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: "Network problem reaching the chain. Check your connection and try again.",
      loading: false,
      snapshot: null,
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(useMarketDisputeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ refreshKey: 1 })
    );
  });

  it("shows the proposed outcome, the countdown, and the forfeiture warning", () => {
    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByText("Resolution proposed")).toBeInTheDocument();
    // 1h 01m 05s from the fixture deadline.
    expect(screen.getByText("1h 01m 05s")).toBeInTheDocument();
    expect(
      screen.getByText(/the bond is forfeited to the protocol owner/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dispute with a $100.00 bond" })
    ).toBeEnabled();
  });

  it("states a non-round bond exactly instead of rounding what is pulled", () => {
    // 250.40 native USDC. formatUsd would render this "$250" — a button that
    // promises $250 while the market pulls $250.40.
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading: false,
      snapshot: snapshotFixture({ bond: 250_400_000n, collateralDecimals: 6 }),
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(
      screen.getByRole("button", { name: "Dispute with a $250.40 bond" })
    ).toBeEnabled();
    expect(screen.getByText("$250.40")).toBeInTheDocument();
  });

  it("never renders a sub-cent bond as $0.00, which would read as free", () => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading: false,
      snapshot: snapshotFixture({ bond: 1n, collateralDecimals: 6 }),
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(
      screen.getByRole("button", { name: "Dispute with a $0.000001 bond" })
    ).toBeEnabled();
  });

  it("blocks a viewer on the wrong chain and names the chain to switch to", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ activeChainId: 1 }));

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByRole("button", { name: /dispute/i })).toBeDisabled();
    expect(
      screen.getByText(
        "Switch your wallet to Hardhat Local to dispute this resolution."
      )
    ).toBeInTheDocument();
  });

  it("counts down once a second and offers settlement when the window closes", () => {
    const setInterval = vi.spyOn(window, "setInterval");
    render(<MarketDisputePanel market={graduatedMarket()} />);

    const tick = setInterval.mock.calls[0]?.[0] as () => void;
    vi.mocked(Date.now).mockReturnValue(NOW + 3_665_000);
    act(() => {
      tick();
    });

    expect(screen.getByText("Ready to settle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settle this market/i })).toBeEnabled();
    // Disputing is over, so the bonded action must not still be on offer.
    expect(screen.queryByRole("button", { name: /dispute/i })).not.toBeInTheDocument();
  });

  it("drops the hours segment inside the last hour of the window", () => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading: false,
      snapshot: snapshotFixture({ deadline: (NOW + 65_000) / 1_000 }),
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByText("1m 05s")).toBeInTheDocument();
  });

  it("posts the dispute against the market contract when clicked", () => {
    render(<MarketDisputePanel market={graduatedMarket()} />);

    fireEvent.click(screen.getByRole("button", { name: /dispute/i }));

    expect(dispute).toHaveBeenCalledWith(MARKET_ADDRESS);
  });

  it("tells the resolver their self-dispute posts no bond", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: RESOLVER }));

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByText(/your dispute posts no bond/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dispute (no bond)" })).toBeEnabled();
  });

  it("asks a disconnected viewer to connect before disputing", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ activeChainId: null, address: null })
    );

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByRole("button", { name: /dispute/i })).toBeDisabled();
    expect(
      screen.getByText("Connect a wallet to dispute this resolution.")
    ).toBeInTheDocument();
  });

  it.each([
    ["approving", "Approving bond…"],
    ["disputing", "Disputing…"],
  ] as const)("names the %s transaction while it is in flight", (step, label) => {
    vi.mocked(useDispute).mockReturnValue({
      dispute,
      error: null,
      result: null,
      status: "pending",
      step,
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByRole("button", { name: label })).toBeDisabled();
  });

  it("re-reads the on-chain state once a dispute confirms", () => {
    render(<MarketDisputePanel market={graduatedMarket()} />);

    act(() => {
      vi.mocked(useDispute).mock.calls[0]?.[0]?.onDisputed?.();
    });

    expect(useMarketDisputeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ refreshKey: 1 })
    );
  });

  it("shows the dispute error inline", () => {
    vi.mocked(useDispute).mockReturnValue({
      dispute,
      error: "The dispute window closed before this transaction landed.",
      result: null,
      status: "error",
      step: null,
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(
      screen.getByText("The dispute window closed before this transaction landed.")
    ).toBeInTheDocument();
  });

  it("tells the disputer their bond is at stake once the market is frozen", () => {
    disputedBy(ACCOUNT, 100n * 10n ** 18n);

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByText("Resolution disputed")).toBeInTheDocument();
    expect(
      screen.getByText(/You disputed the proposed YES outcome/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/bond is held by the market: refunded if the operator settles/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("names another account's dispute without claiming their bond", () => {
    disputedBy(RESOLVER, 100n * 10n ** 18n);

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(
      screen.getByText(/Someone disputed the proposed YES outcome/)
    ).toBeInTheDocument();
    expect(screen.getByText(/0x444\.\.\.444/)).toBeInTheDocument();
    expect(screen.queryByText(/bond is held by the market/)).not.toBeInTheDocument();
  });

  it("omits the bond line for the resolver's bond-free self-dispute", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: RESOLVER }));
    disputedBy(RESOLVER, 0n);

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(
      screen.getByText(/You disputed the proposed YES outcome/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/bond is held by the market/)).not.toBeInTheDocument();
  });

  it("falls back to a neutral label when the proposed side is unreadable", () => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading: false,
      snapshot: snapshotFixture({ phase: "disputed", proposedSide: null }),
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(
      screen.getByText(/Someone disputed the proposed an outcome outcome/)
    ).toBeInTheDocument();
  });
});

// The window has closed but the contract still says pending. The keeper finds
// pending markets through the indexed status, so the only way a person sees
// this state is that the keeper does not know the market is here — settling by
// hand is the recovery, and `finalizeResolution()` is permissionless so any
// viewer can do it.
describe("MarketDisputePanel settlement", () => {
  beforeEach(() => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading: false,
      snapshot: snapshotFixture({ deadline: (NOW - 1_000) / 1_000 }),
    });
  });

  it("says the outcome stands and costs nothing beyond the network fee", () => {
    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByText(/The dispute window has closed/)).toBeInTheDocument();
    expect(screen.getByText(/you pay only the network fee/)).toBeInTheDocument();
    // No bond warning: this action moves no collateral from the caller.
    expect(screen.queryByText(/Your money is at risk/)).not.toBeInTheDocument();
  });

  it("settles the market contract when clicked", () => {
    render(<MarketDisputePanel market={graduatedMarket()} />);

    fireEvent.click(screen.getByRole("button", { name: /settle this market/i }));

    expect(finalize).toHaveBeenCalledWith(MARKET_ADDRESS);
  });

  it.each([
    ["finalizing", "Settling…"],
    ["confirming", "Confirming…"],
  ] as const)("names the in-flight transaction while %s", (step, label) => {
    vi.mocked(useFinalize).mockReturnValue({
      error: null,
      finalize,
      result: null,
      status: "pending",
      step,
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByRole("button", { name: label })).toBeDisabled();
  });

  it("tells a disconnected viewer to connect before settling", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: null }));

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByRole("button", { name: /settle this market/i })).toBeDisabled();
    expect(
      screen.getByText("Connect a wallet to settle this market.")
    ).toBeInTheDocument();
  });

  it("tells a wrong-chain viewer which network to switch to", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ activeChainId: 1 }));

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByRole("button", { name: /settle this market/i })).toBeDisabled();
    expect(
      screen.getByText("Switch your wallet to Hardhat Local to settle this market.")
    ).toBeInTheDocument();
  });

  it("surfaces a failed settlement", () => {
    vi.mocked(useFinalize).mockReturnValue({
      error: "This market was settled before your transaction landed.",
      finalize,
      result: null,
      status: "error",
      step: null,
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(
      screen.getByText("This market was settled before your transaction landed.")
    ).toBeInTheDocument();
  });

  it("keeps confirming the settlement after the contract reads back as resolved", () => {
    vi.mocked(useFinalize).mockReturnValue({
      error: null,
      finalize,
      result: {
        transactionHash: `0x${"ef".repeat(32)}`,
        winningSide: "no",
      },
      status: "success",
      step: null,
    });
    // What the very next on-chain read reports once the market settles. Without
    // the success branch this blanks the panel out from under the person who
    // just signed for it.
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading: false,
      snapshot: snapshotFixture({ phase: "none" }),
    });

    render(<MarketDisputePanel market={graduatedMarket()} />);

    expect(screen.getByText("Market settled")).toBeInTheDocument();
    expect(screen.getByText(/You settled this market to/)).toBeInTheDocument();
    expect(screen.getByText(/Redemption opens here/)).toBeInTheDocument();
  });
});

function walletState(
  overrides: Partial<ReturnType<typeof useWalletAccount>> = {}
): ReturnType<typeof useWalletAccount> {
  return {
    activeChainId: CHAIN.id,
    address: ACCOUNT,
    defaultChain: CHAIN,
    ...overrides,
  } as ReturnType<typeof useWalletAccount>;
}

function disputedBy(disputer: `0x${string}`, bondHeld: bigint) {
  vi.mocked(useMarketDisputeState).mockReturnValue({
    error: null,
    loading: false,
    snapshot: snapshotFixture({ bondHeld, disputer, phase: "disputed" }),
  });
}

function snapshotFixture(
  overrides: Partial<MarketDisputeSnapshot> = {}
): MarketDisputeSnapshot {
  return {
    bond: 100n * 10n ** 18n,
    bondHeld: 0n,
    collateralDecimals: 18,
    // 1h 01m 05s after the frozen `now`.
    deadline: (NOW + 3_665_000) / 1_000,
    disputer: null,
    phase: "pending",
    proposedSide: "yes",
    resolver: RESOLVER,
    ...overrides,
  };
}

function graduatedMarket(): Market {
  return marketFactory({
    postgrad: {
      adapterAddress: "0x9999999999999999999999999999999999999999",
      completeSets: 1_000,
      finalizedAt: "2026-07-24T00:00:00.000Z",
      marketAddress: MARKET_ADDRESS,
      refundedUsd: 0,
      retainedUsd: 0,
    },
    status: "graduated",
  });
}
