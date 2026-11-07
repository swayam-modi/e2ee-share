"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { SenderSession, randomBytes } from "@/lib/core";
import type { SenderState, TransferProgress } from "@/lib/core";
import type { ProtocolError } from "@/lib/protocol";
import { buildServerUrl, buildWsUrl } from "@/lib/links";
import { useThrottledProgress } from "@/hooks/use-throttled-progress";

export interface SenderSessionState {
  phase: SenderState;
  shareUrl: string | null;
  expiresAt: number | null;
  fingerprint: string | null;
  /** Progress per file index */
  progress: Map<number, TransferProgress>;
  error: ProtocolError | null;
}

export interface SenderSessionActions {
  start: (files: File[]) => Promise<void>;
  approve: () => void;
  reject: () => void;
  cancel: () => void;
  reset: () => void;
}

const initialState: SenderSessionState = {
  phase: "idle",
  shareUrl: null,
  expiresAt: null,
  fingerprint: null,
  progress: new Map(),
  error: null,
};

export function useSenderSession(): [SenderSessionState, SenderSessionActions] {
  const [state, setState] = useState<SenderSessionState>(initialState);
  const sessionRef = useRef<SenderSession | null>(null);
  const filesRef = useRef<File[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.cancel("component unmounted");
    };
  }, []);

  const updateProgress = useCallback((p: TransferProgress) => {
    setState((prev) => {
      const next = new Map(prev.progress);
      next.set(p.fileIndex, p);
      return { ...prev, progress: next };
    });
  }, []);

  const throttledProgress = useThrottledProgress(updateProgress);

  const start = useCallback(
    async (files: File[]) => {
      sessionRef.current?.cancel("new session started");
      sessionRef.current = null;
      filesRef.current = files;

      const secret = randomBytes(32);
      const session = new SenderSession({
        serverUrl: buildServerUrl(),
        wsUrl: buildWsUrl(),
        secret,
      });
      sessionRef.current = session;

      setState({
        ...initialState,
        phase: "creatingRoom",
      });

      session.on("stateChange", (phase) => {
        setState((prev) => ({ ...prev, phase }));
        if (phase === "ready") {
          session.sendFiles(filesRef.current);
        }
      });

      session.on("fingerprint", (fp) => {
        setState((prev) => ({ ...prev, fingerprint: fp }));
      });

      session.on("progress", throttledProgress);

      session.on("error", (err) => {
        setState((prev) => ({ ...prev, error: err }));
      });

      session.on("done", () => {
        setState((prev) => ({ ...prev, phase: "done" }));
      });

      try {
        const { shareUrl, expiresAt } = await session.start();
        setState((prev) => ({ ...prev, shareUrl, expiresAt }));
      } catch {
        // Error is emitted via the 'error' event; don't double-set state here
      }
    },
    [throttledProgress],
  );

  const approve = useCallback(() => {
    void sessionRef.current?.approveReceiver();
  }, []);

  const reject = useCallback(() => {
    sessionRef.current?.cancel("rejected by sender");
    setState((prev) => ({ ...prev, phase: "cancelled" }));
  }, []);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel("cancelled by user");
    sessionRef.current = null;
  }, []);

  const reset = useCallback(() => {
    sessionRef.current?.cancel("reset");
    sessionRef.current = null;
    filesRef.current = [];
    setState(initialState);
  }, []);

  return [state, { start, approve, reject, cancel, reset }];
}
