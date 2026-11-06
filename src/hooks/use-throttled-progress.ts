"use client";

import { useCallback, useRef } from "react";
import type { TransferProgress } from "@/lib/core";

/**
 * Returns a stable throttled wrapper around a progress updater callback.
 * At most one call per ~100 ms (10 updates/sec).
 */
export function useThrottledProgress(
  onUpdate: (p: TransferProgress) => void,
): (p: TransferProgress) => void {
  const lastCallRef = useRef<number>(0);
  const pendingRef = useRef<TransferProgress | null>(null);
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    if (p) {
      pendingRef.current = null;
      lastCallRef.current = performance.now();
      onUpdate(p);
    }
  }, [onUpdate]);

  return useCallback(
    (p: TransferProgress) => {
      pendingRef.current = p;
      const now = performance.now();
      const elapsed = now - lastCallRef.current;
      if (elapsed >= 100) {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        pendingRef.current = null;
        lastCallRef.current = now;
        onUpdate(p);
      } else if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [flush, onUpdate],
  );
}
