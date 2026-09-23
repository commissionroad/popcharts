"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  Mail,
  Smartphone,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatAddress, formatDateTime } from "@/lib/format";

/**
 * The sign-in methods an account can carry. These mirror the auth provider's
 * own vocabulary (`loginMethods` in `integrations/wallet/wallet-config.ts`)
 * so the page can name what the user actually signed in with.
 */
export type AccountLoginMethodKind = "email" | "google" | "passkey" | "sms" | "wallet";

export type AccountLoginMethod = {
  /** The address, handle, or number the method is keyed on. */
  detail: string;
  kind: AccountLoginMethodKind;
  /** ISO timestamp; omitted for a method whose link time is unknown. */
  linkedAt?: string;
  /** The method this session was opened with. */
  primary?: boolean;
};

export type AccountWallet = {
  address: string;
  /** The wallet transactions are signed from. Exactly one should be active. */
  active: boolean;
  /** Null while the wallet has not reported a chain. */
  chainName: string | null;
  label: string;
  /** False for a wallet connected to the session but not linked to the account. */
  linked: boolean;
  /** An embedded wallet is created for the account; external is the user's own. */
  origin: "embedded" | "external";
};

export type AccountProfile = {
  loginMethods: AccountLoginMethod[];
  wallets: AccountWallet[];
};

export type AccountPageProps = {
  /** Opens the page with the disconnect confirmation already showing. */
  defaultDisconnectOpen?: boolean | undefined;
  /** Rendered instead of the confirmation buttons while the sign-out runs. */
  disconnectPending?: boolean | undefined;
  /** A failed disconnect, shown inside the confirmation panel. */
  disconnectError?: string | null | undefined;
  /** A failed account read. Takes precedence over `loading` and `profile`. */
  error?: string | null | undefined;
  loading?: boolean | undefined;
  onConfirmDisconnect?: (() => void) | undefined;
  onCopyAddress?: ((address: string) => void) | undefined;
  onLinkMethod?: ((kind: AccountLoginMethodKind) => void) | undefined;
  onRetry?: (() => void) | undefined;
  onSetActiveWallet?: ((address: string) => void) | undefined;
  profile?: AccountProfile | null | undefined;
};

const methodIcons: Record<AccountLoginMethodKind, typeof Mail> = {
  email: Mail,
  google: Globe,
  passkey: KeyRound,
  sms: Smartphone,
  wallet: Wallet,
};

const methodLabels: Record<AccountLoginMethodKind, string> = {
  email: "Email",
  google: "Google",
  passkey: "Passkey",
  sms: "Phone",
  wallet: "Wallet",
};

/**
 * The account surface for ADR 0013: which sign-in methods are linked, which
 * wallet receipts are signed from, and the way out. Purely presentational —
 * every read and every write arrives as a prop, so the page renders the same
 * way from fixtures in Storybook as it will from the wallet stack.
 */
export function AccountPage({
  defaultDisconnectOpen = false,
  disconnectError = null,
  disconnectPending = false,
  error = null,
  loading = false,
  onConfirmDisconnect,
  onCopyAddress,
  onLinkMethod,
  onRetry,
  onSetActiveWallet,
  profile = null,
}: AccountPageProps) {
  const [disconnectOpen, setDisconnectOpen] = useState(defaultDisconnectOpen);

  return (
    <div>
      <div className="mb-7">
        <p className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[var(--accent)] uppercase">
          Account
        </p>
        <h1 className="font-display text-4xl font-black tracking-normal">
          Sign-in methods and active wallet
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-[var(--text-secondary)]">
          Every way into this account, and the wallet your receipts are signed from.
          Disconnecting signs this device out — it never moves funds or cancels a
          receipt.
        </p>
      </div>

      <AccountBody
        disconnectError={disconnectError}
        disconnectOpen={disconnectOpen}
        disconnectPending={disconnectPending}
        error={error}
        loading={loading}
        onCloseDisconnect={() => setDisconnectOpen(false)}
        onConfirmDisconnect={onConfirmDisconnect}
        onCopyAddress={onCopyAddress}
        onLinkMethod={onLinkMethod}
        onOpenDisconnect={() => setDisconnectOpen(true)}
        onRetry={onRetry}
        onSetActiveWallet={onSetActiveWallet}
        profile={profile}
      />
    </div>
  );
}

