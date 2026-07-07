import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  buildCreateMarketPreview,
  createInitialMarketDraft,
} from "@/domain/market-creation/create-market";
import type { CreatedMarket } from "@/domain/market-creation/types";

import { SuccessPanel } from "./success-panel";

const TX_HASH = `0x${"cc".repeat(32)}` as const;
const CREATOR = "0x1111111111111111111111111111111111111111" as const;

describe("SuccessPanel", () => {
  it("presents a wallet-signed devchain market with a view link", () => {
    render(
      panel(
        createdMarketFixture({
          chainId: 31337,
          creationSigner: "wallet",
          creator: CREATOR,
          transactionHash: TX_HASH,
        })
      )
    );

    expect(screen.getByText("Wallet-signed")).toBeInTheDocument();
    expect(screen.getByText("Market under review")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText(TX_HASH)).toBeInTheDocument();
    expect(screen.getByText(CREATOR)).toBeInTheDocument();
    expect(screen.getByText("$2,500 matched market cap")).toBeInTheDocument();
    expect(screen.getByText("Assisted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View market" })).toHaveAttribute(
      "href",
      "/markets/31337%3A9"
    );
  });

  it("labels server-relayed devchain markets", () => {
    render(panel(createdMarketFixture({ chainId: 31337, creationSigner: "server" })));

    expect(screen.getByText("Devchain relay")).toBeInTheDocument();
  });

  it("disables the view link for a devchain market without a chain id", () => {
    render(panel(createdMarketFixture()));

    expect(screen.queryByRole("link", { name: "View market" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View market" })).toBeDisabled();
  });

  it("presents a mock market draft without transaction details", () => {
    const market = createdMarketFixture({
      creationMode: "mock",
      marketId: "draft-abc123",
    });
    delete market.creationSigner;

    render(panel(market));

    expect(screen.getByText("Mock created")).toBeInTheDocument();
    expect(screen.getByText("Market draft ready")).toBeInTheDocument();
    expect(screen.getByText("draft-abc123")).toBeInTheDocument();
    expect(screen.queryByText("Transaction")).not.toBeInTheDocument();
    expect(screen.queryByText("Creator")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View market" })).toBeDisabled();
  });

  it("marks bypassed AI resolution", () => {
    const market = createdMarketFixture();
    market.protocolParams = {
      ...market.protocolParams,
      bypassAiResolution: true,
    };

    render(panel(market));

    expect(screen.getByText("Bypassed")).toBeInTheDocument();
  });

  it("warns when the market's metadata failed to sync", () => {
    render(
      panel(createdMarketFixture({ metadataSyncError: "Indexer API is offline." }))
    );

    expect(
      screen.getByText(/did not sync to the API:\s*Indexer API is offline\./)
    ).toBeInTheDocument();
  });

  it("resets the form from the create-another action", () => {
    const onReset = vi.fn();

    render(panel(createdMarketFixture(), onReset));

    fireEvent.click(screen.getByRole("button", { name: /Create another/ }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

function createdMarketFixture(overrides: Partial<CreatedMarket> = {}): CreatedMarket {
  const draft = {
    ...createInitialMarketDraft(new Date("2030-07-01T12:00:00.000Z")),
    question: "Will it pop?",
    resolutionCriteria: "Resolves YES if it pops.",
  };

  return {
    ...buildCreateMarketPreview(draft),
    creationMode: "devchain",
    creationSigner: "wallet",
    marketId: "9",
    ...overrides,
  };
}

function panel(result: CreatedMarket, onReset = vi.fn()) {
  return <SuccessPanel onReset={onReset} result={result} />;
}
