import type { PortfolioPosition } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PositionClaim } from "./position-claim";

const useRedemption = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/contracts/hooks/use-redemption", () => ({
  useRedemption,
}));

const WAD = 10n ** 18n;
const MARKET = "0x2222222222222222222222222222222222222222";

beforeEach(() => {
  useRedemption.mockReset();
  useRedemption.mockReturnValue({
    error: null,
    redeem: vi.fn(),
    redeemDraw: vi.fn(),
    result: null,
    status: "idle",
  });
});

describe("PositionClaim", () => {
  it.each([
    ["has no resolution", positionWithoutResolution()],
    [
      "is on the losing side",
      positionFixture({ resolution: resolutionFixture({ winningSide: "no" }) }),
    ],
    ["has no held balance", positionFixture({ heldBalance: "0" })],
    [
      // Below the one-cent floor a claim could round to zero redeemable on
      // 6-decimal collateral — no button may render for dust.
      "holds only sub-cent dust",
      positionFixture({ heldBalance: (10n ** 11n).toString() }),
    ],
  ])("renders nothing when the position %s", (_reason, position) => {
    const { container } = render(
      <PositionClaim onClaimed={vi.fn()} position={position} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("claims a resolved winning-side position", () => {
    const redeem = vi.fn();
    useRedemption.mockReturnValue({
      error: null,
      redeem,
      redeemDraw: vi.fn(),
      result: null,
      status: "idle",
    });
    const onClaimed = vi.fn();

    render(<PositionClaim onClaimed={onClaimed} position={positionFixture()} />);

    expect(useRedemption).toHaveBeenCalledWith({ onRedeemed: onClaimed });
    fireEvent.click(screen.getByRole("button", { name: "Claim $40.00" }));
    expect(redeem).toHaveBeenCalledWith({
      amount: 40n * WAD,
      marketAddress: MARKET,
      side: "yes",
    });
  });

  it.each([
    ["yes", 40n * WAD, 0n],
    ["no", 0n, 40n * WAD],
  ] as const)(
    "claims a cancelled draw's %s position at half value",
    (side, yesAmount, noAmount) => {
      const redeemDraw = vi.fn();
      useRedemption.mockReturnValue({
        error: null,
        redeem: vi.fn(),
        redeemDraw,
        result: null,
        status: "idle",
      });

      render(
        <PositionClaim
          onClaimed={vi.fn()}
          position={positionFixture({ resolution: drawResolution(), side })}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Claim $20.00" }));
      expect(redeemDraw).toHaveBeenCalledWith({
        marketAddress: MARKET,
        noAmount,
        yesAmount,
      });
    }
  );

  it("hides a draw claim when its half value is below one cent", () => {
    const { container } = render(
      <PositionClaim
        onClaimed={vi.fn()}
        position={positionFixture({
          heldBalance: (10n ** 16n).toString(),
          resolution: drawResolution(),
        })}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows progress while the redemption is pending", () => {
    useRedemption.mockReturnValue({
      error: null,
      redeem: vi.fn(),
      redeemDraw: vi.fn(),
      result: null,
      status: "pending",
    });

    render(<PositionClaim onClaimed={vi.fn()} position={positionFixture()} />);

    expect(screen.getByRole("button", { name: "Claiming…" })).toBeDisabled();
  });

  it("shows the confirmed display value, not raw collateral or tokens burned", () => {
    useRedemption.mockReturnValue({
      error: null,
      redeem: vi.fn(),
      redeemDraw: vi.fn(),
      result: {
        collateralAmount: 24n * 10n ** 6n,
        outcomeAmount: 24n * WAD,
        valueWad: 17n * WAD,
      },
      status: "success",
    });

    render(<PositionClaim onClaimed={vi.fn()} position={positionFixture()} />);

    expect(screen.getByRole("button", { name: "Claimed $17.00" })).toBeDisabled();
  });

  it("keeps the confirmed button locked while its result is not yet exposed", () => {
    useRedemption.mockReturnValue({
      error: null,
      redeem: vi.fn(),
      redeemDraw: vi.fn(),
      result: null,
      status: "success",
    });

    render(<PositionClaim onClaimed={vi.fn()} position={positionFixture()} />);

    expect(screen.getByRole("button", { name: "Claimed" })).toBeDisabled();
  });

  it("does not redeem when a non-idle stale row has no resolution", () => {
    const redeem = vi.fn();
    useRedemption.mockReturnValue({
      error: "Could not claim your winnings.",
      redeem,
      redeemDraw: vi.fn(),
      result: null,
      status: "error",
    });

    render(
      <PositionClaim onClaimed={vi.fn()} position={positionWithoutResolution()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Claim $40.00" }));
    expect(redeem).not.toHaveBeenCalled();
  });

  it("renders the redemption error", () => {
    useRedemption.mockReturnValue({
      error: "Could not claim your winnings.",
      redeem: vi.fn(),
      redeemDraw: vi.fn(),
      result: null,
      status: "error",
    });

    render(<PositionClaim onClaimed={vi.fn()} position={positionFixture()} />);

    expect(screen.getByText("Could not claim your winnings.")).toBeInTheDocument();
  });
});

function positionFixture(
  overrides: Partial<PortfolioPosition> = {}
): PortfolioPosition {
  return {
    committedInOrders: "0",
    heldBalance: (40n * WAD).toString(),
    marketId: "7",
    outcomeToken: "0x00000000000000000000000000000000000000e0",
    ownedTotal: (40n * WAD).toString(),
    resolution: resolutionFixture(),
    side: "yes",
    ...overrides,
  };
}

function positionWithoutResolution() {
  const position = positionFixture();
  delete position.resolution;

  return position;
}

function resolutionFixture(
  overrides: Partial<NonNullable<PortfolioPosition["resolution"]>> = {}
): NonNullable<PortfolioPosition["resolution"]> {
  return {
    kind: "resolved",
    postgradMarket: MARKET,
    resolvedAt: "2026-07-14T00:00:00.000Z",
    transactionHash: `0x${"cc".repeat(32)}`,
    winningSide: "yes",
    ...overrides,
  };
}

function drawResolution(): NonNullable<PortfolioPosition["resolution"]> {
  return {
    kind: "cancelled",
    postgradMarket: MARKET,
    resolvedAt: "2026-07-14T00:00:00.000Z",
    transactionHash: `0x${"cc".repeat(32)}`,
  };
}
