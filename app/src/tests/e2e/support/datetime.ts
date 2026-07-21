/**
 * Formats an epoch-milliseconds instant the way a `datetime-local` input
 * expects (local time, minute precision) — shared by the specs that fill the
 * create form's deadline fields.
 */
export function dateTimeLocalAtMs(epochMilliseconds: number) {
  const date = new Date(epochMilliseconds);
  const pad = (value: number) => value.toString().padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `now + milliseconds` in the same format, for specs on a fresh chain whose
 * clock tracks wall time. Lifecycle specs must use chain time instead. */
export function dateTimeLocalAfter(milliseconds: number) {
  return dateTimeLocalAtMs(Date.now() + milliseconds);
}
