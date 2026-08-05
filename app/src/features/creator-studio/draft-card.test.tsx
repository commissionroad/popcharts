import type { MarketDraft } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { draftReviewFactory, marketDraftFactory } from "@/test/factories/drafts";

import { DraftCard, formatRelativeTime } from "./draft-card";

const NOW = new Date("2026-07-30T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });

  it("clamps future timestamps to just now", () => {
    expect(formatRelativeTime("2026-07-30T12:05:00.000Z", NOW)).toBe("just now");
  });

  it.each([
    ["2026-07-30T11:59:30.000Z", "just now"],
    ["2026-07-30T11:55:00.000Z", "5m ago"],
    ["2026-07-30T09:00:00.000Z", "3h ago"],
    ["2026-07-28T12:00:00.000Z", "2d ago"],
  ])("renders %s as %s", (iso, expected) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected);
  });
});

describe("DraftCard", () => {
  it("shows the status chip, question link, category, id, and time", () => {
    renderCard();

    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Will bitcoin close above $100k on 2027-01-01?",
      })
    ).toHaveAttribute("href", "/create?draft=12");
    expect(screen.getByText("Crypto")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("5m ago")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/create?draft=12"
    );
    expect(screen.queryByRole("link", { name: "Market" })).not.toBeInTheDocument();
  });

  it.each([
    ["approved", "Approved"],
    ["changes_requested", "Needs fixes"],
    ["editing", "Draft"],
    ["in_review", "In review"],
    ["published", "Live"],
    ["rejected", "Rejected"],
  ] as const)("labels a %s draft as %s", (status, label) => {
    renderCard({ status });

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("relabels the open action for a published draft", () => {
    renderCard({ status: "published" });

    expect(screen.getByRole("link", { name: "View draft" })).toHaveAttribute(
      "href",
      "/create?draft=12"
    );
  });

  it("overrides the status chip for templates and offers untemplating", () => {
    renderCard({ isTemplate: true });

    expect(screen.getByText("Template")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Untemplate" })).toBeInTheDocument();
  });

  it("links to the market once the draft is published on-chain", () => {
    renderCard({ publishedChainId: 31337, publishedMarketId: "9" });

    expect(screen.getByRole("link", { name: "Market" })).toHaveAttribute(
      "href",
      "/markets/31337:9"
    );
  });

  it("omits the market link when only the chain id is known", () => {
    renderCard({ publishedChainId: 31337 });

    expect(screen.queryByRole("link", { name: "Market" })).not.toBeInTheDocument();
  });

  it("falls back to an untitled label for a blank question", () => {
    renderCard({ question: "   " });

    expect(screen.getByRole("link", { name: "Untitled draft" })).toBeInTheDocument();
  });

  it("shows the latest review's one-line summary when there is one", () => {
    renderCard({ latestReview: draftReviewFactory() });

    expect(
      screen.getByText(
        "Almost there — fix the flagged issues below and resubmit for review."
      )
    ).toBeInTheDocument();
  });

  it("fires the clone, template, and delete callbacks", () => {
    const handlers = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(handlers.onClone).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleTemplate).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it("disables the mutating actions while the draft is busy", () => {
    renderCard({}, { busy: true });

    expect(screen.getByRole("button", { name: "Clone" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Template" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});

function renderCard(
  draftOverrides: Partial<MarketDraft> = {},
  cardOverrides: Partial<Parameters<typeof DraftCard>[0]> = {}
) {
  const handlers = {
    onClone: vi.fn(),
    onDelete: vi.fn(),
    onToggleTemplate: vi.fn(),
  };

  render(
    <DraftCard
      busy={false}
      draft={marketDraftFactory({
        updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        ...draftOverrides,
      })}
      {...handlers}
      {...cardOverrides}
    />
  );

  return handlers;
}
