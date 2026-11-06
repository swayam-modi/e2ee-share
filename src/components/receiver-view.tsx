"use client";

import { useEffect, useRef, useState } from "react";
import { fromBase64Url } from "@/lib/core";
import type { FileOfferInfo } from "@/lib/core";
import { useReceiverSession } from "@/hooks/use-receiver-session";
import { FingerprintCard } from "@/components/fingerprint-card";
import { StatusBanner } from "@/components/status-banner";
import { ErrorScreen } from "@/components/error-screen";
import { LockIcon } from "@/components/lock-icon";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  formatDuration,
} from "@/lib/format";
import { CheckCircle2, Lock } from "lucide-react";
import gsap from "gsap";

export function ReceiverView({ roomId }: { roomId: string }) {
  const [state, actions] = useReceiverSession() as [
    ReturnType<typeof useReceiverSession>[0],
    ReturnType<typeof useReceiverSession>[1] & {
      acceptOffer: (fileIndex: number, offer: FileOfferInfo) => Promise<void>;
      declineOffer: (fileIndex: number) => void;
    },
  ];
  const [invalidLink, setInvalidLink] = useState(false);
  const transferStartRef = useRef<number | null>(null);
  const [transferDuration, setTransferDuration] = useState<number | null>(null);

  const startedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const offersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!startedRef.current) {
      startedRef.current = true;
      const hash = window.location.hash.slice(1);
      if (!hash) {
        setInvalidLink(true);
        return;
      }
      try {
        const secret = fromBase64Url(hash);
        if (secret.byteLength === 32) {
          history.replaceState(null, "", window.location.pathname);
          actions.start(roomId, secret);
        } else {
          setInvalidLink(true);
        }
      } catch {
        setInvalidLink(true);
      }
    }
    return () => {
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        actions.close();
        startedRef.current = false;
      }, 0);
    };
  }, []); // intentionally empty: runs once on mount only

  useEffect(() => {
    // Start timer when first file is accepted
    const hasAccepted = state.fileOffers.some((f) => f.status === "accepted");
    if (hasAccepted && transferStartRef.current === null) {
      transferStartRef.current = Date.now();
    }
    if (state.phase === "done" && transferStartRef.current !== null) {
      setTransferDuration(Date.now() - transferStartRef.current);
      transferStartRef.current = null;
    }
  }, [state.fileOffers, state.phase]);

  useEffect(() => {
    if (headerRef.current) {
      gsap.fromTo(
        headerRef.current,
        { opacity: 0, y: -8 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" },
      );
    }
  }, []);

  useEffect(() => {
    if (doneRef.current && state.phase === "done") {
      gsap.fromTo(
        doneRef.current,
        { opacity: 0, scale: 0.9 },
        { opacity: 1, scale: 1, duration: 0.45, ease: "power2.out" },
      );
    }
  }, [state.phase]);

  useEffect(() => {
    if (offersRef.current && state.fileOffers.length > 0) {
      const cards = offersRef.current.querySelectorAll("[data-offer-card]");
      gsap.fromTo(
        cards,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power2.out", stagger: 0.08 },
      );
    }
  }, [state.fileOffers.length]);

  if (invalidLink) {
    return (
      <div className="w-full max-w-lg">
        <ErrorScreen
          title="Invalid Link"
          message="This share link is invalid or malformed. Please ask the sender for a new link."
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg flex flex-col gap-6 py-2">
      {/* Header */}
      <header
        ref={headerRef}
        className="flex items-center justify-between mb-2"
      >
        <h1 className="text-xl font-semibold tracking-tight text-white">
          Receive Files Securely
        </h1>
        <LockIcon />
      </header>

      {/* Error state */}
      {state.phase === "failed" && state.error && (
        <ErrorScreen
          title={getErrorTitle(state.error.message)}
          message={state.error.message}
        />
      )}

      {/* Preparing keys */}
      {state.phase === "preparingKeys" && (
        <StatusBanner message="Preparing secure connection…" variant="info" />
      )}

      {/* Joining */}
      {state.phase === "joining" && (
        <StatusBanner message="Connecting to room…" variant="info" />
      )}

      {/* Waiting for key / sender to approve */}
      {state.phase === "waitingForKey" && (
        <>
          <StatusBanner
            message="Waiting for the sender to approve the connection…"
            variant="info"
            aria-live="polite"
          />
          {state.fingerprint && (
            <FingerprintCard
              fingerprint={state.fingerprint}
              hint="Share this fingerprint with the sender so they can verify they're connecting to you."
            />
          )}
        </>
      )}

      {/* RTC connecting */}
      {state.phase === "rtcConnecting" && (
        <StatusBanner
          message="Establishing encrypted connection…"
          variant="info"
        />
      )}

      {/* Ready */}
      {state.phase === "ready" && (
        <StatusBanner
          message="Connected! Waiting for files…"
          variant="success"
        />
      )}

      {/* File offers */}
      {state.fileOffers.length > 0 && state.phase !== "failed" && (
        <div ref={offersRef} className="flex flex-col gap-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-500">
            Incoming Files
          </p>
          {state.fileOffers.map(({ offer, status }) => {
            const p = state.progress.get(offer.fileIndex);
            const fraction = p ? p.bytesSent / Math.max(1, p.bytesTotal) : 0;
            const bytesLeft = p ? p.bytesTotal - p.bytesSent : offer.size;
            const isDone = p ? p.bytesSent >= p.bytesTotal : false;

            return (
              <div
                key={offer.fileIndex}
                data-offer-card
                className="rounded-xl border border-white/5 bg-card/80 backdrop-blur-sm p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {offer.name}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {formatBytes(offer.size)}
                      {offer.mime ? ` · ${offer.mime}` : ""}
                    </p>
                  </div>

                  {status === "pending" && (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() =>
                          void actions.acceptOffer(offer.fileIndex, offer)
                        }
                        aria-label={`Accept file ${offer.name}`}
                        className="bg-success/10 text-success hover:bg-success/20 border border-success/20 transition-all"
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => actions.declineOffer(offer.fileIndex)}
                        aria-label={`Decline file ${offer.name}`}
                        className="bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition-all"
                      >
                        Decline
                      </Button>
                    </div>
                  )}

                  {status === "declined" && (
                    <span
                      aria-label="File declined"
                      className="shrink-0 text-xs text-zinc-500"
                    >
                      Declined
                    </span>
                  )}

                  {status === "accepted" && isDone && (
                    <span
                      aria-label="File saved"
                      className="shrink-0 text-xs font-medium text-success flex items-center gap-1"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Saved
                    </span>
                  )}
                </div>

                {status === "accepted" && p && !isDone && (
                  <>
                    <div className="[&_[data-slot=progress-indicator]]:bg-success mt-3">
                      <Progress
                        value={Math.round(fraction * 100)}
                        aria-label={`Download progress for ${offer.name}`}
                        className="h-0.5"
                      />
                    </div>
                    <div className="flex justify-between text-xs text-zinc-600 mt-1">
                      <span>{formatSpeed(p.speed)}</span>
                      <span>ETA: {formatEta(bytesLeft, p.speed)}</span>
                    </div>
                  </>
                )}

                {status === "accepted" && isDone && (
                  <div className="flex items-center gap-1.5 text-xs text-success mt-2">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Saved to your device</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Done */}
      {state.phase === "done" && (
        <div
          ref={doneRef}
          className="flex flex-col items-center gap-4 py-10 text-center"
        >
          <Lock className="h-12 w-12 text-primary mb-4" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight text-white">
            All Files Received
          </h2>
          <p className="text-sm text-zinc-400">
            Your files have been saved securely.
          </p>
          {transferDuration !== null && (
            <p className="text-xs text-zinc-500 tabular-nums">
              Completed in {formatDuration(transferDuration)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function getErrorTitle(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("expired") || lower.includes("not found"))
    return "Room Expired";
  if (lower.includes("integrity") || lower.includes("auth"))
    return "Integrity Check Failed";
  if (
    lower.includes("ice") ||
    lower.includes("rtc") ||
    lower.includes("connection")
  ) {
    return "Connection Failed";
  }
  return "Transfer Failed";
}
