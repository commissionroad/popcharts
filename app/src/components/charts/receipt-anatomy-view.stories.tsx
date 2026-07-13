import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  type MatchingBandMatch,
  type MatchingBandReceipt,
} from "./matching-bands-graphic";
import { ReceiptAnatomyView } from "./receipt-anatomy-view";

const receipts: MatchingBandReceipt[] = [
  {
    amountUsd: 320,
    id: "yes-01",
    label: "Early YES sweep",
    placedAtLabel: "09:04",
    placedAtMs: 1,
    priceBand: { fromProbability: 18, toProbability: 61 },
    side: "yes",
  },
  {
    amountUsd: 210,
    id: "no-01",
    label: "First NO response",
    placedAtLabel: "09:16",
    placedAtMs: 2,
    priceBand: { fromProbability: 72, toProbability: 39 },
    side: "no",
  },
  {
    amountUsd: 260,
    id: "yes-02",
    label: "YES adds depth",
    placedAtLabel: "09:29",
    placedAtMs: 3,
    priceBand: { fromProbability: 41, toProbability: 76 },
    side: "yes",
  },
  {
    amountUsd: 170,
    id: "yes-03",
    label: "Unmatched YES drift",
    placedAtLabel: "09:35",
    placedAtMs: 4,
    priceBand: { fromProbability: 76, toProbability: 88 },
    side: "yes",
  },
  {
    amountUsd: 240,
    id: "no-02",
    label: "NO caps the move",
    placedAtLabel: "09:48",
    placedAtMs: 5,
    priceBand: { fromProbability: 64, toProbability: 46 },
    side: "no",
  },
  {
    amountUsd: 190,
    id: "no-03",
    label: "Late NO follow",
    placedAtLabel: "10:02",
    placedAtMs: 6,
    priceBand: { fromProbability: 58, toProbability: 31 },
    side: "no",
  },
];

const matches: MatchingBandMatch[] = [
  {
    id: "match-01",
    priceBand: { fromProbability: 39, toProbability: 48 },
    receiptIds: ["yes-01", "no-01"],
  },
  {
    id: "match-02",
    priceBand: { fromProbability: 48, toProbability: 61 },
    receiptIds: ["yes-01", "no-02"],
  },
  {
    id: "match-03",
    priceBand: { fromProbability: 46, toProbability: 64 },
    receiptIds: ["yes-02", "no-02"],
  },
  {
    id: "match-04",
    priceBand: { fromProbability: 41, toProbability: 58 },
    receiptIds: ["yes-02", "no-03"],
  },
];

const meta = {
  args: {
    initialReceiptId: "yes-01",
    matches,
    receipts,
  },
  component: ReceiptAnatomyView,
  render: (args) => (
    <main className="min-h-screen bg-[var(--color-page-bg)] p-4 sm:p-8">
      <div className="mx-auto w-full max-w-5xl">
        <ReceiptAnatomyView {...args} />
      </div>
    </main>
  ),
  title: "Charts/Receipt Anatomy View",
} satisfies Meta<typeof ReceiptAnatomyView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ExplodedReceipt: Story = {};
