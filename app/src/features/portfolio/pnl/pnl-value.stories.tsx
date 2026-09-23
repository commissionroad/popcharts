import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { WAD } from "@/domain/tokens/wad";

import { PnlValue } from "./pnl-value";

const Frame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <Story />
  </div>
);

const meta = {
  component: PnlValue,
  decorators: [Frame],
  parameters: { layout: "fullscreen" },
  title: "Portfolio/P&L value",
} satisfies Meta<typeof PnlValue>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A gain: up arrow, leading `+`, positive tone. */
export const Gain: Story = {
  args: { amountWad: (WAD * 2240n) / 100n, returnBps: 5600 },
};

/** A loss: down arrow, leading `-`, negative tone. */
export const Loss: Story = {
  args: { amountWad: (WAD * -2400n) / 100n, returnBps: -4363 },
};

/** Break-even: a dash glyph and secondary tone, not a near-zero gain. */
export const BreakEven: Story = {
  args: { amountWad: 0n, returnBps: 0 },
};

/** No mark price — a dash, never a `$0.00` that would read as a wipeout. */
export const Unpriced: Story = {
  args: { amountWad: null },
};

/** The header size, used for the portfolio rollup. */
export const Headline: Story = {
  args: { amountWad: (WAD * 11890n) / 100n, returnBps: 2417, size: "lg" },
};
