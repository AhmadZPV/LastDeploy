"use client";

import { useEffect } from "react";

/**
 * Unregister any service workers left over from other projects that once ran
 * on this origin (e.g. the PWA-enabled source app on localhost:3000). A stale
 * SW keeps serving its cached HTML, which makes the current app's client bundle
 * hydrate against the wrong markup and throw a "Hydration failed" error.
 *
 * This runs once on mount: it clears every registration and, if a worker was
 * actively controlling the page, reloads once so the fresh (uncontrolled)
 * document loads. Our app never registers a worker, so there is no loop.
 */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const cleanup = async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length === 0) return;
      await Promise.all(regs.map((r) => r.unregister()));
      if (navigator.serviceWorker.controller) {
        window.location.reload();
      }
    };
    cleanup();
  }, []);

  return null;
}
