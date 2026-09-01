import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { graduatedHolding, inboxBacklog, NOW } from "./fixtures";
import { NotificationInbox } from "./notification-inbox";
import { unreadCount } from "./notification-types";

const allRead = inboxBacklog.map((entry) => ({ ...entry, read: true }));

describe("NotificationInbox", () => {
  it("lists the backlog newest first, as given", () => {
    render(<NotificationInbox notifications={inboxBacklog} now={NOW} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(inboxBacklog.length);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
      inboxBacklog[0]!.marketQuestion
    );
  });

  it("reports how many are unread", () => {
    render(<NotificationInbox notifications={inboxBacklog} now={NOW} />);

    expect(screen.getByText(`${unreadCount(inboxBacklog)} unread`)).toBeInTheDocument();
  });

  it("says nothing about unread once the viewer has caught up", () => {
    render(<NotificationInbox notifications={allRead} now={NOW} />);

    expect(screen.queryByText(/unread/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Mark all read/ })
    ).not.toBeInTheDocument();
  });

  it("marks the whole backlog read", () => {
    const onMarkAllRead = vi.fn();
    render(
      <NotificationInbox
        notifications={inboxBacklog}
        now={NOW}
        onMarkAllRead={onMarkAllRead}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Mark all read/ }));

    expect(onMarkAllRead).toHaveBeenCalledOnce();
  });

  it("offers no mark-all where the caller cannot service it", () => {
    render(<NotificationInbox notifications={inboxBacklog} now={NOW} />);

    expect(
      screen.queryByRole("button", { name: /Mark all read/ })
    ).not.toBeInTheDocument();
  });

  it("marks one entry read by id", () => {
    const onMarkRead = vi.fn();
    render(
      <NotificationInbox
        notifications={[graduatedHolding]}
        now={NOW}
        onMarkRead={onMarkRead}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: `Mark as read: ${graduatedHolding.marketQuestion}`,
      })
    );

    expect(onMarkRead).toHaveBeenCalledWith(graduatedHolding.id);
  });

  it("offers no per-row control on an entry already read", () => {
    render(
      <NotificationInbox
        notifications={[{ ...graduatedHolding, read: true }]}
        now={NOW}
        onMarkRead={() => undefined}
      />
    );

    expect(screen.queryByRole("button", { name: /Mark as read/ })).toBeNull();
  });

  it("offers no per-row control without a handler", () => {
    render(<NotificationInbox notifications={[graduatedHolding]} now={NOW} />);

    expect(screen.queryByRole("button", { name: /Mark as read/ })).toBeNull();
  });

  it("explains an empty inbox instead of showing a bare list", () => {
    render(<NotificationInbox notifications={[]} now={NOW} />);

    expect(screen.getByText("Nothing to catch up on")).toBeInTheDocument();
    expect(
      screen.getByText("Status changes on markets you hold or watch will land here.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("takes a caller-supplied empty hint", () => {
    render(<NotificationInbox emptyHint="Nothing yet." notifications={[]} now={NOW} />);

    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });
});
