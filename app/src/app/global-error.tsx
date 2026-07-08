"use client";

import { useEffect } from "react";

import { logError } from "@/lib/error-logger";

/**
 * Last-resort boundary for errors thrown by the root layout itself, which the
 * route-level `error.tsx` cannot catch. Replaces the whole document, so it
 * renders its own `<html>`/`<body>`. Like every other surface, it logs the raw
 * error and shows the user only friendly copy.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError(error, { digest: error.digest, surface: "global-error-boundary" });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          alignItems: "center",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800 }}>Try that again.</h1>
          <p style={{ marginTop: "0.75rem", opacity: 0.7 }}>
            The app hit an unexpected state before it could load. Reloading usually
            clears it.
          </p>
          <button
            onClick={reset}
            style={{
              cursor: "pointer",
              marginTop: "1.5rem",
              padding: "0.6rem 1.25rem",
            }}
            type="button"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
