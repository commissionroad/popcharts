import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { draftFeedbackItemFactory, draftReviewFactory } from "@/test/factories/drafts";

import { FeedbackPanel } from "./feedback-panel";

/** Frames the sidebar panel at its real aside width on the app background. */
const AsideFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 420 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  component: FeedbackPanel,
  decorators: [AsideFrame],
  parameters: { layout: "fullscreen" },
  title: "Market create/Draft feedback panel",
} satisfies Meta<typeof FeedbackPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A quality review: soft findings the creator can act on, phrased as
 * "changes requested" with per-field advice and the score disclosure.
 */
export const ChangesRequested: Story = {
  args: {
    isResubmitting: false,
    onEdit: () => undefined,
    onResubmit: () => undefined,
    review: draftReviewFactory({
      feedback: {
        items: [
          draftFeedbackItemFactory(),
          draftFeedbackItemFactory({
            field: "resolutionSources",
            howToFix:
              "Name one to three public sources (outlet names or URLs) a stranger could check to settle this.",
            issue: "No strong resolution source is named.",
            severity: "info",
            title: "Add resolution sources",
          }),
        ],
        summary: "Almost there — fix the flagged issues below and resubmit for review.",
      },
    }),
    verdict: "changes_requested",
  },
};

/**
 * A policy rejection: a hard blocker with unambiguous copy, the red header
 * treatment, and the same fix/resubmit affordances.
 */
export const Rejected: Story = {
  args: {
    isResubmitting: false,
    onEdit: () => undefined,
    onResubmit: () => undefined,
    review: draftReviewFactory({
      feedback: {
        items: [
          draftFeedbackItemFactory({
            field: "question",
            howToFix:
              "Rewrite it so a stranger could settle it from public information alone: name public subjects and point at sources anyone can check.",
            issue:
              "Only you (or your circle) could know the outcome — the public can't verify it.",
            severity: "blocker",
            title: "Make it publicly checkable",
          }),
        ],
        summary: "This market can't run as written — address the blockers below.",
      },
      scores: {
        contentSafety: 5,
        corroboration: 0,
        disputeRisk: 2,
        objectivity: 4,
        promptInjectionRisk: 0,
        publicKnowability: 0,
        sourceQuality: 2,
      },
      verdict: "reject",
    }),
    verdict: "rejected",
  },
};

/** The resubmit button in its in-flight state. */
export const Resubmitting: Story = {
  args: {
    ...ChangesRequested.args,
    isResubmitting: true,
  },
};
