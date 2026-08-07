import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDispute } from "@/integrations/contracts/hooks/use-dispute";
import type { MarketDisputeSnapshot } from "@/integrations/contracts/market-dispute-state";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { marketFactory } from "@/test/factories/markets";

import { MarketDisputeAction } from "./market-dispute-action";

vi.mock("@/integrations/contracts/hooks/use-dispute", () => ({ useDispute: vi.fn() }));
vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const RESOLVER = "0x4444444444444444444444444444444444444444" as const;
const MARKET_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
// 1h 01m 05s, the countdown the open-window copy renders.
const REMAINING_MS = 3_665_000;
const CHAIN = { id: 31337, name: "Hardhat Local" };
const dispute = vi.fn();
const onDisputed = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
  vi.mocked(useDispute).mockReturnValue({
    dispute,
    error: null,
    result: null,
    status: "idle",
    step: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderAction({
  remainingMs = REMAINING_MS,
  snapshot = snapshotFixture(),
}: { remainingMs?: number; snapshot?: MarketDisputeSnapshot } = {}) {
  return render(
    <MarketDisputeAction
      market={marketFactory()}
      marketAddress={MARKET_ADDRESS}
      onDisputed={onDisputed}
      remainingMs={remainingMs}
      snapshot={snapshot}
    />
  );
}

describe("MarketDisputeAction", () => {
  it("shows the proposed outcome, the countdown, and the forfeiture warning", () => {
    renderAction();

    expect(screen.getByText("Resolution proposed")).toBeInTheDocument();
    expect(screen.getByText("1h 01m 05s")).toBeInTheDocument();
    expect(
      screen.getByText(/the bond is forfeited to the protocol owner/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dispute with a $100.00 bond" })
    ).toBeEnabled();
  });

  it("drops the hours segment inside the last hour of the window", () => {
    renderAction({ remainingMs: 65_000 });

    expect(screen.getByText("1m 05s")).toBeInTheDocument();
  });

  it("states a non-round bond exactly instead of rounding what is pulled", () => {
    // 250.40 native USDC. formatUsd would render this "$250" — a button that
    // promises $250 while the market pulls $250.40.
    renderAction({
      snapshot: snapshotFixture({ bond: 250_400_000n, collateralDecimals: 6 }),
    });

    expect(
      screen.getByRole("button", { name: "Dispute with a $250.40 bond" })
    ).toBeEnabled();
    expect(screen.getByText("$250.40")).toBeInTheDocument();
  });

  it("never renders a sub-cent bond as $0.00, which would read as free", () => {
    renderAction({ snapshot: snapshotFixture({ bond: 1n, collateralDecimals: 6 }) });

    expect(
      screen.getByRole("button", { name: "Dispute with a $0.000001 bond" })
    ).toBeEnabled();
  });

  it("blocks a viewer on the wrong chain and names the chain to switch to", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ activeChainId: 1 }));

    renderAction();

    expect(screen.getByRole("button", { name: /dispute/i })).toBeDisabled();
    expect(
      screen.getByText(
        "Switch your wallet to Hardhat Local to dispute this resolution."
      )
    ).toBeInTheDocument();
  });

  it("asks a disconnected viewer to connect before disputing", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ activeChainId: null, address: null })
    );

    renderAction();

    expect(screen.getByRole("button", { name: /dispute/i })).toBeDisabled();
    expect(
      screen.getByText("Connect a wallet to dispute this resolution.")
    ).toBeInTheDocument();
  });

  it("posts the dispute against the market contract when clicked", () => {
    renderAction();

    fireEvent.click(screen.getByRole("button", { name: /dispute/i }));

    expect(dispute).toHaveBeenCalledWith(MARKET_ADDRESS);
  });

  it("tells the resolver their self-dispute posts no bond", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: RESOLVER }));

    renderAction();

    expect(screen.getByText(/your dispute posts no bond/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dispute (no bond)" })).toBeEnabled();
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

    renderAction();

    expect(screen.getByRole("button", { name: label })).toBeDisabled();
  });

  it("asks the panel to re-read the chain once a dispute confirms", () => {
    renderAction();

    act(() => {
      vi.mocked(useDispute).mock.calls[0]?.[0]?.onDisputed?.();
    });

    expect(onDisputed).toHaveBeenCalledOnce();
  });

  it("shows the dispute error inline", () => {
    vi.mocked(useDispute).mockReturnValue({
      dispute,
      error: "The dispute window closed before this transaction landed.",
      result: null,
      status: "error",
      step: null,
    });

    renderAction();

    expect(
      screen.getByText("The dispute window closed before this transaction landed.")
    ).toBeInTheDocument();
  });

  it("tells the disputer their bond is at stake once the market is frozen", () => {
    renderAction({ snapshot: disputedBy(ACCOUNT, 100n * 10n ** 18n) });

    expect(screen.getByText("Resolution disputed")).toBeInTheDocument();
    expect(
      screen.getByText(/You disputed the proposed YES outcome/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/bond is held by the market: refunded if the operator settles/)
    ).toBeInTheDocument();
    // A disputed market is settled by an operator, so no public action remains.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("names another account's dispute without claiming their bond", () => {
    renderAction({ snapshot: disputedBy(RESOLVER, 100n * 10n ** 18n) });

    expect(
      screen.getByText(/Someone disputed the proposed YES outcome/)
    ).toBeInTheDocument();
    expect(screen.getByText(/0x444\.\.\.444/)).toBeInTheDocument();
    expect(screen.queryByText(/bond is held by the market/)).not.toBeInTheDocument();
  });

  it("omits the bond line for the resolver's bond-free self-dispute", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: RESOLVER }));

    renderAction({ snapshot: disputedBy(RESOLVER, 0n) });

    expect(
      screen.getByText(/You disputed the proposed YES outcome/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/bond is held by the market/)).not.toBeInTheDocument();
  });

  it("falls back to a neutral label when the proposed side is unreadable", () => {
    renderAction({
      snapshot: snapshotFixture({ phase: "disputed", proposedSide: null }),
    });

    expect(
      screen.getByText(/Someone disputed the proposed an outcome outcome/)
    ).toBeInTheDocument();
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
  return snapshotFixture({ bondHeld, disputer, phase: "disputed" });
}

function snapshotFixture(
  overrides: Partial<MarketDisputeSnapshot> = {}
): MarketDisputeSnapshot {
  return {
    bond: 100n * 10n ** 18n,
    bondHeld: 0n,
    collateralDecimals: 18,
    deadline: 1_700_003_665,
    disputer: null,
    phase: "pending",
    proposedSide: "yes",
    resolver: RESOLVER,
    ...overrides,
  };
}
