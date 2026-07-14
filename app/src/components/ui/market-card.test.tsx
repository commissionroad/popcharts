import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { marketFactory } from "@/test/factories/markets";

import { MarketCard } from "./market-card";

describe("MarketCard", () => {
  it("links the entire card to the market page with an encoded id", () => {
    render(
      <MarketCard
        market={marketFactory({ id: "eth/5000", question: "Will ETH flip $5,000?" })}
      />
    );

    const cardLink = screen.getByRole("link", { name: "Will ETH flip $5,000?" });

    expect(cardLink).toHaveAttribute("href", "/markets/eth%2F5000");
    expect(cardLink).toHaveClass("absolute", "inset-0");
  });

  it("shows the category, status, prices, volume, and liquidity", () => {
    render(
      <MarketCard
        market={marketFactory({
          b: 5_000,
          category: "Crypto",
          id: "m1",
          noPriceCents: 36,
          status: "graduating",
          volumeUsd: 482_300,
          yesPriceCents: 64,
        })}
      />
    );

    expect(screen.getByText("Crypto")).toBeInTheDocument();
    expect(screen.getByText("Graduating")).toBeInTheDocument();
    expect(screen.getByText("64c")).toBeInTheDocument();
    expect(screen.getByText("36c")).toBeInTheDocument();
    expect(screen.getByText("Vol $482K")).toBeInTheDocument();
    expect(screen.getByText("b = 5,000")).toBeInTheDocument();
  });

  it("links each outcome to the market page with its side preselected", () => {
    render(<MarketCard market={marketFactory({ id: "m1" })} />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((link) => link.getAttribute("href"));

    expect(hrefs).toContain("/markets/m1?side=yes");
    expect(hrefs).toContain("/markets/m1?side=no");
  });

  it("shows the graduation bar while bootstrapping", () => {
    render(<MarketCard market={marketFactory({ status: "bootstrap" })} />);

    expect(graduationBarFill()).not.toBeNull();
  });

  it("shows the graduation bar while graduating", () => {
    render(<MarketCard market={marketFactory({ status: "graduating" })} />);

    expect(graduationBarFill()).not.toBeNull();
  });

  it("hides the graduation bar once the market is no longer live", () => {
    render(<MarketCard market={marketFactory({ status: "graduated" })} />);

    expect(graduationBarFill()).toBeNull();
  });
});

/**
 * The card's graduation bar renders without a caption, so the only observable
 * trace is the progress fill sized by an inline width.
 */
function graduationBarFill(): HTMLElement | null {
  return document.querySelector<HTMLElement>('div[style*="width"]');
}
