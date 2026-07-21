/**
 * Normalizes an operator-supplied market symbol into a safe manifest filename
 * slug, so market manifest paths never carry unexpected path characters.
 */
export function marketFileSlug(marketSymbol: string): string {
  const slug = marketSymbol
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "market";
}
