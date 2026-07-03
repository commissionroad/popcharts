"use client";

import { Field } from "@/components/ui/field";
import { MARKET_CATEGORIES, type MarketCategory } from "@/domain/markets/types";
import { cn } from "@/lib/cn";

/**
 * Pill-button picker over the fixed market category list. Reports the chosen
 * category and renders the draft's category validation error, if any.
 */
export function CategoryPicker({
  category,
  error,
  onChange,
}: {
  category: MarketCategory;
  error?: string | undefined;
  onChange: (category: MarketCategory) => void;
}) {
  return (
    <fieldset>
      <legend className="font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
        Category
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {MARKET_CATEGORIES.map((item) => (
          <button
            aria-pressed={category === item}
            className={cn(
              "focus-ring rounded-[var(--radius-pill)] border px-3.5 py-2 font-mono text-xs transition-colors",
              category === item
                ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
            )}
            key={item}
            onClick={() => onChange(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
      {error ? (
        <span className="mt-2 block text-xs leading-5 text-[var(--no)]" role="alert">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

type DeadlinePresetOption = {
  label: string;
  milliseconds: number;
};

/**
 * Datetime input plus quick-pick preset pills for a market deadline
 * (graduation or resolution). Manual edits flip the marker to "Custom";
 * choosing a preset reports the full preset so the caller can stamp both the
 * time and the preset label onto the draft.
 */
export function DeadlineControl<TPreset extends DeadlinePresetOption>({
  error,
  id,
  label,
  onChange,
  onPreset,
  presets,
  selectedPreset,
  value,
}: {
  error?: string | undefined;
  id: string;
  label: string;
  onChange: (value: string) => void;
  onPreset: (preset: TPreset) => void;
  presets: ReadonlyArray<TPreset>;
  selectedPreset: string;
  value: string;
}) {
  const customSelected = selectedPreset === "custom";

  return (
    <div>
      <Field
        error={error}
        id={id}
        label={label}
        mono
        onChange={(event) => onChange(event.target.value)}
        type="datetime-local"
        value={value}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {presets.map((preset) => {
          const selected = selectedPreset === preset.label;

          return (
            <button
              aria-pressed={selected}
              className={cn(
                "focus-ring rounded-[var(--radius-pill)] border px-2.5 py-1.5 font-mono text-[11px] transition-colors",
                selected
                  ? "border-[var(--pc-cyan)] bg-[var(--accent-wash)] text-[var(--pc-cyan)]"
                  : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--pc-cyan)]"
              )}
              key={preset.label}
              onClick={() => onPreset(preset)}
              type="button"
            >
              {preset.label}
            </button>
          );
        })}
        <span
          aria-current={customSelected ? "true" : undefined}
          className={cn(
            "rounded-[var(--radius-pill)] border px-2.5 py-1.5 font-mono text-[11px]",
            customSelected
              ? "border-[var(--pc-cyan)] bg-[var(--accent-wash)] text-[var(--pc-cyan)]"
              : "border-[var(--border-soft)] text-[var(--text-muted)]"
          )}
          data-deadline-custom={id}
        >
          Custom
        </span>
      </div>
    </div>
  );
}
