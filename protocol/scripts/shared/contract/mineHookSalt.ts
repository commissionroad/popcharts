import {
  concatHex,
  getAddress,
  keccak256,
  numberToHex,
  sliceHex,
  type Address,
  type Hex,
} from "viem";

export type MineHookSaltConfig = {
  /** CREATE2 factory the salt will be broadcast through. */
  readonly deterministicFactory: Address;
  /** Full hook init code: creation bytecode plus ABI-encoded constructor args. */
  readonly initCode: Hex;
  /** Upper bound on candidate salts before giving up. */
  readonly maxIterations?: number;
  /** Exact hook permission flags the mined address must encode. */
  readonly requiredFlags: bigint;
};

export type MinedHookSalt = {
  /** CREATE2 address whose low bits encode exactly the required flags. */
  readonly hookAddress: Address;
  /** 32-byte salt that produces `hookAddress` through the factory. */
  readonly salt: Hex;
};

// v4 pool managers read hook permissions from the low 14 address bits
// (Hooks.ALL_HOOK_MASK in v4-core), and Hooks.validateHookPermissions requires
// an exact match: enabled callbacks must be set and every other bit clear.
const HOOK_PERMISSION_ADDRESS_MASK = (1n << 14n) - 1n;

// A uniformly distributed address matches one specific 14-bit pattern once per
// 16,384 candidates on average, so this default gives enormous headroom while
// still terminating fast when the inputs are wrong.
const DEFAULT_MAX_ITERATIONS = 500_000;

const CREATE2_PREFIX: Hex = "0xff";
const SALT_BYTES = 32;
const ADDRESS_OFFSET_BYTES = 12;

/**
 * Mines a CREATE2 salt whose deployed address encodes exactly the required v4
 * hook permission flags, using the standard CREATE2 address formula
 * keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))[12:].
 */
export function mineHookSalt(config: MineHookSaltConfig): MinedHookSalt {
  if ((config.requiredFlags & ~HOOK_PERMISSION_ADDRESS_MASK) !== 0n) {
    throw new Error(
      `Required hook flags ${config.requiredFlags} exceed the 14-bit hook permission mask.`,
    );
  }

  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const initCodeHash = keccak256(config.initCode);
  for (let iteration = 0; iteration < maxIterations; ++iteration) {
    const salt = numberToHex(BigInt(iteration), { size: SALT_BYTES });
    const digest = keccak256(
      concatHex([CREATE2_PREFIX, config.deterministicFactory, salt, initCodeHash]),
    );
    const hookAddress = getAddress(sliceHex(digest, ADDRESS_OFFSET_BYTES));
    if ((BigInt(hookAddress) & HOOK_PERMISSION_ADDRESS_MASK) === config.requiredFlags) {
      return { hookAddress, salt };
    }
  }

  throw new Error(
    `No hook salt found for flags ${config.requiredFlags} within ${maxIterations} iterations.`,
  );
}
