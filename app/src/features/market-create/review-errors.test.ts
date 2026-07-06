import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countErrors,
  focusFirstReviewError,
  getLiveDeadlineErrors,
} from "./review-errors";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("countErrors", () => {
  it("counts erroring fields", () => {
    expect(countErrors({})).toBe(0);
    expect(
      countErrors({ question: "Add a question.", resolutionTime: "Too soon." })
    ).toBe(2);
  });
});

describe("focusFirstReviewError", () => {
  it("scrolls to and focuses the first erroring field in form order", () => {
    runAnimationFramesImmediately();
    const question = addField("question");
    const criteria = addField("resolution-criteria");
    const scrolled = question.scrollIntoView;
    const focused = vi.spyOn(question, "focus").mockReturnValue();

    focusFirstReviewError({
      question: "Add a question.",
      resolutionCriteria: "Add criteria.",
    });

    expect(scrolled).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(focused).toHaveBeenCalledWith({ preventScroll: true });
    expect(criteria).not.toBe(document.activeElement);
  });

  it("skips fields that have no focusable control", () => {
    runAnimationFramesImmediately();
    // liquidityParameter has no target id; resolutionTime does.
    const resolutionTime = addField("resolution-time");
    const focused = vi.spyOn(resolutionTime, "focus").mockReturnValue();

    focusFirstReviewError({
      liquidityParameter: "Too small.",
      resolutionTime: "Too soon.",
    });

    expect(focused).toHaveBeenCalled();
  });

  it("does nothing when no erroring field is focusable", () => {
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");

    focusFirstReviewError({ liquidityParameter: "Too small." });
    focusFirstReviewError({});

    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("tolerates a missing DOM node for the erroring field", () => {
    runAnimationFramesImmediately();

    expect(() => focusFirstReviewError({ question: "Add a question." })).not.toThrow();
  });
});

describe("getLiveDeadlineErrors", () => {
  it("keeps only deadline errors", () => {
    expect(
      getLiveDeadlineErrors({
        graduationTime: "Graduation must be in the future.",
        question: "Add a question.",
        resolutionTime: "Resolution must follow graduation.",
      })
    ).toEqual({
      graduationTime: "Graduation must be in the future.",
      resolutionTime: "Resolution must follow graduation.",
    });
  });

  it("returns no errors for a clean draft", () => {
    expect(getLiveDeadlineErrors({ question: "Add a question." })).toEqual({});
    expect(getLiveDeadlineErrors({})).toEqual({});
  });
});

function addField(id: string) {
  const element = document.createElement("input");
  element.id = id;
  // jsdom does not implement scrollIntoView; give the element a mock so the
  // production call has something to land on.
  element.scrollIntoView = vi.fn();
  document.body.appendChild(element);

  return element;
}

function runAnimationFramesImmediately() {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);

    return 0;
  });
}
