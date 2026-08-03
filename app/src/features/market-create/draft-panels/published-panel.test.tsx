import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { marketDraftFactory } from "@/test/factories/drafts";

import { PublishedPanel } from "./published-panel";

const TX_HASH = `0x${"dd".repeat(32)}`;

describe("PublishedPanel", () => {
  it("celebrates the live market with its id, transaction, and link", () => {
    render(
      panel({
        publishedChainId: 31337,
        publishedMarketId: "9",
        publishedTransactionHash: TX_HASH,
      })
    );

    expect(screen.getByText("Market live")).toBeInTheDocument();
    expect(screen.getByText("Fresh out of the oven")).toBeInTheDocument();
    expect(
      screen.getByText("Will bitcoin close above $100k on 2027-01-01?")
    ).toBeInTheDocument();
    expect(screen.getByText("Market id")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText(TX_HASH)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View market" })).toHaveAttribute(
      "href",
      "/markets/31337:9"
    );
    expect(
      screen.getByText(
        "It appears on the board as soon as the indexer catches the block"
      )
    ).toBeInTheDocument();
  });

  it("omits the id, transaction, and link when publish details are missing", () => {
    render(panel());

    expect(screen.queryByText("Market id")).not.toBeInTheDocument();
    expect(screen.queryByText("Transaction")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View market" })).not.toBeInTheDocument();
  });

  it("shows the market id without a link when the chain id is missing", () => {
    render(panel({ publishedMarketId: "9" }));

    expect(screen.getByText("Market id")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View market" })).not.toBeInTheDocument();
  });

  it("omits the market id row when only the chain id is known", () => {
    render(panel({ publishedChainId: 31337 }));

    expect(screen.queryByText("Market id")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View market" })).not.toBeInTheDocument();
  });

  it("saves the draft to the template shelf", () => {
    const onSaveTemplate = vi.fn();

    render(panel({}, { onSaveTemplate }));

    fireEvent.click(screen.getByRole("button", { name: /Save as template/ }));

    expect(onSaveTemplate).toHaveBeenCalledTimes(1);
  });

  it("disables the template action once the template is saved", () => {
    render(panel({}, { templateSaved: true }));

    expect(screen.getByRole("button", { name: /Template saved/ })).toBeDisabled();
  });

  it("starts a fresh draft", () => {
    const onStartFresh = vi.fn();

    render(panel({}, { onStartFresh }));

    fireEvent.click(screen.getByRole("button", { name: /Create another/ }));

    expect(onStartFresh).toHaveBeenCalledTimes(1);
  });
});

function panel(
  draftOverrides: Parameters<typeof marketDraftFactory>[0] = {},
  overrides: Partial<Parameters<typeof PublishedPanel>[0]> = {}
) {
  return (
    <PublishedPanel
      draft={marketDraftFactory({ status: "published", ...draftOverrides })}
      onSaveTemplate={vi.fn()}
      onStartFresh={vi.fn()}
      templateSaved={false}
      {...overrides}
    />
  );
}
