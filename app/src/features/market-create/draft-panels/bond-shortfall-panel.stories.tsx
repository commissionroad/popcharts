import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { PanelPreviewContext } from "../../../../.storybook/mocks/panel-hooks";
import { BondShortfallPanel } from "./bond-shortfall-panel";

/** Frames the sidebar panel at its real aside width on the app background. */
const AsideFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 420 }}>
      <Story />
    </div>
  </div>
);

/** Connects the storybook review-bond stub so the deposit CTA renders live. */
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
  component: BondShortfallPanel,
  decorators: [AsideFrame, ConnectedWallet],
  parameters: { layout: "fullscreen" },
  title: "Market create/Bond shortfall panel",
} satisfies Meta<typeof BondShortfallPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A first submission with nothing bonded: the $5 standing-bond floor drives
 * the suggested deposit.
 */
export const StandingBondFloor: Story = {
  args: {
    onDismiss: () => undefined,
    onFunded: () => undefined,
    shortfall: {
      availableWad: "0",
      message:
        "Add a review bond to submit — your balance is below the $5 standing floor.",
      minimumStandingBondWad: "5000000000000000000",
      requiredWad: "1000000000000000000",
      standingBondWad: "0",
    },
  },
};

/**
 * A returning creator whose remaining balance no longer covers a submission:
 * $5 bonded, $0.10 still available, $0.20 required — a $0.10 top-up.
 */
export const TopUp: Story = {
  args: {
    onDismiss: () => undefined,
    onFunded: () => undefined,
    shortfall: {
      availableWad: "100000000000000000",
      message:
        "Your available bond doesn't cover this submission — top it up to continue.",
      minimumStandingBondWad: "5000000000000000000",
      requiredWad: "200000000000000000",
      standingBondWad: "5000000000000000000",
    },
  },
};
