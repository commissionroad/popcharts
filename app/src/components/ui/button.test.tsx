import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

const GLOW_CLASS = "shadow-[var(--glow-magenta)]";

describe("Button", () => {
  it("renders a native button that fires clicks", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Place receipt</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Place receipt" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("glows by default for the primary variant", () => {
    render(<Button>Pop</Button>);

    expect(screen.getByRole("button", { name: "Pop" })).toHaveClass(GLOW_CLASS);
  });

  it("does not glow for non-primary variants by default", () => {
    render(
      <>
        <Button variant="secondary">Quiet</Button>
        <Button variant="ghost">Ghostly</Button>
      </>
    );

    expect(screen.getByRole("button", { name: "Quiet" })).not.toHaveClass(GLOW_CLASS);
    expect(screen.getByRole("button", { name: "Ghostly" })).not.toHaveClass(GLOW_CLASS);
  });

  it("honors an explicit glow override in both directions", () => {
    render(
      <>
        <Button glow={false}>Muted primary</Button>
        <Button glow variant="ghost">
          Glowing ghost
        </Button>
      </>
    );

    expect(screen.getByRole("button", { name: "Muted primary" })).not.toHaveClass(
      GLOW_CLASS
    );
    expect(screen.getByRole("button", { name: "Glowing ghost" })).toHaveClass(
      GLOW_CLASS
    );
  });

  it("disables the native button and blocks clicks", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Locked
      </Button>
    );
    const button = screen.getByRole("button", { name: "Locked" });

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders icons on both sides of the label", () => {
    render(
      <Button
        leftIcon={<span data-testid="left-icon" />}
        rightIcon={<span data-testid="right-icon" />}
        size="lg"
      >
        Iconed
      </Button>
    );
    const button = screen.getByRole("button", { name: "Iconed" });

    expect(button).toContainElement(screen.getByTestId("left-icon"));
    expect(button).toContainElement(screen.getByTestId("right-icon"));
  });

  it("renders a link when an href is provided", () => {
    render(
      <Button href="/create" size="sm" variant="secondary">
        Pop a market
      </Button>
    );
    const link = screen.getByRole("link", { name: "Pop a market" });

    expect(link).toHaveAttribute("href", "/create");
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("marks a disabled link with aria-disabled", () => {
    render(
      <Button disabled href="/create">
        Pop a market
      </Button>
    );

    expect(screen.getByRole("link", { name: "Pop a market" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });
});
