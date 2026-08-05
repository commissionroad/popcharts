import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { PanelPreviewContext } from "../../../.storybook/mocks/panel-hooks";
import { ReviewCreditTopUpDialog } from "./review-credit-top-up-dialog";

/** Connects the storybook deposit stub so the presets render enabled. */
const ConnectedWallet: Decorator = (Story) => (
  <PanelPreviewContext.Provider
    value={{
      address: "0x1111111111111111111111111111111111111111",
      loading: false,
      portfolio: null,
    }}
  >
    <div style={{ background: "var(--color-page-bg)", minHeight: 420 }}>
      <Story />
    </div>
  </PanelPreviewContext.Provider>
);

const meta = {
  component: ReviewCreditTopUpDialog,
  decorators: [ConnectedWallet],
  parameters: { layout: "fullscreen" },
  title: "Review credit/Top-up dialog",
} satisfies Meta<typeof ReviewCreditTopUpDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

const BENEFICIARY = "0x1111111111111111111111111111111111111111";

/**
 * The dialog as it opens: three presets, the non-refundable warning, and the
 * account a deposit credits. There is no closed story — the parent mounts
 * this only while it is open, so every opening starts from a clean deposit
 * state rather than the last one's result.
 */
export const Open: Story = {
  args: {
    beneficiary: BENEFICIARY,
    onClose: () => undefined,
  },
};

/**
 * No wallet resolved yet: the presets are disabled and the copy falls back to
 * naming the connected wallet rather than printing a blank address.
 */
export const WithoutBeneficiary: Story = {
  args: {
    beneficiary: null,
    onClose: () => undefined,
  },
};
