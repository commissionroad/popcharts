/**
 * Joins class names into a single className string, dropping falsy entries so
 * callers can express conditional classes inline.
 */
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
