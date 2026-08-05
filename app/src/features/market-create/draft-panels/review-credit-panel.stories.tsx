import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { PanelPreviewContext } from "../../../../.storybook/mocks/panel-hooks";
import { ReviewCreditPanel } from "./review-credit-panel";

/** Frames the sidebar panel at its real aside width on the app background. */
const AsideFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 420 }}>
      <Story />
    </div>
  </div>
);

/** Connects the storybook credit stub so the deposit presets render live. */
const ConnectedWallet: Decorator = (Story) => (
  <PanelPreviewContext.Provider
    value={{
      address: "0x1111111111111111111111111111111111111111",
      loading: false,
      portfolio: null,
    }}
  >
    <Story />
  </PanelPreviewContext.Provider>
);

const meta = {
  component: ReviewCreditPanel,
  decorators: [AsideFrame, ConnectedWallet],
  parameters: { layout: "fullscreen" },
  title: "Market create/Review credit panel",
} satisfies Meta<typeof ReviewCreditPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A fresh wallet with no credit at all: zero everywhere, first deposit. */
export const FirstDeposit: Story = {
  args: {
    beneficiary: "0x1111111111111111111111111111111111111111",
    fetchCredit: null,
    onDismiss: () => undefined,
    onFunded: () => undefined,
    shortfall: {
      availableWad: "0",
      message:
        "You're out of review credit. Deposit to keep submitting — credit is spent per review and isn't refundable.",
      requiredWad: "100000000000000000",
      runsUsed: 0,
    },
  },
};

/** A returning creator who has burned through their credit iterating. */
export const CreditExhausted: Story = {
  args: {
    beneficiary: "0x1111111111111111111111111111111111111111",
    fetchCredit: null,
    onDismiss: () => undefined,
    onFunded: () => undefined,
    shortfall: {
      availableWad: "50000000000000000",
      message:
        "You're out of review credit. Deposit to keep submitting — credit is spent per review and isn't refundable.",
      requiredWad: "100000000000000000",
      runsUsed: 19,
    },
  },
};
