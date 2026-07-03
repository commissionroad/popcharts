/**
 * Echoes multi-line text with a `[name]` prefix on every non-empty line, so
 * interleaved output from several child processes stays attributable.
 */
export function writePrefixed(name: string, text: string): void {
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) {
      console.log(`[${name}] ${line}`);
    }
  }
}
