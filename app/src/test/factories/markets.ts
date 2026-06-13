import { markets } from "@/domain/markets/fixtures";
import type { Market } from "@/domain/markets/types";

export function marketFactory(overrides: Partial<Market> = {}): Market {
  const base = markets[0];

  if (!base) {
    throw new Error("market fixture missing");
  }

  return {
    ...base,
    ...overrides,
  };
}
