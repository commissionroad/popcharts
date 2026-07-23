"use client";

import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";

import { logError } from "@/lib/error-logger";

import { LiveConnection } from "./live-connection";

/**
 * Mounts the single shared live-updates connection for the whole app (repo ADR
 * 0021) and pauses it while the tab is hidden.
 *
 * The browser connects **directly to the API origin**, not through a Next
 * route: a serverless proxy force-closes long-lived responses at its duration
 * cap, which would turn one stream into endless reconnect churn. With no API
 * origin configured (e.g. the fixture-backed sample-data build) the context is
 * null and every `useLiveChannel` call is inert, so nothing here can break a
 * page that has no live backend.
 */
export const LiveConnectionContext = createContext<LiveConnection | null>(null);

/** The shared connection, or null when live updates are not configured. */
export function useLiveConnection(): LiveConnection | null {
  return useContext(LiveConnectionContext);
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const baseUrl = process.env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL;

  const connection = useMemo(() => {
    if (!baseUrl) {
      return null;
    }
    return new LiveConnection({
      baseUrl,
      onError: (error) => logError(error, { surface: "live-updates" }),
    });
  }, [baseUrl]);

  useEffect(() => {
    if (!connection) {
      return;
    }

    const syncVisibility = () => {
      if (document.visibilityState === "hidden") {
        connection.pause();
      } else {
        connection.resume();
      }
    };

    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      connection.dispose();
    };
  }, [connection]);

  return (
    <LiveConnectionContext.Provider value={connection}>
      {children}
    </LiveConnectionContext.Provider>
  );
}
