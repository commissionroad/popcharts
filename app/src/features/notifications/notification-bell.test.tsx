import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MAX_BADGE_COUNT, NotificationBell } from "./notification-bell";

describe("NotificationBell", () => {
  it("shows no badge when the viewer is caught up", () => {
    render(<NotificationBell unread={0} />);

    expect(
      screen.getByRole("button", { name: "Notifications, none unread" })
    ).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("counts the unread entries", () => {
    render(<NotificationBell unread={3} />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Notifications, 3 unread" })
    ).toBeInTheDocument();
  });

  it("still counts at the badge limit", () => {
    render(<NotificationBell unread={MAX_BADGE_COUNT} />);

    expect(screen.getByText(String(MAX_BADGE_COUNT))).toBeInTheDocument();
  });

  it("stops counting past the limit so the badge cannot outgrow the bell", () => {
    render(<NotificationBell unread={MAX_BADGE_COUNT + 1} />);

    expect(screen.getByText(`${MAX_BADGE_COUNT}+`)).toBeInTheDocument();
  });

  it("reports whether the inbox is open", () => {
    const { unmount } = render(<NotificationBell unread={0} />);

    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    unmount();

    render(<NotificationBell open unread={0} />);

    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("toggles the inbox", () => {
    const onToggle = vi.fn();
    render(<NotificationBell onToggle={onToggle} unread={2} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("takes a caller class", () => {
    render(<NotificationBell className="test-bell" unread={0} />);

    expect(screen.getByRole("button")).toHaveClass("test-bell");
  });
});
