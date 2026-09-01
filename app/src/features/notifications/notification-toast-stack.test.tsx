import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  claimablePayout,
  disputeOnHeldMarket,
  graduatedHolding,
  graduatingWatched,
  NOW,
  simultaneousArrivals,
} from "./fixtures";
import { NotificationToastStack } from "./notification-toast-stack";

describe("NotificationToastStack", () => {
  it("renders nothing when nothing has arrived", () => {
    const { container } = render(
      <NotificationToastStack notifications={[]} now={NOW} reducedMotion={false} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a single arrival", () => {
    render(
      <NotificationToastStack
        notifications={[graduatedHolding]}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("keeps what the viewer must act on when the column overflows", () => {
    render(
      <NotificationToastStack
        notifications={simultaneousArrivals}
        now={NOW}
        reducedMotion={false}
      />
    );

    const shown = screen.getAllByRole("alert");

    expect(shown).toHaveLength(3);
    expect(shown[0]).toHaveTextContent(claimablePayout.marketQuestion);
    expect(shown[1]).toHaveTextContent(disputeOnHeldMarket.marketQuestion);
    // The watched-market chatter is what got summarised, not the payout.
    expect(
      screen.queryByText(graduatingWatched.marketQuestion)
    ).not.toBeInTheDocument();
  });

  it("summarises the remainder into the inbox", () => {
    const onShowAll = vi.fn();
    render(
      <NotificationToastStack
        notifications={simultaneousArrivals}
        now={NOW}
        onShowAll={onShowAll}
        reducedMotion={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /2 more in your inbox/ }));

    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("keeps equal-priority arrivals in the caller's newest-first order", () => {
    render(
      <NotificationToastStack
        notifications={[
          { ...graduatedHolding, id: "newer" },
          { ...graduatedHolding, id: "older", marketQuestion: "Older held market?" },
        ]}
        now={NOW}
        reducedMotion={false}
      />
    );

    const shown = screen.getAllByRole("alert");

    expect(shown[0]).toHaveTextContent(graduatedHolding.marketQuestion);
    expect(shown[1]).toHaveTextContent("Older held market?");
  });

  it("shows no summary line while everything fits", () => {
    render(
      <NotificationToastStack
        notifications={[graduatedHolding, graduatingWatched]}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(screen.queryByRole("button", { name: /in your inbox/ })).toBeNull();
  });

  it("honours a caller-set visible limit", () => {
    render(
      <NotificationToastStack
        maxVisible={1}
        notifications={simultaneousArrivals}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /4 more in your inbox/ })
    ).toBeInTheDocument();
  });

  it("inerts the summary line where the inbox cannot be opened", () => {
    render(
      <NotificationToastStack
        notifications={simultaneousArrivals}
        now={NOW}
        reducedMotion={false}
      />
    );

    expect(screen.getByRole("button", { name: /2 more in your inbox/ })).toBeDisabled();
  });

  it("falls back to the viewer's own motion preference", () => {
    // jsdom defines no `matchMedia`, so the hook reports no preference and the
    // entrance animation is applied — the default path in a real browser too.
    const { container } = render(
      <NotificationToastStack notifications={[graduatedHolding]} now={NOW} />
    );

    expect(container.querySelector(".pc-notification-enter")).toBeInTheDocument();
  });

  it("lets the caller force the reduced-motion treatment", () => {
    const { container } = render(
      <NotificationToastStack
        notifications={[graduatedHolding]}
        now={NOW}
        reducedMotion
      />
    );

    expect(container.querySelector(".pc-notification-enter")).not.toBeInTheDocument();
  });

  it("passes dismissal through to the toast", () => {
    const onDismiss = vi.fn();
    render(
      <NotificationToastStack
        notifications={[graduatedHolding]}
        now={NOW}
        onDismiss={onDismiss}
        reducedMotion={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(onDismiss).toHaveBeenCalledWith(graduatedHolding.id);
  });
});
