import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { marketDraftFactory } from "@/test/factories/drafts";

import { StudioPage } from "./studio-page";
import type { useStudio } from "./use-studio";

const useStudioMock = vi.hoisted(() => vi.fn());

vi.mock("./use-studio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-studio")>()),
  useStudio: useStudioMock,
}));

vi.mock("./clone-market-box", () => ({
  CloneMarketBox: ({
    onClone,
    onClosed,
  }: {
    onClone: (chainId: number, marketId: string) => Promise<boolean>;
    onClosed: () => void;
  }) => (
    <div>
      <span>Clone box stub</span>
      <button onClick={() => void onClone(31337, "4")} type="button">
        stub clone
      </button>
      <button onClick={onClosed} type="button">
        stub close
      </button>
    </div>
  ),
}));

beforeEach(() => {
  useStudioMock.mockReset();
});

describe("StudioPage", () => {
  it("shows the studio header with the new-draft entry point", () => {
    stubStudio();

    render(<StudioPage />);

    expect(screen.getByText("Creator studio")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your drafts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New draft/ })).toHaveAttribute(
      "href",
      "/create"
    );
    expect(screen.getByText(/Drafts are free and private\./)).toBeInTheDocument();
  });

  it("asks for a wallet when drafts cannot persist", () => {
    stubStudio({ canPersist: false });

    render(<StudioPage />);

    expect(screen.getByText("Connect to open your studio")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Connect a wallet and your drafts, templates, and live markets appear here."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("surfaces studio errors", () => {
    stubStudio({ error: "The draft service hit a snag — try again." });

    render(<StudioPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The draft service hit a snag — try again."
    );
  });

  it("shows the loading note while the drafts load", () => {
    stubStudio({ isLoading: true });

    render(<StudioPage />);

    expect(screen.getByText("Loading your drafts…")).toBeInTheDocument();
  });

  it("explains an empty template shelf", () => {
    stubStudio({ shelf: "templates" });

    render(<StudioPage />);

    expect(screen.getByText("No templates yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Save any draft as a template and it lands on this shelf, ready to clone."
      )
    ).toBeInTheDocument();
  });

  it("invites a first draft when there are none at all", () => {
    stubStudio();

    render(<StudioPage />);

    expect(screen.getByText("No drafts yet")).toBeInTheDocument();
    expect(
      screen.getByText("Start a draft and it autosaves here while you iterate.")
    ).toBeInTheDocument();
  });

  it("distinguishes an empty shelf from having no drafts", () => {
    stubStudio({ drafts: [draftFixture(1)], shelf: "approved" });

    render(<StudioPage />);

    expect(screen.getByText("Shelf is empty")).toBeInTheDocument();
    expect(screen.getByText("Nothing on this shelf right now.")).toBeInTheDocument();
  });

  it("renders the draft grid and routes card actions through the studio", () => {
    const draftOne = draftFixture(1);
    const draftTwo = draftFixture(2);
    const studio = stubStudio({
      busyDraftId: 2,
      drafts: [draftOne, draftTwo],
      visibleDrafts: [draftOne, draftTwo],
    });

    render(<StudioPage />);

    const cardOne = screen.getByTestId("draft-card-1");
    const cardTwo = screen.getByTestId("draft-card-2");

    fireEvent.click(within(cardOne).getByRole("button", { name: "Clone" }));
    fireEvent.click(within(cardOne).getByRole("button", { name: "Template" }));
    fireEvent.click(within(cardOne).getByRole("button", { name: "Delete" }));

    expect(studio.cloneDraft).toHaveBeenCalledWith(1);
    expect(studio.toggleTemplate).toHaveBeenCalledWith(draftOne);
    expect(studio.removeDraft).toHaveBeenCalledWith(1);
    expect(within(cardTwo).getByRole("button", { name: "Clone" })).toBeDisabled();
  });

  it("changes shelves through the segmented control", () => {
    const studio = stubStudio();

    render(<StudioPage />);

    fireEvent.click(screen.getByRole("button", { name: "In review" }));

    expect(studio.setShelf).toHaveBeenCalledWith("in_review");
  });

  it("toggles the clone box and wires it to the studio", () => {
    const studio = stubStudio();

    render(<StudioPage />);

    expect(screen.queryByText("Clone box stub")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Start from a market/ }));

    expect(screen.getByText("Clone box stub")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "stub clone" }));

    expect(studio.cloneFromMarket).toHaveBeenCalledWith(31337, "4");

    fireEvent.click(screen.getByRole("button", { name: "stub close" }));

    expect(screen.queryByText("Clone box stub")).not.toBeInTheDocument();
  });

  it("closes the clone box when its trigger is clicked again", () => {
    stubStudio();

    render(<StudioPage />);

    const trigger = screen.getByRole("button", { name: /Start from a market/ });

    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(screen.queryByText("Clone box stub")).not.toBeInTheDocument();
  });
});

type StudioState = ReturnType<typeof useStudio>;

function draftFixture(id: number) {
  return marketDraftFactory({
    id,
    question: `Draft question ${id}?`,
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  });
}

function stubStudio(overrides: Partial<StudioState> = {}): StudioState {
  const state: StudioState = {
    busyDraftId: null,
    canPersist: true,
    cloneDraft: vi.fn(async () => {}),
    cloneFromMarket: vi.fn(async () => true),
    drafts: [],
    error: null,
    isLoading: false,
    refresh: vi.fn(),
    removeDraft: vi.fn(async () => {}),
    setShelf: vi.fn(),
    shelf: "all",
    toggleTemplate: vi.fn(async () => {}),
    visibleDrafts: [],
    walletReady: true,
    ...overrides,
  };

  useStudioMock.mockReturnValue(state);

  return state;
}