function AccountBody({
  disconnectError,
  disconnectOpen,
  disconnectPending,
  error,
  loading,
  onCloseDisconnect,
  onConfirmDisconnect,
  onCopyAddress,
  onLinkMethod,
  onOpenDisconnect,
  onRetry,
  onSetActiveWallet,
  profile,
}: {
  disconnectError: string | null;
  disconnectOpen: boolean;
  disconnectPending: boolean;
  error: string | null;
  loading: boolean;
  onCloseDisconnect: () => void;
  onConfirmDisconnect: (() => void) | undefined;
  onCopyAddress: ((address: string) => void) | undefined;
  onLinkMethod: ((kind: AccountLoginMethodKind) => void) | undefined;
  onOpenDisconnect: () => void;
  onRetry: (() => void) | undefined;
  onSetActiveWallet: ((address: string) => void) | undefined;
  profile: AccountProfile | null;
}) {
  if (error) {
    return (
      <NoticeCard
        {...(onRetry ? { action: { label: "Try again", onClick: onRetry } } : {})}
        body={error}
        title="Account unavailable"
        tone="danger"
      />
    );
  }

  if (loading || !profile) {
    return <AccountPlaceholder />;
  }

  const activeWallet = profile.wallets.find((wallet) => wallet.active) ?? null;
  const otherWallets = profile.wallets.filter((wallet) => wallet !== activeWallet);

  return (
    <div className="flex flex-col gap-5">
      <ActiveWalletCard onCopyAddress={onCopyAddress} wallet={activeWallet} />

      <LoginMethodsCard methods={profile.loginMethods} onLinkMethod={onLinkMethod} />

      {otherWallets.length > 0 ? (
        <OtherWalletsCard
          onSetActiveWallet={onSetActiveWallet}
          wallets={otherWallets}
        />
      ) : null}

      <DisconnectCard
        error={disconnectError}
        onCancel={onCloseDisconnect}
        onConfirm={onConfirmDisconnect}
        onOpen={onOpenDisconnect}
        open={disconnectOpen}
        pending={disconnectPending}
      />
    </div>
  );
}

function ActiveWalletCard({
  onCopyAddress,
  wallet,
}: {
  onCopyAddress: ((address: string) => void) | undefined;
  wallet: AccountWallet | null;
}) {
  if (!wallet) {
    return (
      <NoticeCard
        body="Your account is signed in but has no wallet yet. Link an EVM wallet — or let one be created for you — before placing receipts."
        title="No active wallet"
        tone="warning"
      />
    );
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-[var(--radius-pill)] bg-[var(--pc-lime)] shadow-[var(--glow-lime)]" />
        <h2 className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
          Active wallet
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span
          className="font-mono text-[28px] font-bold tracking-tight"
          title={wallet.address}
        >
          {formatAddress(wallet.address)}
        </span>
        <CopyAddressButton address={wallet.address} onCopy={onCopyAddress} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Pill>{wallet.label}</Pill>
        <Pill>
          {wallet.origin === "embedded" ? "Embedded wallet" : "External wallet"}
        </Pill>
        {wallet.chainName ? <Pill>{wallet.chainName}</Pill> : null}
        {wallet.linked ? null : <Pill tone="warning">Not linked to account</Pill>}
      </div>
    </section>
  );
}

/**
 * Copies the full address — the card shows the truncated form, so the button
 * is the only way to get the real one. Falls back to the clipboard API when
 * no handler is supplied.
 */
function CopyAddressButton({
  address,
  onCopy,
}: {
  address: string;
  onCopy: ((address: string) => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 1400);

    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <button
      className="focus-ring inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--pc-cyan)] hover:text-[var(--text-primary)]"
      onClick={() => {
        if (onCopy) {
          onCopy(address);
        } else {
          void navigator.clipboard?.writeText(address);
        }

        setCopied(true);
      }}
      type="button"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy address"}
    </button>
  );
}

