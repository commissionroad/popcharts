import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WalletCreateAction } from "@/features/market-create/wallet-create-action";
import { marketDraftFactory } from "@/test/factories/drafts";

import { ApprovedPanel, formatWindow } from "./approved-panel";

describe("formatWindow", () => {
  it.each([
    [0, "under a minute"],
    [59, "under a minute"],
    [60, "1m"],
    [60 * 60, "1h"],
    [90 * 60, "1h 30m"],
    [24 * 60 * 60, "1d"],
    [24 * 60 * 60 + 60, "1d 1m"],
    [2 * 24 * 60 * 60 + 3 * 60 * 60 + 30 * 60, "2d 3h"],
  ])("renders %d seconds as %s", (seconds, expected) => {
    expect(formatWindow(seconds)).toBe(expected);
  });
});

describe("ApprovedPanel", () => {
  it("summarizes the approved draft with publish-relative windows", () => {
    render(panel());

    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Ready to go live whenever you are")).toBeInTheDocument();
    expect(
      screen.getByText("Will bitcoin close above $100k on 2027-01-01?")
    ).toBeInTheDocument();
    expect(screen.getByText("Graduation window")).toBeInTheDocument();
    expect(screen.getByText("6h")).toBeInTheDocument();
    expect(screen.getByText("Resolution window")).toBeInTheDocument();
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("$2,500 matched")).toBeInTheDocument();
    expect(screen.getByText("Waived in preview")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Windows start counting at publish. Editing the draft instead sends it back through review."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish & pay/ })).toBeEnabled();
    expect(
      screen.getByText("Pays the creation fee and signs createMarket")
    ).toBeInTheDocument();
  });

  it("keeps the publish label when the wallet action is ready", () => {
    render(panel({ walletAction: walletAction() }));

    expect(screen.getByRole("button", { name: /Publish & pay/ })).toBeEnabled();
  });

  it("adopts an actionable blocking wallet step with its guidance", () => {
    render(
      panel({
        walletAction: walletAction({
          kind: "connect",
          label: "Connect wallet",
          message: "Connect a wallet to sign the market creation transaction.",
        }),
      })
    );

    expect(screen.getByRole("button", { name: /Connect wallet/ })).toBeEnabled();
    expect(
      screen.getByText("Connect a wallet to sign the market creation transaction.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Pays the creation fee and signs createMarket")
    ).not.toBeInTheDocument();
  });

  it("disables the button for a blocked step that cannot be acted on", () => {
    render(
      panel({
        walletAction: walletAction({
          disabled: true,
          kind: "waiting",
          label: "Preparing wallet",
          message: "Wallet state is still loading.",
        }),
      })
    );

    expect(screen.getByRole("button", { name: /Preparing wallet/ })).toBeDisabled();
    expect(screen.getByText("Wallet state is still loading.")).toBeInTheDocument();
  });

  it("falls back to the default footer when the blocking step has no message", () => {
    render(
      panel({
        walletAction: walletAction({
          kind: "connect",
          label: "Connect wallet",
          message: null,
        }),
      })
    );

    expect(
      screen.getByText("Pays the creation fee and signs createMarket")
    ).toBeInTheDocument();
  });

  it("labels and disables publishing while it is in flight", () => {
    render(panel({ isPublishing: true }));

    expect(screen.getByRole("button", { name: /Publishing…/ })).toBeDisabled();
  });

  it("fires the publish callback", () => {
    const onPublish = vi.fn();

    render(panel({ onPublish }));

    fireEvent.click(screen.getByRole("button", { name: /Publish & pay/ }));

    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});

function walletAction(overrides: Partial<WalletCreateAction> = {}): WalletCreateAction {
  return {
    disabled: false,
    kind: "ready",
    label: "Create market",
    message: null,
    run: vi.fn(),
    ...overrides,
  };
}

function panel(overrides: Partial<Parameters<typeof ApprovedPanel>[0]> = {}) {
  return (
    <ApprovedPanel
      creationFeeLabel="Waived in preview"
      draft={marketDraftFactory({ status: "approved" })}
      graduationThreshold={2500}
      isPublishing={false}
      onPublish={vi.fn()}
      walletAction={null}
      {...overrides}
    />
  );
}
