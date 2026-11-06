"use client";

import { useState, useCallback, useRef } from "react";
import { ReceiverSession, BlobSink, FsAccessSink } from "@/lib/core";
import type {
  ReceiverState,
  TransferProgress,
  FileOfferInfo,
} from "@/lib/core";
import type { ProtocolError } from "@/lib/protocol";
import { buildServerUrl, buildWsUrl } from "@/lib/links";
import { useThrottledProgress } from "@/hooks/use-throttled-progress";

export interface FileOfferUIState {
  offer: FileOfferInfo;
  status: "pending" | "accepted" | "declined";
}

export interface ReceiverSessionState {
  phase: ReceiverState;
  fingerprint: string | null;
  error: ProtocolError | null;
  fileOffers: FileOfferUIState[];
  progress: Map<number, TransferProgress>;
}

export interface ReceiverSessionActions {
  start: (roomId: string, secret: Uint8Array) => void;
  close: () => void;
}

const initialState: ReceiverSessionState = {
  phase: "idle",
  fingerprint: null,
  error: null,
  fileOffers: [],
  progress: new Map(),
};

/** 100 MB threshold — above this we try FsAccessSink */
const FS_ACCESS_THRESHOLD = 100 * 1024 * 1024;

interface FsaWindow {
  showSaveFilePicker(opts?: {
    suggestedName?: string;
  }): Promise<FileSystemFileHandle>;
}

function hasFsAccess(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as FsaWindow).showSaveFilePicker === "function"
  );
}

export function useReceiverSession(): [
  ReceiverSessionState,
  ReceiverSessionActions,
] {
  const [state, setState] = useState<ReceiverSessionState>(initialState);
  const sessionRef = useRef<ReceiverSession | null>(null);

  const close = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
  }, []);

  const updateProgress = useCallback((p: TransferProgress) => {
    setState((prev) => {
      const next = new Map(prev.progress);
      next.set(p.fileIndex, p);
      return { ...prev, progress: next };
    });
  }, []);

  const throttledProgress = useThrottledProgress(updateProgress);

  const pendingResolversRef = useRef<
    Map<number, (sink: import("@/lib/core").FileSink | null) => void>
  >(new Map());

  const start = useCallback(
    (roomId: string, secret: Uint8Array) => {
      sessionRef.current?.close();
      sessionRef.current = null;

      setState({ ...initialState, phase: "preparingKeys" });

      const session = new ReceiverSession({
        roomId,
        secret,
        serverUrl: buildServerUrl(),
        wsUrl: buildWsUrl(),
        onFileOffer: async (offer: FileOfferInfo) => {
          setState((prev) => ({
            ...prev,
            fileOffers: [
              ...prev.fileOffers,
              { offer, status: "pending" as const },
            ],
          }));

          return new Promise<import("@/lib/core").FileSink | null>(
            (resolve) => {
              pendingResolversRef.current.set(offer.fileIndex, resolve);
            },
          );
        },
      });
      sessionRef.current = session;

      session.on("stateChange", (phase) => {
        setState((prev) => ({ ...prev, phase }));
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

      void session.start();
    },
    [throttledProgress],
  );

  const acceptOffer = useCallback(
    async (fileIndex: number, offer: FileOfferInfo) => {
      setState((prev) => ({
        ...prev,
        fileOffers: prev.fileOffers.map((f) =>
          f.offer.fileIndex === fileIndex
            ? { ...f, status: "accepted" as const }
            : f,
        ),
      }));

      const resolve = pendingResolversRef.current.get(fileIndex);
      if (!resolve) return;
      pendingResolversRef.current.delete(fileIndex);

      if (offer.size > FS_ACCESS_THRESHOLD && hasFsAccess()) {
        try {
          const fh = await (window as unknown as FsaWindow).showSaveFilePicker({
            suggestedName: offer.name,
          });
          const writable = await fh.createWritable();
          resolve(new FsAccessSink(writable));
          return;
        } catch {
          // User cancelled picker or not supported — fall through to BlobSink
        }
      }
      resolve(new BlobSink(offer.name));
    },
    [],
  );

  const declineOffer = useCallback((fileIndex: number) => {
    setState((prev) => ({
      ...prev,
      fileOffers: prev.fileOffers.map((f) =>
        f.offer.fileIndex === fileIndex
          ? { ...f, status: "declined" as const }
          : f,
      ),
    }));

    const resolve = pendingResolversRef.current.get(fileIndex);
    if (!resolve) return;
    pendingResolversRef.current.delete(fileIndex);
    resolve(null);
  }, []);

  const actionsRef = useRef({ acceptOffer, declineOffer });
  actionsRef.current = { acceptOffer, declineOffer };

  const actions: ReceiverSessionActions & {
    acceptOffer: (fileIndex: number, offer: FileOfferInfo) => Promise<void>;
    declineOffer: (fileIndex: number) => void;
  } = {
    start,
    close,
    acceptOffer: useCallback(
      (fileIndex: number, offer: FileOfferInfo) =>
        actionsRef.current.acceptOffer(fileIndex, offer),
      [],
    ),
    declineOffer: useCallback(
      (fileIndex: number) => actionsRef.current.declineOffer(fileIndex),
      [],
    ),
  };

  return [state, actions];
}
