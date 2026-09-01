import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  claimablePayout,
  disputeOnHeldMarket,
  graduatedHolding,
  graduatingWatched,
  NOW,
} from "./fixtures";
import { NotificationToast } from "./notification-toast";
import { TOAST_DISMISS_MS } from "./notification-types";

const rail = () => screen.queryByTestId("toast-dismiss-rail");

describe("NotificationToast", () => {
  it("renders the same body the inbox will show later", () => {
    render(
      <NotificationToast
        notification={graduatedHolding}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(screen.getByText("Now trading outcome tokens")).toBeInTheDocument();
    expect(screen.getByText(graduatedHolding.marketQuestion)).toBeInTheDocument();
  });

  it("gives a claimable payout no dismiss timer at all", () => {
    render(
      <NotificationToast
        notification={claimablePayout}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(rail()).not.toBeInTheDocument();
  });

  it("gives a dispute on a held market no dismiss timer either", () => {
    render(
      <NotificationToast
        notification={disputeOnHeldMarket}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(rail()).not.toBeInTheDocument();
  });

  it("counts a watched-market toast down on its own", () => {
    render(
      <NotificationToast
        notification={graduatingWatched}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(rail()).toHaveAttribute("data-motion", "animated");
    expect(rail()).toHaveStyle({
      "--pc-notification-dismiss": `${TOAST_DISMISS_MS.ambient}ms`,
    });
  });

  it("swaps the countdown for a static rail under reduced motion", () => {
    render(
      <NotificationToast notification={graduatingWatched} now={NOW} reducedMotion />
    );

    expect(rail()).toHaveAttribute("data-motion", "static");
    expect(rail()).not.toHaveClass("pc-notification-timer");
  });

  it("animates its entrance only when motion is allowed", () => {
    const { container, unmount } = render(
      <NotificationToast
        notification={graduatedHolding}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(container.querySelector(".pc-notification-enter")).toBeInTheDocument();
    unmount();

    const reduced = render(
      <NotificationToast notification={graduatedHolding} now={NOW} reducedMotion />
    );

    expect(
      reduced.container.querySelector(".pc-notification-enter")
    ).not.toBeInTheDocument();
  });

  it("interrupts a screen reader only for what the viewer must act on", () => {
    const { unmount } = render(
      <NotificationToast
        notification={graduatingWatched}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
    unmount();

    render(
      <NotificationToast
        notification={claimablePayout}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("dismisses by id", () => {
    const onDismiss = vi.fn();
    render(
      <NotificationToast
        notification={graduatedHolding}
        now={NOW}
        onDismiss={onDismiss}
        reducedMotion={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(onDismiss).toHaveBeenCalledWith(graduatedHolding.id);
  });

  it("offers no close control where the caller cannot service one", () => {
    render(
      <NotificationToast
        notification={graduatedHolding}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(
      screen.queryByRole("button", { name: "Dismiss notification" })
    ).not.toBeInTheDocument();
  });
});
