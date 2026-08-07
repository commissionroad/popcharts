import type { ResolutionFinalizeRefusedStatus } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarketSettleAction } from "./market-settle-action";
import type { SettleMarketActionResult } from "./resolution-actions";

const onSettle = vi.fn();

function renderAction({
  outcome = null,
  pending = false,
}: {
  outcome?: SettleMarketActionResult | null;
  pending?: boolean;
} = {}) {
  return render(
    <MarketSettleAction
      onSettle={onSettle}
      outcome={outcome}
      pending={pending}
      proposedLabel="YES"
    />
  );
}

describe("MarketSettleAction", () => {
  it("names the outcome that stands and offers the press", () => {
    renderAction();

    expect(screen.getByText("Ready to settle")).toBeInTheDocument();
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settle this market/i })).toBeEnabled();
  });

  it("promises no cost, because the caller pays nothing at all", () => {
    renderAction();

    expect(screen.getByText(/settling costs you nothing/)).toBeInTheDocument();
    // The server signs the permissionless call, so there is no gas to quote —
    // an earlier wallet-signed attempt was rejected for exactly this friction.
    expect(screen.queryByText(/network fee/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connect a wallet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/switch your wallet/i)).not.toBeInTheDocument();
    // No bond warning: this action moves no collateral from the caller.
    expect(screen.queryByText(/your money is at risk/i)).not.toBeInTheDocument();
  });

  it("settles when pressed", () => {
    renderAction();

    fireEvent.click(screen.getByRole("button", { name: /settle this market/i }));

    expect(onSettle).toHaveBeenCalledOnce();
  });

  it("names the in-flight request and blocks a second press", () => {
    renderAction({ pending: true });

    expect(screen.getByRole("button", { name: "Settling…" })).toBeDisabled();
  });

  it("confirms the settlement without inventing the winning side", () => {
    renderAction({ outcome: { status: "settled" } });

    expect(screen.getByText("Market settled")).toBeInTheDocument();
    expect(
      screen.getByText(/You settled this market to its proposed outcome/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Redemption opens here/)).toBeInTheDocument();
    // The endpoint reports that it settled, not what it settled to, so the
    // panel must not name a side it never observed.
    expect(screen.queryByText("YES")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    ["already_resolved", "Already settled", /the keeper or another viewer got there/],
    ["disputed", "Resolution disputed", /An operator settles a disputed market/],
    ["no_pending_proposal", "Nothing to settle", /no proposed resolution to settle/],
    ["not_graduated", "Nothing to settle", /has not graduated/],
    ["window_open", "Window still open", /Try again once it closes/],
  ] as [ResolutionFinalizeRefusedStatus, string, RegExp][])(
    "reads a %s refusal as ordinary operation, not an error",
    (reason, title, message) => {
      renderAction({ outcome: { reason, status: "refused" } });

      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      // A refusal is an answer. Re-offering the press would invite a loop.
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    }
  );

  it("falls back to plain copy for a refusal kind this build does not know", () => {
    renderAction({
      outcome: {
        reason: "recount_pending" as ResolutionFinalizeRefusedStatus,
        status: "refused",
      },
    });

    expect(screen.getByText("Nothing to settle")).toBeInTheDocument();
    expect(
      screen.getByText("This market cannot be settled right now.")
    ).toBeInTheDocument();
  });

  it("shows a failure beside the button so the press can be retried", () => {
    renderAction({
      outcome: { message: "Could not settle this market.", status: "error" },
    });

    expect(screen.getByText("Could not settle this market.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settle this market/i })).toBeEnabled();
  });
});
