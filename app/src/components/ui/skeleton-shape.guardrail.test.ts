import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SKELETON_MIRRORED_TYPE_CLASSES } from "./skeleton";

/**
 * The skeletons claim to be the shape of the content they replace, and that
 * claim rests on a copy: `skeleton.tsx` repeats the type classes of the real
 * components so its placeholders inherit their line boxes. A copy drifts, and
 * this one drifts silently — the skeleton keeps rendering, just a few pixels
 * off, and the page jumps when the data lands.
 *
 * So: every mirrored class string must still be carried, in full, by some
 * element in the component it was taken from. Tokens are compared as a set
 * because the Tailwind formatter reorders class lists, which makes a literal
 * substring check fail for the wrong reason.
 */
const UI_ROOT = import.meta.dirname;

/** Every `className="..."` literal in a source file. */
function classNameLiterals(source: string): string[] {
  return Array.from(source.matchAll(/className=(?:"([^"]*)"|\{"([^"]*)"\})/g)).map(
    (match) => match[1] ?? match[2] ?? ""
  );
}

function tokens(classList: string): string[] {
  return classList.split(/\s+/).filter(Boolean);
}

describe("skeleton shape guardrail", () => {
  it.each(Object.entries(SKELETON_MIRRORED_TYPE_CLASSES))(
    "%s still carries the type classes the skeleton mirrors",
    (fileName, mirrored) => {
      const source = readFileSync(join(UI_ROOT, fileName), "utf8");
      const literals = classNameLiterals(source).map(
        (literal) => new Set(tokens(literal))
      );

      const missing = mirrored.filter(
        (mirroredClass) =>
          !literals.some((literal) =>
            tokens(mirroredClass).every((token) => literal.has(token))
          )
      );

      expect(missing).toEqual([]);
    }
  );

  it("finds the class literals it scans for", () => {
    // Guards the guard: a regex that silently matches nothing would make every
    // assertion above vacuously pass.
    const source = readFileSync(join(UI_ROOT, "metric-card.tsx"), "utf8");

    expect(classNameLiterals(source).length).toBeGreaterThan(0);
  });
});
