"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Link2,
  Loader2,
  LogOut,
  Network,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { cn } from "@/lib/cn";

export function WalletAccountButton() {
  const wallet = useWalletAccount();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showConfigWarning, setShowConfigWarning] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open && !showConfigWarning) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setOpen(false);
        setShowConfigWarning(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setShowConfigWarning(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, showConfigWarning]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 1400);

    return () => window.clearTimeout(timeout);
  }, [copied]);

  if (!wallet.enabled) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          aria-expanded={showConfigWarning}
          className="focus-ring inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--status-graduating)] bg-[var(--pc-amber-wash)] px-3.5 py-2 font-mono text-[13px] whitespace-nowrap text-[var(--text-primary)] transition-colors hover:bg-[rgb(255_176_32/18%)] max-[420px]:px-3 max-[420px]:text-[12px]"
          onClick={() => setShowConfigWarning((current) => !current)}
          title="Wallet login is not configured for this deployment."
          type="button"
        >
          <Wallet color="var(--status-graduating)" size={15} />
          Sign in
        </button>
        {showConfigWarning ? (
          <div className="absolute right-0 z-50 mt-3 w-[min(92vw,320px)] rounded-[var(--radius-lg)] border border-[var(--status-graduating)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-tile)]">
            <div className="flex gap-2 text-[11px] leading-5 text-[var(--status-graduating)]">
              <AlertTriangle className="mt-1 shrink-0" size={14} />
              <span>
                Wallet login is not configured. Add a Privy public app ID or enable the
                local wallet fallback for development.
              </span>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!wallet.ready) {
    return (
      <button
        className="focus-ring inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-transparent px-3.5 py-2 font-mono text-[13px] whitespace-nowrap text-[var(--text-secondary)] max-[420px]:px-3 max-[420px]:text-[12px]"
        disabled
        type="button"
      >
        <Loader2 className="animate-spin text-[var(--pc-cyan)]" size={15} />
        Wallet
      </button>
    );
  }

  if (!wallet.authenticated) {
    return (
      <button
        className="focus-ring inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--pc-cyan)] bg-[var(--pc-cyan-wash)] px-3.5 py-2 font-mono text-[13px] whitespace-nowrap text-[var(--text-primary)] transition-colors hover:bg-[rgb(31_224_255/18%)] max-[420px]:px-3 max-[420px]:text-[12px]"
        onClick={wallet.login}
        type="button"
      >
        <Wallet color="var(--pc-cyan)" size={15} />
        {wallet.loginLabel}
      </button>
    );
  }

  const chainLabel = wallet.isSupportedChain
    ? (wallet.activeChainName ?? wallet.defaultChain.name)
    : "Wrong network";

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "focus-ring inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border bg-transparent px-3 py-2 font-mono text-[13px] whitespace-nowrap text-[var(--text-primary)] transition-colors max-[420px]:gap-1.5 max-[420px]:px-2.5 max-[420px]:text-[12px]",
          wallet.isSupportedChain
            ? "border-[var(--border-strong)] hover:border-[var(--pc-cyan)]"
            : "border-[var(--status-graduating)] text-[var(--status-graduating)]"
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Wallet color="var(--pc-cyan)" size={15} />
        <span className="hidden max-w-[160px] truncate sm:inline">
          {wallet.displayAddress ?? wallet.userLabel ?? "Account"}
        </span>
        <span className="max-w-[110px] truncate rounded-[var(--radius-pill)] bg-[var(--surface-raised)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
          {chainLabel}
        </span>
        <ChevronDown
          className={cn(
            "transition-transform duration-[var(--duration-fast)]",
            open ? "rotate-180" : null
          )}
          size={14}
        />
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-3 w-[min(92vw,360px)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-card)] shadow-[var(--shadow-tile)]">
          <div className="border-b border-[var(--border-soft)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
                  Pop Charts account
                </div>
                <div className="mt-1 truncate font-mono text-sm text-[var(--text-primary)]">
                  {wallet.displayAddress ?? wallet.userLabel ?? "No wallet linked"}
                </div>
              </div>
              <StatusDot supported={wallet.isSupportedChain} />
            </div>
            {wallet.errorMessage ? (
              <div className="mt-3 flex gap-2 rounded-[var(--radius-sm)] border border-[var(--status-graduating)] bg-[var(--pc-amber-wash)] p-2 text-[11px] leading-4 text-[var(--status-graduating)]">
                <AlertTriangle className="mt-0.5 shrink-0" size={13} />
                <span>{wallet.errorMessage}</span>
              </div>
            ) : null}
          </div>

          <MenuSection title="Network">
            <div className="grid gap-2">
              {wallet.supportedChains.map((chain) => {
                const active = wallet.activeChainId === chain.id;
                const pending = wallet.pendingAction === `switch-chain:${chain.id}`;

                return (
                  <button
                    className={cn(
                      "focus-ring flex items-center justify-between rounded-[var(--radius-sm)] border px-3 py-2 text-left font-mono text-xs transition-colors",
                      active
                        ? "border-[var(--pc-cyan)] bg-[var(--pc-cyan-wash)] text-[var(--pc-cyan)]"
                        : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    )}
                    disabled={active || Boolean(wallet.pendingAction)}
                    key={chain.id}
                    onClick={() => void wallet.switchChain(chain.id)}
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <Network size={13} />
                      {chain.name}
                    </span>
                    {pending ? (
                      <Loader2 className="animate-spin" size={13} />
                    ) : active ? (
                      <Check size={13} />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </MenuSection>

          <MenuSection title="Wallets">
            <div className="grid gap-2">
              {wallet.wallets.length > 0 ? (
                wallet.wallets.map((connectedWallet) => {
                  const pending =
                    wallet.pendingAction === `set-active:${connectedWallet.address}`;

                  return (
                    <button
                      className={cn(
                        "focus-ring flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors",
                        connectedWallet.active
                          ? "border-[var(--pc-lime)] bg-[var(--pc-lime-wash)]"
                          : "border-[var(--border)] hover:border-[var(--border-strong)]"
                      )}
                      disabled={connectedWallet.active || Boolean(wallet.pendingAction)}
                      key={connectedWallet.address}
                      onClick={() =>
                        void wallet.setActiveWallet(connectedWallet.address)
                      }
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs text-[var(--text-primary)]">
                          {connectedWallet.displayAddress}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--text-muted)]">
                          {connectedWallet.label}
                          {connectedWallet.linked ? "" : " - unlinked"}
                        </span>
                      </span>
                      {pending ? (
                        <Loader2 className="shrink-0 animate-spin" size={14} />
                      ) : connectedWallet.active ? (
                        <Check className="shrink-0 text-[var(--pc-lime)]" size={14} />
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <p className="text-[12px] leading-5 text-[var(--text-muted)]">
                  Your account is signed in. Create or link an EVM wallet before placing
                  receipts.
                </p>
              )}
            </div>
          </MenuSection>

          <div className="grid gap-1 border-t border-[var(--border-soft)] p-2">
            <MenuAction
              disabled={!wallet.address || Boolean(wallet.pendingAction)}
              icon={copied ? <Check size={14} /> : <Copy size={14} />}
              label={copied ? "Copied address" : "Copy address"}
              onClick={async () => {
                await wallet.copyAddress();
                setCopied(true);
              }}
            />
            <MenuAction
              disabled={Boolean(wallet.pendingAction)}
              icon={
                wallet.pendingAction === "link-wallet" ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <Link2 size={14} />
                )
              }
              label="Link another wallet"
              onClick={wallet.linkWallet}
            />
            <MenuAction
              disabled={Boolean(wallet.pendingAction)}
              icon={
                wallet.pendingAction === "logout" ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <LogOut size={14} />
                )
              }
              label="Disconnect"
              onClick={() => void wallet.logout()}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="border-b border-[var(--border-soft)] p-4">
      <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
        {title}
      </div>
      {children}
    </div>
  );
}

function MenuAction({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      className="focus-ring flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-45"
      disabled={disabled}
      onClick={() => void onClick()}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function StatusDot({ supported }: { supported: boolean }) {
  return (
    <span
      className={cn(
        "mt-1 h-2.5 w-2.5 shrink-0 rounded-[var(--radius-pill)]",
        supported
          ? "bg-[var(--pc-lime)] shadow-[var(--glow-lime)]"
          : "bg-[var(--status-graduating)] shadow-[var(--glow-amber)]"
      )}
    />
  );
}
