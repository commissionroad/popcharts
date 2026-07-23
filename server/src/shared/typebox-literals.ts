import { t } from "elysia";
import type { SchemaOptions, TLiteral, TUnion } from "@sinclair/typebox";

/**
 * The tuple-of-literals type that hand-writing
 * `[t.Literal(a), t.Literal(b), ...]` would produce for the const array `T`.
 */
type LiteralTuple<T extends readonly string[]> = {
  -readonly [K in keyof T]: TLiteral<T[K] & string>;
};

/**
 * Typebox union of string literals derived from a const array, so validation
 * schemas share one definition with the TypeScript union type instead of
 * mirroring the literal set. Emits the same `anyOf` of `const` values as a
 * hand-written `t.Union([t.Literal(...), ...])`.
 *
 * The tuple-typed return matters: `t.Union` over a plain `TLiteral[]` array
 * type-checks as `Static`, but Elysia's route-schema inference degrades it to
 * `undefined`/`never`, breaking handler typing.
 */
export function literalUnion<T extends readonly [string, ...string[]]>(
  values: T,
  options?: SchemaOptions,
): TUnion<LiteralTuple<T>> {
  return t.Union(
    values.map((value) => t.Literal(value)),
    options,
  ) as TUnion<LiteralTuple<T>>;
}
