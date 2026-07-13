/** A market id an operator supplied to a script, split into its components. */
export type ParsedMarketIdArgument = {
  /** The chain id from the composite form, or undefined when a bare id was given. */
  readonly chainId?: number;
  /** The numeric uint256 marketId the manager stores. */
  readonly marketId: bigint;
};

/**
 * Parses the market id an operator passes to a market script. Accepts both a
 * bare uint256 marketId ("9") and the composite "chainId:marketId" form the app
 * shows in the detail URL (/markets/31337:9), so an operator can paste straight
 * from the address bar. The numeric marketId (the part after the colon) is
 * returned as a bigint; the chain id component, when present, is returned so the
 * caller can refuse to act against the wrong chain.
 */
export function parseMarketIdArgument(raw: string): ParsedMarketIdArgument {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Expected a market id, e.g. "9" or "31337:9".');
  }

  const parts = trimmed.split(":");
  if (parts.length > 2) {
    throw new Error(
      `Could not parse market id "${raw}"; expected "marketId" or "chainId:marketId".`,
    );
  }

  let chainPart: string | undefined;
  let idPart: string;
  if (parts.length === 2) {
    [chainPart, idPart] = parts as [string, string];
  } else {
    idPart = parts[0] as string;
  }

  const marketId = parseUnsignedInteger(idPart, "market id");
  if (chainPart === undefined) {
    return { marketId };
  }
  return { chainId: Number(parseUnsignedInteger(chainPart, "chain id")), marketId };
}

function parseUnsignedInteger(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Expected the ${label} to be a non-negative integer, received "${value}".`);
  }
  return BigInt(value);
}
