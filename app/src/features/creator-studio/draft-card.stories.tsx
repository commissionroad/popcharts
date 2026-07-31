import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { draftReviewFactory, marketDraftFactory } from "@/test/factories/drafts";

import { DraftCard } from "./draft-card";

/** Frames cards at the studio's grid width on the app background. */
const GridFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ maxWidth: 380 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  args: {
    busy: false,
    onClone: () => undefined,
    onDelete: () => undefined,
    onToggleTemplate: () => undefined,
  },
  component: DraftCard,
  decorators: [GridFrame],
  parameters: { layout: "fullscreen" },
  title: "Creator studio/Draft card",
} satisfies Meta<typeof DraftCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A work-in-progress draft, untouched by review. */
export const Editing: Story = {
  args: { draft: marketDraftFactory() },
};

/** Locked while the AI review runs. */
export const InReview: Story = {
  args: { draft: marketDraftFactory({ status: "in_review" }) },
};

/** The reviewer asked for changes; the summary line carries its verdict. */
export const NeedsFixes: Story = {
  args: {
    draft: marketDraftFactory({
      latestReview: draftReviewFactory(),
      status: "changes_requested",
    }),
  },
};

/** Rejected on policy grounds. */
export const Rejected: Story = {
  args: {
    draft: marketDraftFactory({
      latestReview: draftReviewFactory({
        feedback: {
          items: [],
          summary: "This market can't run as written — address the blockers below.",
        },
        verdict: "reject",
      }),
      status: "rejected",
    }),
  },
};

/** Approved and waiting for Publish & pay. */
export const Approved: Story = {
  args: {
    draft: marketDraftFactory({
      latestReview: draftReviewFactory({
        feedback: {
          items: [],
          summary: "Approved — this market is ready to publish.",
        },
        verdict: "approve",
      }),
      status: "approved",
    }),
  },
};

/** Live on-chain, with the market link. */
export const Live: Story = {
  args: {
    draft: marketDraftFactory({
      publishedChainId: 31337,
      publishedMarketId: "4",
      status: "published",
    }),
  },
};

/** On the template shelf. */
export const Template: Story = {
  args: { draft: marketDraftFactory({ isTemplate: true }) },
};

/** Dimmed while a mutation is in flight. */
export const Busy: Story = {
  args: { busy: true, draft: marketDraftFactory() },
};
