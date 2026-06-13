import type {
  ChangeEventHandler,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";

type FieldProps = {
  className?: string;
  hint?: string;
  id: string;
  label: string;
  mono?: boolean;
  multiline?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  placeholder?: string;
  suffix?: ReactNode;
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  value?: string | number;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">;

export function Field({
  className,
  hint,
  id,
  label,
  mono,
  multiline,
  onChange,
  placeholder,
  suffix,
  type = "text",
  value,
  ...props
}: FieldProps) {
  const inputClassName = cn(
    "w-full resize-y border-0 bg-transparent text-[15px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]",
    mono ? "font-mono tabular" : null
  );

  return (
    <label className={cn("flex flex-col gap-2", className)} htmlFor={id}>
      <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
        {label}
      </span>
      <span
        className={cn(
          "flex gap-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 transition-colors duration-[var(--duration-fast)] focus-within:border-[var(--pc-cyan)]",
          multiline ? "items-start py-3" : "h-11 items-center"
        )}
      >
        {multiline ? (
          <textarea
            className={inputClassName}
            id={id}
            onChange={onChange}
            placeholder={placeholder}
            rows={4}
            value={value}
            {...props}
          />
        ) : (
          <input
            className={inputClassName}
            id={id}
            onChange={onChange}
            placeholder={placeholder}
            type={type}
            value={value}
            {...props}
          />
        )}
        {suffix ? (
          <span className="shrink-0 font-mono text-[13px] text-[var(--text-muted)]">
            {suffix}
          </span>
        ) : null}
      </span>
      {hint ? (
        <span className="text-xs leading-5 text-[var(--text-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}
