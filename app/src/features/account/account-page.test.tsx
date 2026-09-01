import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountPage,
  type AccountLoginMethod,
  type AccountPageProps,
  type AccountProfile,
  type AccountWallet,
} from "./account-page";

const ADDRESS = "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3";
const SECOND_ADDRESS = "0xc0ffee254729296a45a3885639ac7e10f9d54979";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AccountPage", () => {
  it("renders the error notice instead of the account when the read failed", () => {
    renderPage({ error: "Sign-in service did not respond.", profile: profile() });

    expect(screen.getByText("Account unavailable")).toBeInTheDocument();
    expect(screen.getByText("Sign-in service did not respond.")).toBeInTheDocument();
    expect(screen.queryByText("Active wallet")).not.toBeInTheDocument();
  });

  it("offers a retry only when the caller can service one", () => {
    const onRetry = vi.fn();
    const { rerender } = renderPage({ error: "Nope", onRetry });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<AccountPage error="Nope" />);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("shows the placeholder while loading", () => {
    renderPage({ loading: true });

    expect(screen.getByLabelText("Loading account")).toBeInTheDocument();
  });

  it("shows the placeholder when no profile has arrived yet", () => {
    renderPage({ profile: null });

    expect(screen.getByLabelText("Loading account")).toBeInTheDocument();
  });

  it("leads with the truncated active wallet address and its metadata", () => {
    renderPage({ profile: profile() });

    expect(screen.getByTitle(ADDRESS)).toHaveTextContent("0x8f2...3c3");
    expect(screen.getByText("Browser wallet")).toBeInTheDocument();
    expect(screen.getByText("External wallet")).toBeInTheDocument();
    expect(screen.getByText("Hardhat Local")).toBeInTheDocument();
    expect(screen.queryByText("Not linked to account")).not.toBeInTheDocument();
  });

  it("labels an embedded wallet, hides an unreported chain, and flags an unlinked wallet", () => {
    renderPage({
      profile: profile({
        wallets: [wallet({ chainName: null, linked: false, origin: "embedded" })],
      }),
    });

    expect(screen.getByText("Embedded wallet")).toBeInTheDocument();
    expect(screen.getByText("Not linked to account")).toBeInTheDocument();
    expect(screen.queryByText("Hardhat Local")).not.toBeInTheDocument();
  });

  it("explains the no-wallet state rather than rendering an empty card", () => {
    renderPage({ profile: profile({ wallets: [] }) });

    expect(screen.getByText("No active wallet")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy address" })
    ).not.toBeInTheDocument();
  });

  it("copies the full address through the supplied handler and confirms it", () => {
    const onCopyAddress = vi.fn();
    renderPage({ onCopyAddress, profile: profile() });

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    expect(onCopyAddress).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("falls back to the clipboard API when no copy handler is supplied", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderPage({ onCopyAddress: undefined, profile: profile() });
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
  });

  it("drops the copied confirmation back to the idle label", () => {
    const timeouts: (() => void)[] = [];
    vi.spyOn(window, "setTimeout").mockImplementation((handler) => {
      timeouts.push(handler as () => void);

      return 1 as unknown as ReturnType<typeof window.setTimeout>;
    });

    renderPage({ profile: profile() });
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    act(() => {
      timeouts.forEach((run) => run());
    });

    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  });

  it("clears the copied timeout when the page unmounts", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderPage({ profile: profile() });

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("lists each linked sign-in method with its label, detail, and link time", () => {
    renderPage({
      profile: profile({
        loginMethods: [
          {
            detail: "avery@example.com",
            kind: "email",
            linkedAt: "2026-06-14T18:03:00.000Z",
            primary: true,
          },
          { detail: "avery@example.com", kind: "google" },
          { detail: "Work laptop", kind: "passkey" },
          { detail: "+1 415 555 0134", kind: "sms" },
          { detail: ADDRESS, kind: "wallet" },
        ],
      }),
    });

    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Passkey")).toBeInTheDocument();
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("Jun 14, 2026, 6:03 PM UTC")).toBeInTheDocument();
    expect(screen.getByText("This session")).toBeInTheDocument();
    // The wallet method's detail is an address, so it truncates like one.
    expect(screen.getAllByText("0x8f2...3c3").length).toBeGreaterThan(1);
  });

  it("tells a freshly connected account that nothing is linked yet", () => {
    renderPage({ profile: profile({ loginMethods: [], wallets: [] }) });

    expect(screen.getByText(/Nothing is linked yet/)).toBeInTheDocument();
  });

  it("offers a link action for every method the account is missing", () => {
    const onLinkMethod = vi.fn();
    renderPage({
      onLinkMethod,
      profile: profile({
        loginMethods: [{ detail: "avery@example.com", kind: "email" }],
      }),
    });

    expect(
      screen.queryByRole("button", { name: "Link email" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Link google" }));

    expect(onLinkMethod).toHaveBeenCalledWith("google");
  });

  it("hides the link actions when every method is already linked", () => {
    const onLinkMethod = vi.fn();
    renderPage({
      onLinkMethod,
      profile: profile({
        loginMethods: (["email", "google", "passkey", "sms", "wallet"] as const).map(
          (kind) => ({ detail: kind, kind })
        ),
      }),
    });

    expect(screen.queryByRole("button", { name: /^Link / })).not.toBeInTheDocument();
  });

  it("hides the link actions when the caller cannot service a link", () => {
    renderPage({ onLinkMethod: undefined, profile: profile({ loginMethods: [] }) });

    expect(screen.queryByRole("button", { name: /^Link / })).not.toBeInTheDocument();
  });

  it("lists the non-active wallets and promotes one on request", () => {
    const onSetActiveWallet = vi.fn();
    renderPage({
      onSetActiveWallet,
      profile: profile({
        wallets: [
          wallet(),
          wallet({
            active: false,
            address: SECOND_ADDRESS,
            chainName: null,
            label: "Injected wallet",
            linked: false,
          }),
        ],
      }),
    });

    expect(screen.getByText("Other linked wallets")).toBeInTheDocument();
    expect(screen.getByText("Injected wallet - not linked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make active" }));

    expect(onSetActiveWallet).toHaveBeenCalledWith(SECOND_ADDRESS);
  });

  it("describes a second wallet's chain when it reports one", () => {
    renderPage({
      profile: profile({
        wallets: [wallet(), wallet({ active: false, address: SECOND_ADDRESS })],
      }),
    });

    expect(screen.getByText("Browser wallet - Hardhat Local")).toBeInTheDocument();
  });

  it("omits the promote action when the caller cannot service it", () => {
    renderPage({
      onSetActiveWallet: undefined,
      profile: profile({
        wallets: [wallet(), wallet({ active: false, address: SECOND_ADDRESS })],
      }),
    });

    expect(
      screen.queryByRole("button", { name: "Make active" })
    ).not.toBeInTheDocument();
  });

  it("omits the other-wallets card when the account has only the active wallet", () => {
    renderPage({ profile: profile() });

    expect(screen.queryByText("Other linked wallets")).not.toBeInTheDocument();
  });

  it("asks for confirmation before disconnecting and can be backed out of", () => {
    const onConfirmDisconnect = vi.fn();
    renderPage({ onConfirmDisconnect, profile: profile() });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByText(/Signing out ends this session/)).toBeInTheDocument();
    expect(onConfirmDisconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(screen.queryByText(/Signing out ends this session/)).not.toBeInTheDocument();
  });

  it("disconnects once the confirmation is accepted", () => {
    const onConfirmDisconnect = vi.fn();
    renderPage({
      defaultDisconnectOpen: true,
      onConfirmDisconnect,
      profile: profile(),
    });

    fireEvent.click(screen.getByRole("button", { name: "Yes, disconnect" }));

    expect(onConfirmDisconnect).toHaveBeenCalledTimes(1);
  });

  it("locks both confirmation buttons while the sign-out is in flight", () => {
    renderPage({
      defaultDisconnectOpen: true,
      disconnectPending: true,
      profile: profile(),
    });

    expect(screen.getByRole("button", { name: "Disconnecting" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stay signed in" })).toBeDisabled();
  });

  it("keeps the confirmation open with the reason when the sign-out failed", () => {
    renderPage({
      defaultDisconnectOpen: true,
      disconnectError: "Could not reach the sign-in service.",
      profile: profile(),
    });

    expect(
      screen.getByText("Could not reach the sign-in service.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, disconnect" })).toBeEnabled();
  });
});

function renderPage(props: AccountPageProps = {}) {
  return render(<AccountPage onCopyAddress={() => undefined} {...props} />);
}

function wallet(overrides: Partial<AccountWallet> = {}): AccountWallet {
  return {
    active: true,
    address: ADDRESS,
    chainName: "Hardhat Local",
    label: "Browser wallet",
    linked: true,
    origin: "external",
    ...overrides,
  };
}

function profile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  const loginMethod: AccountLoginMethod = { detail: ADDRESS, kind: "wallet" };

  return {
    loginMethods: [loginMethod],
    wallets: [wallet()],
    ...overrides,
  };
}
