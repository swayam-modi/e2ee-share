"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSenderSession } from "@/hooks/use-sender-session";
import { DropZone } from "@/components/drop-zone";
import { FileList } from "@/components/file-list";
import { ShareLinkCard } from "@/components/share-link-card";
import { FingerprintCard } from "@/components/fingerprint-card";
import { StatusBanner } from "@/components/status-banner";
import { ErrorScreen } from "@/components/error-screen";
import { LockIcon } from "@/components/lock-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { formatDuration } from "@/lib/format";
import gsap from "gsap";

export function SenderView() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [state, actions] = useSenderSession();

  const headerRef = useRef<HTMLElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const approveRef = useRef<HTMLDivElement>(null);
  const startBtnRef = useRef<HTMLButtonElement>(null);

  // Transfer duration tracking
  const transferStartRef = useRef<number | null>(null);
  const [transferDuration, setTransferDuration] = useState<number | null>(null);

  // Header entrance
  useEffect(() => {
    if (headerRef.current) {
      gsap.fromTo(
        headerRef.current,
        { opacity: 0, y: -8 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" },
      );
    }
  }, []);

  // Done state entrance animation
  useEffect(() => {
    if (doneRef.current && state.phase === "done") {
      gsap.fromTo(
        doneRef.current,
        { opacity: 0, scale: 0.9 },
        { opacity: 1, scale: 1, duration: 0.45, ease: "power2.out" },
      );
    }
  }, [state.phase]);

  // Approve/reject buttons stagger
  useEffect(() => {
    if (approveRef.current && state.phase === "awaitingApproval") {
      const buttons = approveRef.current.querySelectorAll("button");
      gsap.fromTo(
        buttons,
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.35,
          ease: "power2.out",
          stagger: 0.08,
          delay: 0.1,
        },
      );
    }
  }, [state.phase]);

  // Start button entrance
  useEffect(() => {
    if (startBtnRef.current && selectedFiles.length > 0) {
      gsap.fromTo(
        startBtnRef.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" },
      );
    }
  }, [selectedFiles.length]);

  // Track transfer start/end time
  useEffect(() => {
    if (state.phase === "transferring" && transferStartRef.current === null) {
      transferStartRef.current = Date.now();
    }
    if (state.phase === "done" && transferStartRef.current !== null) {
      setTransferDuration(Date.now() - transferStartRef.current);
      transferStartRef.current = null;
    }
    if (state.phase === "idle") {
      transferStartRef.current = null;
      setTransferDuration(null);
    }
  }, [state.phase]);

  const handleFiles = useCallback((files: File[]) => {
    setSelectedFiles(files);
  }, []);

  const handleStart = useCallback(() => {
    if (selectedFiles.length === 0) return;
    void actions.start(selectedFiles);
  }, [selectedFiles, actions]);

  const handleReset = useCallback(() => {
    actions.reset();
    setSelectedFiles([]);
  }, [actions]);

  // Show share link only while waiting for receiver to open the link
  const showShareLink =
    state.shareUrl &&
    state.expiresAt &&
    state.phase === "waitingForReceiver";

  return (
    <div className="w-full max-w-lg flex flex-col gap-6 py-2">
      {/* Header */}
      <header
        ref={headerRef}
        className="flex items-center justify-between mb-2"
      >
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Send Files Securely
        </h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LockIcon />
        </div>
      </header>

      {/* Error state */}
      {state.phase === "failed" && state.error && (
        <ErrorScreen
          title="Transfer failed"
          message={state.error.message}
          onRetry={handleReset}
        />
      )}

      {/* Cancelled */}
      {state.phase === "cancelled" && (
        <div className="flex flex-col gap-4">
          <StatusBanner message="Transfer cancelled." variant="warning" />
          <Button
            variant="outline"
            onClick={handleReset}
            className="border-border text-muted-foreground hover:text-foreground"
          >
            Start Over
          </Button>
        </div>
      )}

      {/* Done state */}
      {state.phase === "done" && (
        <div
          ref={doneRef}
          className="flex flex-col items-center gap-4 py-10 text-center"
        >
          <Lock className="h-12 w-12 text-primary mb-4" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Transfer Complete
          </h2>
          <p className="text-sm text-muted-foreground">
            All files were sent successfully.
          </p>
          {transferDuration !== null && (
            <p className="text-xs text-muted-foreground/70 tabular-nums">
              Completed in {formatDuration(transferDuration)}
            </p>
          )}
          <Button
            onClick={handleReset}
            aria-label="Share more files"
            className="mt-2"
          >
            Share More Files
          </Button>
        </div>
      )}

      {/* Idle — file picker + start button */}
      {state.phase === "idle" && (
        <>
          <DropZone
            onFiles={handleFiles}
            selectedFiles={selectedFiles}
            disabled={false}
          />
          {selectedFiles.length > 0 && (
            <Button
              ref={startBtnRef}
              onClick={handleStart}
              aria-label="Create a secure share link"
              className="w-full"
              size="lg"
            >
              Create Secure Link
            </Button>
          )}
        </>
      )}

      {/* Creating room */}
      {state.phase === "creatingRoom" && (
        <StatusBanner message="Creating a secure room…" variant="info" />
      )}

      {/* Share link — hidden during active transfer */}
      {showShareLink && (
        <ShareLinkCard
          shareUrl={state.shareUrl!}
          expiresAt={state.expiresAt!}
        />
      )}

      {/* Waiting for receiver */}
      {state.phase === "waitingForReceiver" && (
        <StatusBanner
          message="Waiting for the recipient to open the link…"
          variant="info"
        />
      )}

      {/* Awaiting approval — fingerprint + approve/reject */}
      {state.phase === "awaitingApproval" && (
        <>
          <StatusBanner
            message="Recipient connected. Verify the fingerprint, then approve."
            variant="warning"
            aria-live="assertive"
          />
          {state.fingerprint && (
            <FingerprintCard
              fingerprint={state.fingerprint}
              hint="Optional: compare this fingerprint with what the recipient sees to confirm you're talking to the right person."
            />
          )}
          <div ref={approveRef} className="flex gap-3">
            <Button
              onClick={actions.approve}
              aria-label="Approve connection and begin transfer"
              className="flex-1 h-11 bg-success/10 text-success hover:bg-success/20 border border-success/20 transition-all"
            >
              Approve
            </Button>
            <Button
              onClick={actions.reject}
              aria-label="Reject connection"
              className="flex-1 h-11 bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition-all"
            >
              Reject
            </Button>
          </div>
        </>
      )}

      {/* Key exchange / RTC connecting */}
      {(state.phase === "keyExchange" || state.phase === "rtcConnecting") && (
        <StatusBanner
          message="Establishing encrypted connection…"
          variant="info"
        />
      )}

      {/* Ready — about to start */}
      {state.phase === "ready" && (
        <StatusBanner
          message="Connected! Starting transfer…"
          variant="success"
        />
      )}

      {/* Transferring — file list + cancel (NO share link card here) */}
      {(state.phase === "transferring" || state.phase === "ready") &&
        selectedFiles.length > 0 && (
          <>
            <FileList files={selectedFiles} progress={state.progress} />
            <Button
              onClick={actions.cancel}
              variant="outline"
              size="sm"
              aria-label="Cancel transfer"
              className="self-start text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
            >
              Cancel Transfer
            </Button>
          </>
        )}

      {/* Waiting for receiver to accept the file offer */}
      {state.phase === "transferring" &&
        selectedFiles.length > 0 &&
        state.progress.size === 0 && (
          <StatusBanner
            message="Waiting for receiver to accept the files…"
            variant="info"
          />
        )}

      {/* Actually sending */}
      {state.phase === "transferring" &&
        selectedFiles.length > 0 &&
        state.progress.size > 0 && (
          <StatusBanner message="Sending files…" variant="info" />
        )}
    </div>
  );
}
