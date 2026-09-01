import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useReducedMotion } from "./use-reduced-motion";

type Listener = () => void;

/**
 * jsdom does not implement `matchMedia` at all, so each test that needs one
 * installs a fake and removes it again — which is also what makes the hook's
 * missing-`matchMedia` branch a real path rather than dead defence.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>();
  const media = {
    addEventListener: (_type: string, listener: Listener) => {
      listeners.add(listener);
    },
    matches,
    removeEventListener: (_type: string, listener: Listener) => {
      listeners.delete(listener);
    },
  };
  const matchMedia = vi.fn(() => media);

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: matchMedia,
    writable: true,
  });

  return {
    emitChange: (next: boolean) => {
      media.matches = next;
      for (const listener of listeners) {
        listener();
      }
    },
    listenerCount: () => listeners.size,
    matchMedia,
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

describe("useReducedMotion", () => {
  it("reports no preference where matchMedia does not exist", () => {
    expect(window.matchMedia).toBeUndefined();

    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
  });

  it("reads the viewer's preference on mount", () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(true);
  });

  it("stays false when the viewer has not asked for reduced motion", () => {
    stubMatchMedia(false);

    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
  });

  it("follows the preference changing while mounted", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());

    act(() => media.emitChange(true));

    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount", () => {
    const media = stubMatchMedia(true);
    const { unmount } = renderHook(() => useReducedMotion());

    expect(media.listenerCount()).toBe(1);
    unmount();

    expect(media.listenerCount()).toBe(0);
  });
});
