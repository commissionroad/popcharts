"use client";

import { Rocket } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { WalletAccountButton } from "@/integrations/wallet/wallet-account-button";
import { cn } from "@/lib/cn";

const navItems = [
  { href: "/", label: "Discover" },
  { href: "/create", label: "Create" },
  { href: "/portfolio", label: "Portfolio" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-soft)] bg-[rgb(8_8_10/74%)] backdrop-blur-md">
      <div className="mx-auto flex h-[66px] max-w-[1240px] items-center justify-between gap-4 px-[18px] sm:px-7">
        <div className="flex min-w-0 items-center gap-5 md:gap-7">
          <Link className="shrink-0" href="/" aria-label="Pop Charts home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {navItems.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/" || pathname.startsWith("/markets")
                  : pathname.startsWith(item.href);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-[var(--radius-sm)] px-3.5 py-2 font-mono text-[13px] tracking-[0.04em] transition-colors",
                    active
                      ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  )}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {pathname !== "/create" ? (
            <div className="hidden sm:block">
              <Button href="/create" leftIcon={<Rocket size={16} />} size="sm">
                Pop a market
              </Button>
            </div>
          ) : null}
          <WalletAccountButton />
        </div>
      </div>
    </header>
  );
}
