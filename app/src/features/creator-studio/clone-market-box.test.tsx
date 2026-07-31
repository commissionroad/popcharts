import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import { CloneMarketBox } from "./clone-market-box";

const getMarketsMock = vi.hoisted(() => vi.fn());

vi.mock("@/domain/markets/queries", () => ({
  getMarkets: getMarketsMock,
}));

beforeEach(() => {
  getMarketsMock.mockReset();
});

describe("CloneMarketBox", () => {
  it("shows a loading note while the board loads", () => {
    getMarketsMock.mockReturnValue(new Promise(() => {}));

    render(box());

    expect(screen.getByText("Start from a market")).toBeInTheDocument();
    expect(screen.getByText("Loading the board…")).toBeInTheDocument();
  });

  it("points at the paste path when the board is empty", async () => {
    getMarketsMock.mockResolvedValue([]);

    render(box());

    expect(
      await screen.findByText(
        "No markets on the board yet — paste a market id instead."
      )
    ).toBeInTheDocument();
  });

  it("lists at most eight markets from the board", async () => {
    getMarketsMock.mockResolvedValue(
      Array.from({ length: 9 }, (_, index) =>
        marketFactory({
          id: `31337:${index}`,
          question: `Board market ${index}?`,
        })
      )
    );

    render(box());

    expect(await screen.findByText("Board market 0?")).toBeInTheDocument();
    expect(screen.getByText("Board market 7?")).toBeInTheDocument();
    expect(screen.queryByText("Board market 8?")).not.toBeInTheDocument();
  });

  it("clones a board market and closes on success", async () => {
    getMarketsMock.mockResolvedValue([
      marketFactory({ id: "31337:4", question: "Pick me?" }),
    ]);
    let resolveClone!: (cloned: boolean) => void;
    const onClone = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveClone = resolve;
        })
    );
    const onClosed = vi.fn();

    render(box({ onClone, onClosed }));

    const list = await screen.findByRole("list");

    fireEvent.click(within(list).getByRole("button", { name: /Clone/ }));

    expect(onClone).toHaveBeenCalledWith(31337, "4");
    expect(within(list).getByText("Cloning…")).toBeInTheDocument();

    resolveClone(true);

    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it("stays open when the clone fails", async () => {
    getMarketsMock.mockResolvedValue([
      marketFactory({ id: "31337:4", question: "Pick me?" }),
    ]);
    const onClone = vi.fn(async () => false);
    const onClosed = vi.fn();

    render(box({ onClone, onClosed }));

    const list = await screen.findByRole("list");

    fireEvent.click(within(list).getByRole("button", { name: /Clone/ }));

    await waitFor(() =>
      expect(within(list).getByRole("button", { name: /Clone/ })).toBeEnabled()
    );
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("rejects a pasted id that is not chainId:marketId", async () => {
    getMarketsMock.mockResolvedValue([]);
    const onClone = vi.fn(async () => true);

    render(box({ onClone }));

    await screen.findByText("No markets on the board yet — paste a market id instead.");

    const input = screen.getByLabelText("Market id to clone");

    expect(screen.getByRole("button", { name: "Clone" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "banana" } });
    fireEvent.click(screen.getByRole("button", { name: "Clone" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Use the market id format chainId:marketId, e.g. 31337:4."
    );
    expect(onClone).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "banana:" } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clones a trimmed pasted id and closes on success", async () => {
    getMarketsMock.mockResolvedValue([]);
    const onClone = vi.fn(async () => true);
    const onClosed = vi.fn();

    render(box({ onClone, onClosed }));

    await screen.findByText("No markets on the board yet — paste a market id instead.");

    fireEvent.change(screen.getByLabelText("Market id to clone"), {
      target: { value: " 31337:7 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clone" }));

    expect(onClone).toHaveBeenCalledWith(31337, "7");

    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it("ignores a board load that lands after unmounting", async () => {
    let resolveMarkets!: (loaded: Market[]) => void;
    getMarketsMock.mockReturnValue(
      new Promise<Market[]>((resolve) => {
        resolveMarkets = resolve;
      })
    );

    const { unmount } = render(box());

    unmount();
    resolveMarkets([marketFactory({ id: "31337:4" })]);

    // Flush the settled promise chain; the cancelled load must not re-render.
    await waitFor(() => expect(getMarketsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Start from a market")).not.toBeInTheDocument();
  });

  it("keeps the paste path when the board fails to load", async () => {
    getMarketsMock.mockRejectedValue(new Error("board offline"));

    render(box());

    expect(
      await screen.findByText(
        "No markets on the board yet — paste a market id instead."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Market id to clone")).toBeInTheDocument();
  });
});

function box(overrides: Partial<Parameters<typeof CloneMarketBox>[0]> = {}) {
  return (
    <CloneMarketBox
      onClone={vi.fn(async () => true)}
      onClosed={vi.fn()}
      {...overrides}
    />
  );
}
