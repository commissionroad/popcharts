import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * Storybook stub for `next/link`: the real module pulls in the Next runtime
 * (which expects `process` and a router). The panel only needs a plain anchor.
 */
export default function Link({
  children,
  href,
  ...rest
}: { children?: ReactNode; href: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
