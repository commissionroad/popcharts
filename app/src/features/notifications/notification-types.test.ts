import { describe, expect, it } from "vitest";

import {
  claimablePayout,
  disputeOnHeldMarket,
  graduatedHolding,
  graduatingWatched,
  inboxBacklog,
} from "./fixtures";
import {
  type MarketStatusNotification,
  notificationHeadline,
  notificationPriority,
  PRIORITY_COLOR,
  TOAST_DISMISS_MS,
  unreadCount,
} from "./notification-types";

describe("notificationHeadline", () => {
  it("names the arriving status", () => {
    expect(notificationHeadline(graduatedHolding)).toBe("Now trading outcome tokens");
    expect(notificationHeadline(claimablePayout)).toBe("Outcome final");
    expect(notificationHeadline(disputeOnHeldMarket)).toBe("Outcome challenged");
  });

  it("never repeats the status pill's own label", () => {
    // The row shows both, side by side; a headline echoing the pill is wasted
    // space where the meaning of the transition should be.
    const pillLabels = new Set([
      "Under review",
      "Bootstrap",
      "Cancelled",
      "Graduated",
      "Graduating",
      "Refunded",
      "Resolved",
      "Rejected",
      "Resolution pending",
      "Disputed",
    ]);
    const statuses: MarketStatusNotification["to"][] = [
      "bootstrap",
      "cancelled",
      "disputed",
      "graduated",
      "graduating",
      "refunded",
      "rejected",
      "resolution_pending",
      "resolved",
      "under_review",
    ];

    for (const to of statuses) {
      expect(pillLabels).not.toContain(
        notificationHeadline({ ...graduatedHolding, to })
      );
    }
  });

  it("has a headline for every status the lifecycle can reach", () => {
    const statuses: MarketStatusNotification["to"][] = [
      "bootstrap",
      "cancelled",
      "disputed",
      "graduated",
      "graduating",
      "refunded",
      "rejected",
      "resolution_pending",
      "resolved",
      "under_review",
    ];

    for (const to of statuses) {
      expect(notificationHeadline({ ...graduatedHolding, to })).not.toBe("");
    }
  });
});

describe("notificationPriority", () => {
  it("puts anything with an action first, whatever the transition", () => {
    expect(notificationPriority(claimablePayout)).toBe("action");
  });

  it("treats a dispute on a held market as an alert", () => {
    expect(notificationPriority(disputeOnHeldMarket)).toBe("alert");
  });

  it("calls any other transition on a held market an update", () => {
    expect(notificationPriority(graduatedHolding)).toBe("update");
  });

  it("keeps a watched market ambient, dispute included", () => {
    expect(notificationPriority(graduatingWatched)).toBe("ambient");
    expect(notificationPriority({ ...graduatingWatched, to: "disputed" })).toBe(
      "ambient"
    );
  });

  it("ranks an action above an alert even on a watched market", () => {
    expect(
      notificationPriority({
        ...graduatingWatched,
        action: { href: "/", label: "Claim" },
      })
    ).toBe("action");
  });
});

describe("TOAST_DISMISS_MS", () => {
  it("never expires the two priorities the viewer must act on", () => {
    expect(TOAST_DISMISS_MS.action).toBeNull();
    expect(TOAST_DISMISS_MS.alert).toBeNull();
  });

  it("gives a held-market update longer than watched-market chatter", () => {
    expect(TOAST_DISMISS_MS.update).toBeGreaterThan(TOAST_DISMISS_MS.ambient);
  });
});

describe("PRIORITY_COLOR", () => {
  it("uses design tokens, never a literal colour", () => {
    for (const color of Object.values(PRIORITY_COLOR)) {
      expect(color).toMatch(/^var\(--[a-z-]+\)$/);
    }
  });
});

describe("unreadCount", () => {
  it("counts only the unread entries", () => {
    expect(unreadCount(inboxBacklog)).toBe(
      inboxBacklog.filter((entry) => !entry.read).length
    );
  });

  it("is zero for an empty inbox", () => {
    expect(unreadCount([])).toBe(0);
  });
});
