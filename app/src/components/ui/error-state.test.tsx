import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  EmptyState,
  ErrorState,
  OfflineState,
  PageErrorState,
  PermissionDeniedState,
  SectionErrorState,
  WalletRequiredState,
} from "./error-state";

describe("ErrorState", () => {
  it("interrupts for a failure", () => {
    render(<ErrorState body="The read failed." title="Positions unavailable" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Positions unavailable")).toBeInTheDocument();
    expect(screen.getByText("The read failed.")).toBeInTheDocument();
  });

  it("stays polite for the muted tone — nothing has gone wrong", () => {
    render(<ErrorState body="Nothing yet." title="Not cleared" tone="muted" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["danger", "var(--danger)"],
    ["warning", "var(--warning)"],
    ["info", "var(--info)"],
    ["muted", "var(--text-muted)"],
  ] as const)("carries the %s tone as a custom property", (tone, expected) => {
    const { container } = render(<ErrorState body="Body." title="Title" tone={tone} />);
    const root = container.firstElementChild as HTMLElement;

    expect(root.style.getPropertyValue("--state-tone")).toBe(expected);
  });

  it("runs the action", () => {
    const onClick = vi.fn();

    render(
      <ErrorState action={{ label: "Retry", onClick }} body="Body." title="Title" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders a link action as a link", () => {
    render(
      <ErrorState
        action={{ href: "/", label: "Browse markets" }}
        body="Body."
        title="Title"
      />
    );

    expect(screen.getByRole("link", { name: "Browse markets" })).toHaveAttribute(
      "href",
      "/"
    );
  });

  it("shows a detail footnote when one is given, and nothing when not", () => {
    const { rerender } = render(
      <ErrorState body="Body." detail="digest 8f2c14ab" title="Title" />
    );

    expect(screen.getByText("digest 8f2c14ab")).toBeInTheDocument();

    rerender(<ErrorState body="Body." title="Title" />);

    expect(screen.queryByText("digest 8f2c14ab")).not.toBeInTheDocument();
  });

  it("renders a caller icon in place of the default", () => {
    render(
      <ErrorState
        body="Body."
        icon={<span data-testid="custom-icon" />}
        title="Title"
      />
    );

    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("omits the icon slot entirely on the card variants when none is given", () => {
    const { container } = render(<ErrorState body="Body." title="Title" />);

    expect(container.querySelector("svg")).toBeNull();
  });

  it("takes the roomier padding on the page variant", () => {
    const { container } = render(
      <ErrorState body="Body." title="Title" variant="page" />
    );

    expect(container.firstElementChild).toHaveClass("p-7");
  });

  describe("inline variant", () => {
    it("renders on the raised surface with a default icon", () => {
      const { container } = render(
        <ErrorState body="Body." title="Title" variant="inline" />
      );

      expect(container.firstElementChild).toHaveClass("bg-[var(--surface-raised)]");
      expect(container.querySelector("svg")).not.toBeNull();
    });

    it("takes a caller icon, a detail, and an action", () => {
      const onClick = vi.fn();

      render(
        <ErrorState
          action={{ label: "Reconnect", onClick }}
          body="Body."
          detail="req 41"
          icon={<span data-testid="inline-icon" />}
          title="Title"
          variant="inline"
        />
      );

      expect(screen.getByTestId("inline-icon")).toBeInTheDocument();
      expect(screen.getByText("req 41")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    });

    it("renders without an action", () => {
      render(<ErrorState body="Body." title="Title" variant="inline" />);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});

describe("PageErrorState", () => {
  it("offers the retry it was given, under a caller label", () => {
    const onRetry = vi.fn();

    render(
      <PageErrorState
        body="Body."
        detail="digest 99"
        onRetry={onRetry}
        retryLabel="Reload portfolio"
        title="Portfolio didn't load"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload portfolio" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText("digest 99")).toBeInTheDocument();
  });

  it("defaults the retry label", () => {
    render(<PageErrorState body="Body." onRetry={vi.fn()} title="Title" />);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("renders with no retry and no detail when there is nothing to offer", () => {
    render(<PageErrorState body="Body." title="Title" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("SectionErrorState", () => {
  it("retries just its own section", () => {
    const onRetry = vi.fn();

    render(<SectionErrorState body="Body." onRetry={onRetry} title="Title" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("takes a caller retry label, and renders without a retry", () => {
    const { rerender } = render(
      <SectionErrorState
        body="Body."
        onRetry={vi.fn()}
        retryLabel="Re-read"
        title="Title"
      />
    );

    expect(screen.getByRole("button", { name: "Re-read" })).toBeInTheDocument();

    rerender(<SectionErrorState body="Body." title="Title" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("is announced politely, not as an alert", () => {
    render(<EmptyState body="Nothing here yet." title="No receipts yet" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("looks unlike a failure — dashed, not solid", () => {
    const { container } = render(<EmptyState body="Body." title="Title" />);

    expect(container.firstElementChild).toHaveClass("border-dashed");
  });

  it("offers a way to fill the emptiness", () => {
    render(
      <EmptyState
        action={{ href: "/", label: "Browse markets" }}
        body="Body."
        title="Title"
      />
    );

    expect(screen.getByRole("link", { name: "Browse markets" })).toBeInTheDocument();
  });

  it("takes a caller icon in place of the default, and renders without an action", () => {
    render(
      <EmptyState body="Body." icon={<span data-testid="empty-icon" />} title="Title" />
    );

    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("OfflineState", () => {
  it("rules out data loss in its default copy — a read failure is not a lost position", () => {
    render(<OfflineState />);

    expect(screen.getByText("Can't reach the market API")).toBeInTheDocument();
    expect(screen.getByText(/Nothing was lost/)).toBeInTheDocument();
  });

  it("retries", () => {
    const onRetry = vi.fn();

    render(<OfflineState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("scales up for the page variant", () => {
    const { container } = render(
      <OfflineState body="Body." title="You're offline" variant="page" />
    );

    expect(container.firstElementChild).toHaveClass("p-7");
    expect(screen.getByText("You're offline")).toBeInTheDocument();
  });
});

describe("WalletRequiredState", () => {
  it("leads with connecting, in the info tone", () => {
    const onConnect = vi.fn();
    const { container } = render(<WalletRequiredState onConnect={onConnect} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));

    expect(onConnect).toHaveBeenCalledOnce();
    expect(screen.getByText("No wallet connected")).toBeInTheDocument();
    expect(
      (container.firstElementChild as HTMLElement).style.getPropertyValue(
        "--state-tone"
      )
    ).toBe("var(--info)");
  });

  it("takes surface-specific copy at page size, with no action", () => {
    const { container } = render(
      <WalletRequiredState
        body="Your studio holds your drafts."
        title="Connect to open your studio"
        variant="page"
      />
    );

    expect(container.firstElementChild).toHaveClass("p-7");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("PermissionDeniedState", () => {
  it("names the wallet that was refused, so an account switch is visible", () => {
    render(
      <PermissionDeniedState
        body="This draft belongs to another wallet."
        walletAddress="0x8f2c…14ab"
      />
    );

    expect(screen.getByText("This wallet can't open that")).toBeInTheDocument();
    expect(screen.getByText("0x8f2c…14ab")).toBeInTheDocument();
  });

  it("offers an action and a caller title, and renders without either extra", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <PermissionDeniedState
        action={{ label: "Switch wallet", onClick }}
        body="Body."
        title="Creator only"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch wallet" }));

    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText("Creator only")).toBeInTheDocument();

    rerender(<PermissionDeniedState body="Body." />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
