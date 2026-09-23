import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import {
  AccountPage,
  type AccountLoginMethod,
  type AccountProfile,
  type AccountWallet,
} from "./account-page";

const EXTERNAL_WALLET = "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3";
const EMBEDDED_WALLET = "0x1a4b7c9d2e5f8091a3b6c4d7e0f2a5b8c1d4e7f0";
const SECOND_WALLET = "0xc0ffee254729296a45a3885639ac7e10f9d54979";

function wallet(overrides: Partial<AccountWallet> = {}): AccountWallet {
  return {
    active: true,
    address: EXTERNAL_WALLET,
    chainName: "Hardhat Local",
    label: "Browser wallet",
    linked: true,
    origin: "external",
    ...overrides,
  };
}

function method(overrides: Partial<AccountLoginMethod> = {}): AccountLoginMethod {
  return {
    detail: EXTERNAL_WALLET,
    kind: "wallet",
    linkedAt: "2026-07-01T09:12:00.000Z",
    ...overrides,
  };
}

function profile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    loginMethods: [method({ primary: true })],
    wallets: [wallet()],
    ...overrides,
  };
}

/** Frames the page against the app's dark background at a realistic width. */
const PageFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ maxWidth: 960 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  args: {
    onConfirmDisconnect: () => undefined,
    onCopyAddress: () => undefined,
    onLinkMethod: () => undefined,
    onSetActiveWallet: () => undefined,
  },
  component: AccountPage,
  decorators: [PageFrame],
  parameters: { layout: "fullscreen" },
  title: "Account/Account page",
} satisfies Meta<typeof AccountPage>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The wallet-first user: they arrived with their own wallet and never linked
 * anything else, so the wallet is both the active signer and the only way
 * back in. The link buttons are the whole point of the sign-in card here.
 */
export const WalletOnly: Story = {
  args: { profile: profile() },
};

/**
 * The common social path: email and Google linked, transacting from the
 * embedded wallet created at sign-up. The address is the one thing they have
 * never seen before, so it leads and carries the copy affordance.
 */
export const EmailAndGoogleLinked: Story = {
  args: {
    profile: profile({
      loginMethods: [
        method({
          detail: "avery@example.com",
          kind: "email",
          linkedAt: "2026-06-14T18:03:00.000Z",
        }),
        method({
          detail: "avery@example.com",
          kind: "google",
          linkedAt: "2026-06-14T18:04:00.000Z",
          primary: true,
        }),
      ],
      wallets: [
        wallet({
          address: EMBEDDED_WALLET,
          label: "Pop Charts wallet",
          origin: "embedded",
        }),
      ],
    }),
  },
};

/**
 * Everything linked, and a second wallet alongside the active one — the
 * densest the page gets. Worth looking at for the row rhythm and for whether
 * "active" still reads unambiguously with another wallet on screen.
 */
export const SeveralLinkedMethods: Story = {
  args: {
    profile: profile({
      loginMethods: [
        method({
          detail: "avery@example.com",
          kind: "email",
          linkedAt: "2026-06-14T18:03:00.000Z",
        }),
        method({
          detail: "avery@example.com",
          kind: "google",
          linkedAt: "2026-06-14T18:04:00.000Z",
          primary: true,
        }),
        method({
          detail: "Work laptop",
          kind: "passkey",
          linkedAt: "2026-06-20T11:41:00.000Z",
        }),
        method({
          detail: "+1 415 555 0134",
          kind: "sms",
          linkedAt: "2026-07-02T08:22:00.000Z",
        }),
        method({ detail: EXTERNAL_WALLET, linkedAt: "2026-07-05T15:00:00.000Z" }),
      ],
      wallets: [
        wallet({
          address: EMBEDDED_WALLET,
          label: "Pop Charts wallet",
          origin: "embedded",
        }),
        wallet({ active: false }),
        wallet({
          active: false,
          address: SECOND_WALLET,
          chainName: null,
          label: "Injected wallet",
          linked: false,
        }),
      ],
    }),
  },
};

/**
 * Straight after a first sign-in: the session exists, nothing is linked, and
 * no wallet has been created yet. Both cards are in their empty state at
 * once, which is the only time that happens — so it is the state most likely
 * to read as broken if the copy is not carrying it.
 */
export const FreshlyConnected: Story = {
  args: {
    profile: profile({ loginMethods: [], wallets: [] }),
  },
};

/**
 * A signed-in account whose wallet is connected to the session but not linked
 * to the account — it signs today and is gone at the next sign-in. The
 * warning pill is the only thing that says so.
 */
export const UnlinkedActiveWallet: Story = {
  args: {
    profile: profile({
      loginMethods: [
        method({
          detail: "avery@example.com",
          kind: "email",
          linkedAt: "2026-06-14T18:03:00.000Z",
          primary: true,
        }),
      ],
      wallets: [wallet({ linked: false })],
    }),
  },
};

/**
 * The disconnect confirmation, opened. The body has to answer the question
 * the button provokes — "do I lose my receipts?" — before the user has to ask
 * it.
 */
export const DisconnectConfirmation: Story = {
  args: {
    defaultDisconnectOpen: true,
    profile: profile({
      loginMethods: [
        method({
          detail: "avery@example.com",
          kind: "email",
          linkedAt: "2026-06-14T18:03:00.000Z",
          primary: true,
        }),
      ],
    }),
  },
};

/** The sign-out in flight: both buttons locked, the label saying why. */
export const DisconnectPending: Story = {
  args: {
    defaultDisconnectOpen: true,
    disconnectPending: true,
    profile: profile(),
  },
};

/**
 * A sign-out that failed. The panel stays open with the reason attached, so
 * the retry is one click away rather than a fresh trip through the button.
 */
export const DisconnectFailed: Story = {
  args: {
    defaultDisconnectOpen: true,
    disconnectError: "Could not reach the sign-in service. Try again.",
    profile: profile(),
  },
};

/** Reading the account. Cards hold their heights so nothing jumps on arrival. */
export const Loading: Story = {
  args: { loading: true, profile: null },
};

/** The account read failed outright — nothing to show, one way forward. */
export const ErrorState: Story = {
  args: {
    error: "Could not load your account. The sign-in service did not respond.",
    onRetry: () => undefined,
    profile: null,
  },
};
