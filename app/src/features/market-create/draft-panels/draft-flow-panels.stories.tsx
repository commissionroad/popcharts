import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { createInitialMarketDraft } from "@/domain/market-creation/create-market";
import { buildCreateMarketPreview } from "@/domain/market-creation/create-market";
import { marketDraftFactory } from "@/test/factories/drafts";

import { ApprovedPanel } from "./approved-panel";
import { DraftPreviewPanel } from "./draft-preview-panel";
import { PublishedPanel } from "./published-panel";
import { ReviewProgressPanel } from "./review-progress-panel";
import { SaveIndicator } from "./save-indicator";

/** Frames each sidebar panel at its real aside width on the app background. */
const AsideFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 420 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  decorators: [AsideFrame],
  parameters: { layout: "fullscreen" },
  title: "Market create/Draft flow panels",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const filledDraft = {
  ...createInitialMarketDraft(new Date("2026-07-30T12:00:00Z")),
  question: "Will bitcoin close above $100k on 2027-01-01?",
  resolutionCriteria: "Resolves YES per the CoinGecko daily close.",
  resolutionSources: "https://www.coingecko.com",
};

/** The edit-stage panel with a filled draft, ready to submit. */
export const EditStage: Story = {
  render: () => (
    <DraftPreviewPanel
      canPersist
      draft={filledDraft}
      errorCount={0}
      isSubmitting={false}
      onSubmit={() => undefined}
      preview={buildCreateMarketPreview(filledDraft)}
    />
  ),
};

/** The edit-stage panel before a wallet is connected. */
export const EditStageDisconnected: Story = {
  render: () => (
    <DraftPreviewPanel
      canPersist={false}
      draft={createInitialMarketDraft(new Date("2026-07-30T12:00:00Z"))}
      errorCount={2}
      isSubmitting={false}
      onSubmit={() => undefined}
      preview={buildCreateMarketPreview(filledDraft)}
    />
  ),
};

/** The animated in-review state while the AI reads the draft. */
export const InReview: Story = {
  render: () => (
    <ReviewProgressPanel question="Will bitcoin close above $100k on 2027-01-01?" />
  ),
};

/** The approved state with the Publish & pay call to action. */
export const Approved: Story = {
  render: () => (
    <ApprovedPanel
      creationFeeLabel="1 native USDC"
      draft={marketDraftFactory({ status: "approved" })}
      graduationThreshold={2500}
      isPublishing={false}
      onPublish={() => undefined}
      walletAction={null}
    />
  ),
};

/** Publish blocked on a wallet action (connect / switch chain). */
export const ApprovedWalletBlocked: Story = {
  render: () => (
    <ApprovedPanel
      creationFeeLabel="1 native USDC"
      draft={marketDraftFactory({ status: "approved" })}
      graduationThreshold={2500}
      isPublishing={false}
      onPublish={() => undefined}
      walletAction={{
        disabled: false,
        kind: "connect",
        label: "Connect wallet",
        message: "Connect a wallet on the devchain to publish this market.",
        run: () => undefined,
      }}
    />
  ),
};

/** The market-live celebration with links and the template shelf action. */
export const Published: Story = {
  render: () => (
    <PublishedPanel
      draft={marketDraftFactory({
        publishedChainId: 31337,
        publishedMarketId: "4",
        publishedTransactionHash: `0x${"cd".repeat(32)}`,
        status: "published",
      })}
      onSaveTemplate={() => undefined}
      onStartFresh={() => undefined}
      templateSaved={false}
    />
  ),
};

/** Every autosave chip state side by side. */
export const SaveStates: Story = {
  render: () => (
    <>
      <SaveIndicator
        canPersist={false}
        draftId={null}
        isSaving={false}
        savedAt={null}
      />
      <SaveIndicator canPersist draftId={null} isSaving={false} savedAt={null} />
      <SaveIndicator canPersist draftId="12" isSaving savedAt={null} />
      <SaveIndicator
        canPersist
        draftId="12"
        isSaving={false}
        savedAt="2026-07-30T12:00:00.000Z"
      />
    </>
  ),
};
