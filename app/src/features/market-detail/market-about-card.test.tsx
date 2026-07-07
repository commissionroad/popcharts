import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { marketFactory } from "@/test/factories/markets";

import { MarketAboutCard } from "./market-about-card";

describe("MarketAboutCard", () => {
  it("renders the description, resolution criteria, and detail metadata", () => {
    render(
      <MarketAboutCard
        market={marketFactory({
          createdAt: "2026-06-01T14:30:00.000Z",
          creator: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
          description: "Resolves YES on a $5,000 print.",
          metadataHash: `0x${"ab".repeat(32)}`,
          resolutionCriteria: "Wicks count; derivatives do not.",
        })}
      />
    );

    expect(screen.getByText("Resolves YES on a $5,000 print.")).toBeInTheDocument();
    expect(screen.getByText("Resolution criteria")).toBeInTheDocument();
    expect(screen.getByText("Wicks count; derivatives do not.")).toBeInTheDocument();
    expect(screen.getByText("Closes")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.getByText("Metadata hash")).toBeInTheDocument();
    expect(screen.getByText("0x1f9...984")).toBeInTheDocument();
  });

  it("hides the optional sections for a minimal market", () => {
    render(<MarketAboutCard market={minimalMarket()} />);

    expect(screen.queryByText("Resolution criteria")).not.toBeInTheDocument();
    expect(screen.queryByText("Resolution sources")).not.toBeInTheDocument();
    expect(screen.queryByText("Created")).not.toBeInTheDocument();
    expect(screen.queryByText("Creator")).not.toBeInTheDocument();
    expect(screen.queryByText("Metadata hash")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("dedupes the resolution url against the source list", () => {
    render(
      <MarketAboutCard
        market={marketFactory({
          resolutionSources: [
            "https://coinmarketcap.com/currencies/ethereum/",
            "https://www.coinbase.com/price/ethereum",
          ],
          resolutionUrl: "https://coinmarketcap.com/currencies/ethereum/",
        })}
      />
    );

    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      "https://coinmarketcap.com/currencies/ethereum/"
    );
    expect(
      screen.getByText("coinmarketcap.com/currencies/ethereum/")
    ).toBeInTheDocument();
  });

  it("labels a root url with the bare hostname", () => {
    render(
      <MarketAboutCard
        market={marketFactory({
          resolutionSources: [],
          resolutionUrl: "https://example.com/",
        })}
      />
    );

    expect(screen.getByRole("link", { name: /example\.com/ })).toHaveTextContent(
      /^example\.com$/
    );
  });

  it("falls back to the raw source when it is not a parseable url", () => {
    const market = marketFactory({ resolutionSources: ["CNN newsroom"] });
    delete market.resolutionUrl;

    render(<MarketAboutCard market={market} />);

    expect(screen.getByRole("link", { name: /CNN newsroom/ })).toBeInTheDocument();
  });
});

function minimalMarket() {
  const market = marketFactory();
  delete market.createdAt;
  delete market.creator;
  delete market.metadataHash;
  delete market.resolutionCriteria;
  delete market.resolutionSources;
  delete market.resolutionUrl;

  return market;
}
