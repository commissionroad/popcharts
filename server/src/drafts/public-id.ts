/**
 * Symbols a draft's public id is built from: lowercase alphanumerics with
 * every look-alike pair broken. `0`/`1` are gone, so `o` and `l` — which are
 * also gone — have nothing to be confused with, and the surviving `i` cannot
 * be misread as a `1` that no id contains.
 *
 * Exactly 32 symbols, which matters: 256 is a whole multiple of 32, so
 * sampling a random byte modulo the alphabet length is uniform. An alphabet of
 * any other size would quietly bias the low symbols.
 */
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

/**
 * Characters per id. At 32 symbols that is 80 bits — with a million drafts the
 * odds of any collision are around one in a trillion. The uniqueness guarantee
 * is still the database's unique index, not this number: entropy makes a
 * collision negligible, a constraint makes it impossible.
 */
export const DRAFT_PUBLIC_ID_LENGTH = 16;

const PATTERN = new RegExp(`^[${ALPHABET}]{${DRAFT_PUBLIC_ID_LENGTH}}$`);

/** Mints a random draft public id. */
export function newDraftPublicId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(DRAFT_PUBLIC_ID_LENGTH));
  let id = "";

  for (const byte of bytes) {
    id += ALPHABET[byte % ALPHABET.length];
  }

  return id;
}

/**
 * Whether a value is a well-formed draft public id. Used to reject junk before
 * it reaches a query — an id arrives from a URL, so it is user input.
 */
export function isDraftPublicId(value: string): boolean {
  return PATTERN.test(value);
}
