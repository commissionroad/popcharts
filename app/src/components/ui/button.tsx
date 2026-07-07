import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  glow?: boolean;
  href?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

const sizeClasses: Record<ButtonSize, string> = {
  lg: "gap-3 rounded-[var(--radius-md)] px-6 py-4 text-[17px]",
  md: "gap-2.5 rounded-[var(--radius-md)] px-5 py-3.5 text-base",
  sm: "gap-2 rounded-[var(--radius-sm)] px-3.5 py-2 text-[13px]",
};

const variantClasses: Record<ButtonVariant, string> = {
  ghost:
    "border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
  primary:
    "border-transparent bg-[var(--accent)] text-[var(--accent-content)] hover:bg-[var(--accent)] active:bg-[var(--accent-pressed)]",
  secondary:
    "border-[var(--border-strong)] bg-transparent text-[var(--text-primary)] hover:border-[var(--pc-cyan)]",
};

export function Button({
  children,
  className,
  disabled,
  glow,
  href,
  leftIcon,
  rightIcon,
  size = "md",
  variant = "primary",
  ...props
}: ButtonProps) {
  const shouldGlow = glow ?? variant === "primary";
  const buttonClassName = cn(
    "focus-ring font-display inline-flex items-center justify-center whitespace-nowrap border font-black transition-[border-color,background,transform,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-default)] hover:-translate-y-0.5 active:translate-y-0 disabled:pointer-events-none disabled:opacity-45",
    sizeClasses[size],
    variantClasses[variant],
    shouldGlow ? "shadow-[var(--glow-magenta)]" : null,
    className
  );

  if (href) {
    // Anchors never match :disabled, so a disabled link needs the blocking
    // done explicitly: no tab stop, no pointer events, and a suppressed
    // click for good measure. The button-typed rest props share the DOM
    // attribute surface Link accepts; the cast reconciles the two prop types.
    const anchorProps = props as unknown as Omit<
      ComponentProps<typeof Link>,
      "children" | "href"
    >;

    return (
      <Link
        {...anchorProps}
        {...(disabled
          ? {
              onClick: (event: ReactMouseEvent<HTMLAnchorElement>) =>
                event.preventDefault(),
              tabIndex: -1,
            }
          : {})}
        aria-disabled={disabled || undefined}
        className={cn(
          buttonClassName,
          disabled ? "pointer-events-none opacity-45" : null
        )}
        href={href}
      >
        {leftIcon}
        {children}
        {rightIcon}
      </Link>
    );
  }

  return (
    <button className={buttonClassName} disabled={disabled} type="button" {...props}>
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
