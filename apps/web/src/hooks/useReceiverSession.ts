import { useState, useCallback, useRef, useEffect } from 'react';
import { ReceiverSession, BlobSink, FsAccessSink } from '@e2ee-share/core';
import type { ReceiverState, TransferProgress, FileOfferInfo } from '@e2ee-share/core';
import type { ProtocolError } from '@e2ee-share/protocol';
import { buildServerUrl } from '../utils/links.js';
import { useThrottledProgress } from './useThrottledProgress.js';

export interface FileOfferUIState {
  offer: FileOfferInfo;
  status: 'pending' | 'accepted' | 'declined';
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
}

const initialState: ReceiverSessionState = {
  phase: 'idle',
  fingerprint: null,
  error: null,
  fileOffers: [],
  progress: new Map(),
};

/** 100 MB threshold — above this we try FsAccessSink */
const FS_ACCESS_THRESHOLD = 100 * 1024 * 1024;

/** Minimal type for the File System Access API save picker (Chromium only). */
interface FsaWindow {
  showSaveFilePicker(opts?: { suggestedName?: string }): Promise<FileSystemFileHandle>;
}

/** Check whether the File System Access API save picker is available. */
function hasFsAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as FsaWindow).showSaveFilePicker === 'function'
  );
}

export function useReceiverSession(): [ReceiverSessionState, ReceiverSessionActions] {
  const [state, setState] = useState<ReceiverSessionState>(initialState);
  const sessionRef = useRef<ReceiverSession | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.close();
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
    (roomId: string, secret: Uint8Array) => {
      sessionRef.current?.close();
      sessionRef.current = null;

      setState({ ...initialState, phase: 'preparingKeys' });

      const session = new ReceiverSession({
        roomId,
        secret,
        serverUrl: buildServerUrl(),
        onFileOffer: async (offer: FileOfferInfo) => {
          // Add offer to UI state as 'pending'
          setState((prev) => ({
            ...prev,
            fileOffers: [
              ...prev.fileOffers,
              { offer, status: 'pending' as const },
            ],
          }));

          // Wait for user to accept or decline via pendingResolversRef
          return new Promise<import('@e2ee-share/core').FileSink | null>((resolve) => {
            pendingResolversRef.current.set(offer.fileIndex, resolve);
          });
        },
      });
      sessionRef.current = session;

      session.on('stateChange', (phase) => {
        setState((prev) => ({ ...prev, phase }));
      });

      session.on('fingerprint', (fp) => {
        setState((prev) => ({ ...prev, fingerprint: fp }));
      });

      session.on('progress', throttledProgress);

      session.on('error', (err) => {
        setState((prev) => ({ ...prev, error: err }));
      });

      session.on('done', () => {
        setState((prev) => ({ ...prev, phase: 'done' }));
      });

      void session.start();
    },
    [throttledProgress]
  );

  // Map of fileIndex -> resolve function for pending file offers
  const pendingResolversRef = useRef<
    Map<number, (sink: import('@e2ee-share/core').FileSink | null) => void>
  >(new Map());

  const acceptOffer = useCallback(async (fileIndex: number, offer: FileOfferInfo) => {
    setState((prev) => ({
      ...prev,
      fileOffers: prev.fileOffers.map((f) =>
        f.offer.fileIndex === fileIndex ? { ...f, status: 'accepted' as const } : f
      ),
    }));

    const resolve = pendingResolversRef.current.get(fileIndex);
    if (!resolve) return;
    pendingResolversRef.current.delete(fileIndex);

    // Choose sink
    if (offer.size > FS_ACCESS_THRESHOLD && hasFsAccess()) {
      try {
        const fh = await (window as unknown as FsaWindow).showSaveFilePicker({ suggestedName: offer.name });
        const writable = await fh.createWritable();
        resolve(new FsAccessSink(writable));
        return;
      } catch {
        // User cancelled picker or not supported — fall through to BlobSink
      }
    }
    resolve(new BlobSink(offer.name));
  }, []);

  const declineOffer = useCallback((fileIndex: number) => {
    setState((prev) => ({
      ...prev,
      fileOffers: prev.fileOffers.map((f) =>
        f.offer.fileIndex === fileIndex ? { ...f, status: 'declined' as const } : f
      ),
    }));

    const resolve = pendingResolversRef.current.get(fileIndex);
    if (!resolve) return;
    pendingResolversRef.current.delete(fileIndex);
    resolve(null);
  }, []);

  // Expose acceptOffer and declineOffer via a stable ref so ReceiverPage can call them
  const actionsRef = useRef({ acceptOffer, declineOffer });
  actionsRef.current = { acceptOffer, declineOffer };

  // Attach actions to the returned object via a stable wrapper
  const actions: ReceiverSessionActions & {
    acceptOffer: (fileIndex: number, offer: FileOfferInfo) => Promise<void>;
    declineOffer: (fileIndex: number) => void;
  } = {
    start,
    acceptOffer: useCallback(
      (fileIndex: number, offer: FileOfferInfo) =>
        actionsRef.current.acceptOffer(fileIndex, offer),
      []
    ),
    declineOffer: useCallback(
      (fileIndex: number) => actionsRef.current.declineOffer(fileIndex),
      []
    ),
  };

  return [state, actions];
}
