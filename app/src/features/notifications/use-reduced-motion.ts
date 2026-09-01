"use client";

import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the viewer has asked for reduced motion.
 *
 * Returns false until the effect runs, so the server render and the first
 * client render agree; a viewer who wants reduced motion gets it on the same
 * tick as hydration, before anything has had time to move.
 *
 * The `matchMedia` guard is not decoration: the jsdom environment the unit
 * suite runs in does not define it, and neither does any non-browser render
 * path. Without the guard the whole notification surface throws there.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => setReduced(media.matches);

    sync();
    media.addEventListener("change", sync);

    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}
