"use client";

import { useEffect, useRef } from "react";

import type { LiveSignal } from "./live-connection";
import { useLiveConnection } from "./live-provider";

/**
 * Subscribes to one live channel for as long as the component is mounted (repo
 * ADR 0021). Pass `null` to subscribe to nothing — handy for a surface whose
 * entity is not resolved yet, and the reason this is safe to call
 * unconditionally.
 *
 * `onSignal` is held in a ref, so an inline closure does not churn the
 * subscription on every render; only the `channel` identity does. The signal is
 * a nudge, never rendered data: a handler should re-read authoritative state
 * (call its existing loader, or `router.refresh()`), which is what makes a
 * duplicate or replayed signal harmless.
 */
export function useLiveChannel(
  channel: string | null,
  onSignal: (signal: LiveSignal) => void
): void {
  const connection = useLiveConnection();
  const handlerRef = useRef(onSignal);

  useEffect(() => {
    handlerRef.current = onSignal;
  }, [onSignal]);

  useEffect(() => {
    if (!connection || channel === null) {
      return;
    }
    return connection.subscribe(channel, (signal) => {
      handlerRef.current(signal);
    });
  }, [connection, channel]);
}
