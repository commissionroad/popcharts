"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { logError } from "@/lib/error-logger";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Capture the uncaught render error; the user only ever sees the friendly
    // copy below, never the raw error.
    logError(error, { digest: error.digest, surface: "route-error-boundary" });
  }, [error]);

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-7">
      <p className="font-mono text-xs tracking-[0.16em] text-[var(--accent)] uppercase">
        Something cracked
      </p>
      <h1 className="font-display mt-3 text-3xl font-black">Try that again.</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
        The app hit an unexpected state before it could show this surface.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-xs text-[var(--text-muted)]">
          Digest {error.digest}
        </p>
      ) : null}
      <Button className="mt-6" onClick={reset}>
        Reload surface
      </Button>
    </div>
  );
}
