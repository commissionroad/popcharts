import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PlacedPregradReceipt,
  ReceiptQuotePreview,
} from "@/domain/pregrad-trading/receipt-quote";
import { marketFactory } from "@/test/factories/markets";

import { ReceiptTicket } from "./receipt-ticket";

const useTicketState = vi.hoisted(() => vi.fn());

vi.mock("./use-receipt-ticket-state", () => ({
  presetAmounts: ["50", "250", "1000", "Max"] as const,
  useReceiptTicketState: useTicketState,
}));

beforeEach(() => {
  useTicketState.mockReset();
});

describe("ReceiptTicket", () => {
  it("presents the mock environment ticket", () => {
    stubState();

    render(<ReceiptTicket market={bootstrapMarket()} />);

    expect(screen.getByText("Place a receipt")).toBeInTheDocument();
    expect(screen.getByText("Fixture-backed trading preview.")).toBeInTheDocument();
    expect(screen.getByText("Mock")).toBeInTheDocument();
    expect(screen.queryByText("pUSD balance")).not.toBeInTheDocument();
    expect(screen.queryByText(/receipt book is locked/)).not.toBeInTheDocument();
  });

  it("presents the devchain ticket with the collateral balance panel", () => {
    stubState({ balanceUsd: 1_250, environment: { kind: "contract" } });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    expect(
      screen.getByText("Wallet-signed pre-graduation intent.")
    ).toBeInTheDocument();
    expect(screen.getByText("Devchain")).toBeInTheDocument();
    expect(screen.getByText("pUSD balance")).toBeInTheDocument();
    expect(screen.getByText("1,250 pUSD")).toBeInTheDocument();
  });

  it("routes amount edits and side changes to the state hook", () => {
    const state = stubState();

    render(<ReceiptTicket market={bootstrapMarket()} />);

    fireEvent.change(screen.getByLabelText(/Collateral budget/), {
      target: { value: "125" },
    });
    fireEvent.click(screen.getByRole("button", { name: "NO" }));

    expect(state.updateAmount).toHaveBeenCalledWith("125");
    expect(state.selectSide).toHaveBeenCalledWith("no");
  });

  it("selects preset amounts and highlights the active one", () => {
    const state = stubState({ amount: "250" });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    expect(screen.getByRole("button", { name: "250" })).toHaveClass(
      "border-[var(--pc-cyan)]"
    );
    expect(screen.getByRole("button", { name: "50" })).not.toHaveClass(
      "border-[var(--pc-cyan)]"
    );

    fireEvent.click(screen.getByRole("button", { name: "50" }));

    expect(state.selectPresetAmount).toHaveBeenCalledWith("50");
  });

  it("highlights the Max preset when the amount equals the derived max", () => {
    // With no balance the max preset derives from the 5,000 budget cap.
    stubState({ amount: "5000", balanceUsd: null });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    expect(screen.getByRole("button", { name: "Max" })).toHaveClass(
      "border-[var(--pc-cyan)]"
    );
  });

  it("mints test pUSD from the faucet", () => {
    const state = stubState({
      canMintTestPusd: true,
      environment: { kind: "contract" },
    });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    fireEvent.click(screen.getByRole("button", { name: /Mint test pUSD/ }));

    expect(state.mintTestPusd).toHaveBeenCalledTimes(1);
  });

  it("shows the amount validation error", () => {
    stubState({ amountFieldError: "Enter a collateral amount." });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    expect(screen.getByText("Enter a collateral amount.")).toBeInTheDocument();
  });

  it("warns when the market is missing from the local contract", () => {
    stubState({ contractMarketMissing: true });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    expect(
      screen.getByText(/not on the current local PregradManager/)
    ).toBeInTheDocument();
  });

  it("surfaces placement errors", () => {
    stubState({ submitError: "User rejected request." });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    expect(screen.getByText("User rejected request.")).toBeInTheDocument();
  });

  it("confirms a placed receipt", () => {
    stubState({ placedReceipt: receiptFixture() });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    expect(screen.getByText("Receipt placed")).toBeInTheDocument();
  });

  it("explains why a non-bootstrap receipt book is locked", () => {
    stubState({
      receiptAction: {
        disabled: true,
        label: "Receipt book locked",
        onClick: undefined,
      },
    });

    render(<ReceiptTicket market={marketFactory({ status: "graduated" })} />);

    expect(
      screen.getByText(/receipt book is locked because the market is\s+graduated\./)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Receipt book locked/ })).toBeDisabled();
  });

  it("shows the current placement step while placing", () => {
    stubState({
      isPlacing: true,
      placementStep: "approving",
      receiptAction: { disabled: true, label: "Placing receipt", onClick: undefined },
      side: "no",
    });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    expect(screen.getByText("Approving pUSD spend...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Placing receipt/ })).toBeDisabled();
  });

  it("places a receipt through the action's click handler", () => {
    const onClick = vi.fn();
    stubState({
      receiptAction: { disabled: false, label: "Place YES receipt", onClick },
    });

    render(<ReceiptTicket market={bootstrapMarket()} />);

    fireEvent.click(screen.getByRole("button", { name: /Place YES receipt/ }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

type TicketState = {
  amount: string;
  amountFieldError: string | null;
  balanceUsd: number | null;
  canMintTestPusd: boolean;
  contractMarketMissing: boolean;
  contractStatus: { error: string | null; loading: boolean };
  environment: { kind: "contract" | "mock" };
  isMinting: boolean;
  isPlacing: boolean;
  placedReceipt: PlacedPregradReceipt | null;
  placementStep: string | null;
  quote: ReceiptQuotePreview | null;
  receiptAction: {
    disabled: boolean;
    label: string;
    onClick: (() => void) | undefined;
  };
  side: "yes" | "no";
  submitError: string | null;
  walletConnected: boolean;
  mintTestPusd: ReturnType<typeof vi.fn>;
  selectPresetAmount: ReturnType<typeof vi.fn>;
  selectSide: ReturnType<typeof vi.fn>;
  updateAmount: ReturnType<typeof vi.fn>;
};

function bootstrapMarket() {
  return marketFactory({ status: "bootstrap" });
}

function stubState(overrides: Partial<TicketState> = {}): TicketState {
  const state: TicketState = {
    amount: "100",
    amountFieldError: null,
    balanceUsd: null,
    canMintTestPusd: false,
    contractMarketMissing: false,
    contractStatus: { error: null, loading: false },
    environment: { kind: "mock" },
    isMinting: false,
    isPlacing: false,
    placedReceipt: null,
    placementStep: null,
    quote: quoteFixture(),
    receiptAction: {
      disabled: false,
      label: "Place YES receipt",
      onClick: vi.fn(),
    },
    side: "yes",
    submitError: null,
    walletConnected: true,
    mintTestPusd: vi.fn(),
    selectPresetAmount: vi.fn(),
    selectSide: vi.fn(),
    updateAmount: vi.fn(),
    ...overrides,
  };

  useTicketState.mockReturnValue(state);

  return state;
}

function quoteFixture(): ReceiptQuotePreview {
  return {
    averagePriceCents: 52,
    budgetUsd: 100,
    maxCostUsd: 101.5,
    priceBand: { fromProbability: 50, toProbability: 54 },
    priceImpactCents: 4,
    shares: 192,
    side: "yes",
  };
}

function receiptFixture(): PlacedPregradReceipt {
  return {
    averagePriceCents: 52,
    collateralUsd: 100,
    createdAt: "2026-06-22T12:00:00.000Z",
    id: "receipt-1",
    marketId: "31337:9",
    marketQuestion: "Will it pop?",
    priceBand: { fromProbability: 50, toProbability: 54 },
    receiptId: "7",
    shares: 192,
    side: "yes",
    status: "waiting",
  };
}
