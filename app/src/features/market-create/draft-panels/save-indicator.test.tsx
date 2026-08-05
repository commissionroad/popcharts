import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SaveIndicator } from "./save-indicator";

describe("SaveIndicator", () => {
  it("nudges toward connecting when drafts cannot persist", () => {
    render(indicator({ canPersist: false }));

    expect(screen.getByText("Connect a wallet to save drafts")).toBeInTheDocument();
  });

  it("shows the in-flight save state", () => {
    render(indicator({ isSaving: true }));

    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it("names the saved draft once a save has landed", () => {
    render(indicator({ draftId: "12", savedAt: "2026-07-30T12:00:00.000Z" }));

    expect(screen.getByText("Saved · draft #12")).toBeInTheDocument();
  });

  it("explains autosave before the first save", () => {
    render(indicator());

    expect(screen.getByText("Drafts autosave as you type")).toBeInTheDocument();
  });

  it("keeps the autosave hint when a save time has no draft id", () => {
    render(indicator({ savedAt: "2026-07-30T12:00:00.000Z" }));

    expect(screen.getByText("Drafts autosave as you type")).toBeInTheDocument();
  });

  it("keeps the autosave hint when a draft id has no save time", () => {
    render(indicator({ draftId: "12" }));

    expect(screen.getByText("Drafts autosave as you type")).toBeInTheDocument();
  });
});

function indicator(overrides: Partial<Parameters<typeof SaveIndicator>[0]> = {}) {
  return (
    <SaveIndicator
      canPersist
      draftId={null}
      isSaving={false}
      savedAt={null}
      {...overrides}
    />
  );
}