function LoginMethodsCard({
  methods,
  onLinkMethod,
}: {
  methods: AccountLoginMethod[];
  onLinkMethod: ((kind: AccountLoginMethodKind) => void) | undefined;
}) {
  const linkedKinds = new Set(methods.map((method) => method.kind));
  const unlinked = (Object.keys(methodLabels) as AccountLoginMethodKind[]).filter(
    (kind) => !linkedKinds.has(kind)
  );

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
      <SectionHeader title="Sign-in methods" />

      {methods.length > 0 ? (
        methods.map((method) => (
          <LoginMethodRow key={`${method.kind}:${method.detail}`} method={method} />
        ))
      ) : (
        <p className="px-5 py-6 text-sm leading-6 text-[var(--text-secondary)]">
          Nothing is linked yet. This account can only be reached from the session you
          are in — link a method so you can sign back in.
        </p>
      )}

      {onLinkMethod && unlinked.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-[var(--border-soft)] px-5 py-4">
          {unlinked.map((kind) => (
            <Button
              key={kind}
              leftIcon={<Link2 size={14} />}
              onClick={() => onLinkMethod(kind)}
              size="sm"
              variant="secondary"
            >
              Link {methodLabels[kind].toLowerCase()}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function LoginMethodRow({ method }: { method: AccountLoginMethod }) {
  const Icon = methodIcons[method.kind];

  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] px-5 py-4 last:border-b-0">
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="shrink-0 text-[var(--pc-cyan)]" size={16} />
        <span className="min-w-0">
          <span className="block text-sm text-[var(--text-primary)]">
            {methodLabels[method.kind]}
          </span>
          <span className="block truncate font-mono text-xs text-[var(--text-muted)]">
            {method.kind === "wallet" ? formatAddress(method.detail) : method.detail}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {method.linkedAt ? (
          <span className="hidden font-mono text-[11px] text-[var(--text-muted)] sm:inline">
            {formatDateTime(method.linkedAt)}
          </span>
        ) : null}
        {method.primary ? <Pill tone="accent">This session</Pill> : null}
      </span>
    </div>
  );
}

function OtherWalletsCard({
  onSetActiveWallet,
  wallets,
}: {
  onSetActiveWallet: ((address: string) => void) | undefined;
  wallets: AccountWallet[];
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
      <SectionHeader title="Other linked wallets" />
      {wallets.map((wallet) => (
        <div
          className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] px-5 py-4 last:border-b-0"
          key={wallet.address}
        >
          <span className="min-w-0">
            <span
              className="block truncate font-mono text-sm text-[var(--text-primary)]"
              title={wallet.address}
            >
              {formatAddress(wallet.address)}
            </span>
            <span className="block truncate text-xs text-[var(--text-muted)]">
              {wallet.label}
              {wallet.chainName ? ` - ${wallet.chainName}` : ""}
              {wallet.linked ? "" : " - not linked"}
            </span>
          </span>
          {onSetActiveWallet ? (
            <Button
              onClick={() => onSetActiveWallet(wallet.address)}
              size="sm"
              variant="secondary"
            >
              Make active
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function DisconnectCard({
  error,
  onCancel,
  onConfirm,
  onOpen,
  open,
  pending,
}: {
  error: string | null;
  onCancel: () => void;
  onConfirm: (() => void) | undefined;
  onOpen: () => void;
  open: boolean;
  pending: boolean;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <h2 className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
        Disconnect
      </h2>

      {open ? (
        <>
          <p className="mb-4 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
            Signing out ends this session on this device. Your receipts, backed
            positions, and any pending refunds stay exactly where they are, and come
            back when you sign in again with a linked method.
          </p>
          {error ? (
            <div className="mb-4 flex max-w-xl gap-2 rounded-[var(--radius-sm)] border border-[var(--danger)] px-3 py-2 text-xs leading-5 text-[var(--danger)]">
              <AlertTriangle className="mt-0.5 shrink-0" size={13} />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              leftIcon={
                pending ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <LogOut size={14} />
                )
              }
              onClick={onConfirm}
              size="sm"
            >
              {pending ? "Disconnecting" : "Yes, disconnect"}
            </Button>
            <Button disabled={pending} onClick={onCancel} size="sm" variant="ghost">
              Stay signed in
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
            Ends the session on this device only.
          </p>
          <Button
            leftIcon={<LogOut size={14} />}
            onClick={onOpen}
            size="sm"
            variant="secondary"
          >
            Disconnect
          </Button>
        </>
      )}
    </section>
  );
}

/**
 * The read-in-progress shape: the same three cards at the same heights, so
 * the page does not jump when the account arrives. Deliberately local — the
 * shared skeleton primitives are a separate ADR 0013 item.
 */
function AccountPlaceholder() {
  return (
    <div aria-busy="true" aria-label="Loading account" className="flex flex-col gap-5">
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
        <PlaceholderBar className="mb-4 h-3 w-28" />
        <PlaceholderBar className="h-9 w-64" />
        <div className="mt-4 flex gap-2">
          <PlaceholderBar className="h-6 w-24" />
          <PlaceholderBar className="h-6 w-32" />
        </div>
      </section>
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
        <PlaceholderBar className="mb-4 h-3 w-32" />
        <PlaceholderBar className="mb-3 h-6 w-full" />
        <PlaceholderBar className="h-6 w-3/4" />
      </section>
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
        <PlaceholderBar className="mb-4 h-3 w-24" />
        <PlaceholderBar className="h-8 w-36" />
      </section>
    </div>
  );
}

function PlaceholderBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-hover)]",
        className
      )}
    />
  );
}

function NoticeCard({
  action,
  body,
  title,
  tone = "neutral",
}: {
  action?: { label: string; onClick: () => void };
  body: string;
  title: string;
  tone?: "danger" | "neutral" | "warning";
}) {
  const toneBorder = {
    danger: "border-[var(--danger)]",
    neutral: "border-[var(--border)]",
    warning: "border-[var(--status-graduating)]",
  }[tone];

  return (
    <section
      className={cn(
        "rounded-[var(--radius-lg)] border bg-[var(--surface-card)] p-5",
        toneBorder
      )}
    >
      <h2 className="font-display text-lg font-black">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
        {body}
      </p>
      {action ? (
        <Button className="mt-4" onClick={action.onClick} size="sm" variant="secondary">
          {action.label}
        </Button>
      ) : null}
    </section>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-[var(--border-soft)] px-5 py-3 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
      {title}
    </div>
  );
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "accent" | "neutral" | "warning";
}) {
  const toneClass = {
    accent: "border-[var(--accent)] text-[var(--accent)]",
    neutral: "border-[var(--border-strong)] text-[var(--text-secondary)]",
    warning: "border-[var(--status-graduating)] text-[var(--status-graduating)]",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-1 font-mono text-[11px] whitespace-nowrap",
        toneClass
      )}
    >
      {children}
    </span>
  );
}
