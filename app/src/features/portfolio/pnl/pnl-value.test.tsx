import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WAD } from "@/domain/tokens/wad";

import { PnlValue } from "./pnl-value";

describe("PnlValue", () => {
  it("pairs a gain's colour with a sign and a spoken direction", () => {
    render(<PnlValue amountWad={(WAD * 2240n) / 100n} returnBps={5600} />);

    expect(screen.getByText("+$22.40")).toBeInTheDocument();
    expect(screen.getByText("Gain of")).toBeInTheDocument();
    expect(screen.getByText("+56.0%")).toBeInTheDocument();
  });

  it("pairs a loss's colour with a sign and a spoken direction", () => {
    render(<PnlValue amountWad={(WAD * -2400n) / 100n} />);

    expect(screen.getByText("-$24.00")).toBeInTheDocument();
    expect(screen.getByText("Loss of")).toBeInTheDocument();
  });

  it("calls out break-even rather than showing it as a gain", () => {
    render(<PnlValue amountWad={0n} returnBps={0} />);

    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("Break-even of")).toBeInTheDocument();
    expect(screen.getByText("0.0%")).toBeInTheDocument();
  });

  it("shows a dash for an unpriced position instead of a zero", () => {
    render(<PnlValue amountWad={null} />);

    expect(screen.getByText("No price available")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("renders the headline size for the portfolio rollup", () => {
    render(<PnlValue amountWad={WAD * 12n} returnBps={2400} size="lg" />);

    expect(screen.getByText("+$12.00")).toBeInTheDocument();
    expect(screen.getByText("+24.0%")).toBeInTheDocument();
  });
});
