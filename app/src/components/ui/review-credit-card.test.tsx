import type { MarketDraftReviewCredit } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LOW_CREDIT_RUNS, ReviewCreditCard } from "./review-credit-card";

/** A funded, metered position; each test overrides only what it is about. */
function credit(
  overrides: Partial<MarketDraftReviewCredit> = {}
): MarketDraftReviewCredit {
  return {
    availableWad: "10700000000000000000",
    metered: true,
    rateWad: "100000000000000000",
    runsRemaining: 107,
    runsUsed: 6,
    ...overrides,
  };
}

describe("ReviewCreditCard", () => {
  it("reports the remaining runs, balance, and per-review rate", () => {
    render(<ReviewCreditCard credit={credit()} />);

    expect(screen.getByText("107 reviews left")).toBeInTheDocument();
    expect(
      screen.getByText("10.70 pUSD left · 0.10 pUSD per review")
    ).toBeInTheDocument();
  });

  it("says review, singular, at one run left", () => {
    render(
      <ReviewCreditCard
        credit={credit({ availableWad: "100000000000000000", runsRemaining: 1 })}
      />
    );

    expect(screen.getByText("1 review left")).toBeInTheDocument();
  });

  it("names the empty state instead of showing a bare zero", () => {
    render(
      <ReviewCreditCard credit={credit({ availableWad: "0", runsRemaining: 0 })} />
    );

    expect(screen.getByText("Out of credit")).toBeInTheDocument();
  });

  it("tones a healthy balance with the informational accent", () => {
    render(<ReviewCreditCard credit={credit()} />);

    expect(screen.getByText("107 reviews left")).toHaveStyle({
      color: "var(--pc-cyan)",
    });
  });

  it("warns at the low-water mark", () => {
    render(
      <ReviewCreditCard credit={credit({ runsRemaining: LOW_CREDIT_RUNS })} />
    );

    expect(screen.getByText(`${LOW_CREDIT_RUNS} reviews left`)).toHaveStyle({
      color: "var(--pc-amber)",
    });
  });

  it("escalates past a warning once nothing is left", () => {
    render(<ReviewCreditCard credit={credit({ runsRemaining: 0 })} />);

    expect(screen.getByText("Out of credit")).toHaveStyle({
      color: "var(--danger)",
    });
  });

  it("treats a string-serialized run count the same as a number", () => {
    render(<ReviewCreditCard credit={credit({ runsRemaining: "0" })} />);

    expect(screen.getByText("Out of credit")).toHaveStyle({
      color: "var(--danger)",
    });
  });

  it("offers the top-up action when the caller can service one", () => {
    const onTopUp = vi.fn();
    render(<ReviewCreditCard credit={credit()} onTopUp={onTopUp} />);

    fireEvent.click(screen.getByRole("button", { name: "Top up credit" }));

    expect(onTopUp).toHaveBeenCalledOnce();
  });

  it("omits the action when no handler is given", () => {
    render(<ReviewCreditCard credit={credit()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing when the position is unknown", () => {
    const { container } = render(<ReviewCreditCard credit={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on an ungated stack rather than an empty meter", () => {
    const { container } = render(
      <ReviewCreditCard credit={credit({ metered: false })} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
