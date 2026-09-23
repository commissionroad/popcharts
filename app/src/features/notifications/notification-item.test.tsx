import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  claimablePayout,
  graduatedHolding,
  graduatingWatched,
  NOW,
  unknownPriorStatus,
} from "./fixtures";
import { NotificationItem } from "./notification-item";

describe("NotificationItem", () => {
  it("renders the transition as two status pills", () => {
    render(<NotificationItem notification={graduatedHolding} now={NOW} />);

    expect(screen.getByText("Graduating")).toBeInTheDocument();
    expect(screen.getByText("Graduated")).toBeInTheDocument();
  });

  it("shows only the arriving pill when the prior status is unknown", () => {
    render(<NotificationItem notification={unknownPriorStatus} now={NOW} />);

    expect(screen.getByText("Graduated")).toBeInTheDocument();
    expect(screen.queryByText("Graduating")).not.toBeInTheDocument();
  });

  it("leads with what the transition means, not the status name again", () => {
    render(<NotificationItem notification={claimablePayout} now={NOW} />);

    expect(screen.getByText("Outcome final")).toBeInTheDocument();
    // The pill still carries the status word itself, exactly once.
    expect(screen.getAllByText("Resolved")).toHaveLength(1);
  });

  it("names the market and the viewer's stake in it", () => {
    render(<NotificationItem notification={graduatedHolding} now={NOW} />);

    expect(screen.getByText(graduatedHolding.marketQuestion)).toBeInTheDocument();
    expect(
      screen.getByText("Your 120 YES receipts became backed outcome tokens.")
    ).toBeInTheDocument();
  });

  it("distinguishes a held market from a watched one", () => {
    const { unmount } = render(
      <NotificationItem notification={graduatedHolding} now={NOW} />
    );

    expect(screen.getByText(/Holding/)).toBeInTheDocument();
    unmount();

    render(<NotificationItem notification={graduatingWatched} now={NOW} />);

    expect(screen.getByText(/Watching/)).toBeInTheDocument();
  });

  it("omits the detail line when there is nothing extra to say", () => {
    render(<NotificationItem notification={graduatingWatched} now={NOW} />);

    expect(screen.queryByText(/receipts/)).not.toBeInTheDocument();
  });

  it("dates the change against the supplied clock", () => {
    render(<NotificationItem notification={graduatedHolding} now={NOW} />);

    expect(screen.getByText(/2m ago/)).toBeInTheDocument();
  });

  it("announces unread rather than leaving it to colour alone", () => {
    render(<NotificationItem notification={graduatedHolding} now={NOW} />);

    expect(screen.getByText("Unread")).toBeInTheDocument();
  });

  it("drops the unread marker once the entry is read", () => {
    render(
      <NotificationItem notification={{ ...graduatedHolding, read: true }} now={NOW} />
    );

    expect(screen.queryByText("Unread")).not.toBeInTheDocument();
  });

  it("offers the action where there is one", () => {
    render(<NotificationItem notification={claimablePayout} now={NOW} />);

    expect(screen.getByRole("link", { name: "Claim $412.60" })).toHaveAttribute(
      "href",
      "/portfolio"
    );
  });

  it("renders no action on a transition with nothing to do", () => {
    render(<NotificationItem notification={graduatingWatched} now={NOW} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("passes a caller class onto the row", () => {
    const { container } = render(
      <NotificationItem
        className="test-row"
        notification={graduatedHolding}
        now={NOW}
      />
    );

    expect(container.querySelector(".test-row")).toBeInTheDocument();
  });
});
