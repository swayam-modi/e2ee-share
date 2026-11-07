"use client";

import { useEffect, useRef, useState } from "react";
import { fromBase64Url } from "@/lib/core";
import type { FileOfferInfo } from "@/lib/core";
import { useReceiverSession } from "@/hooks/use-receiver-session";
import { FingerprintCard } from "@/components/fingerprint-card";
import { StatusBanner } from "@/components/status-banner";
import { ErrorScreen } from "@/components/error-screen";
import { LockIcon } from "@/components/lock-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  formatDuration,
} from "@/lib/format";
import { CheckCircle2, Lock, Zap } from "lucide-react";
import gsap from "gsap";

// ─── Shared progress primitives (receiver-side) ───────────────────────────────

function CircleRing({
  pct,
  size = 72,
  stroke = 5,
  done = false,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  done?: boolean;
}) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - pct / 100);
  const cx = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      className="shrink-0 -rotate-90"
    >
      <circle cx={cx} cy={cx} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        className={done ? "stroke-success transition-[stroke-dashoffset] duration-500" : "transition-[stroke-dashoffset] duration-300"}
        style={done ? undefined : { stroke: "url(#rxRingGrad)" }}
      />
      {!done && (
        <defs>
          <linearGradient id="rxRingGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-success)" />
            <stop offset="100%" stopColor="oklch(from var(--color-success) l c calc(h + 20))" />
          </linearGradient>
        </defs>
      )}
    </svg>
  );
}

function SegmentBar({ pct, done = false }: { pct: number; done?: boolean }) {
  return (
    <div className="relative h-1.5 w-full rounded-full overflow-hidden bg-muted">
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${
          done ? "bg-success" : "bg-success/80"
        }`}
        style={{ width: `${pct}%` }}
      />
      {!done && pct > 0 && pct < 100 && (
        <div
          className="absolute inset-y-0 left-0 rounded-full overflow-hidden pointer-events-none"
          style={{ width: `${pct}%` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
        </div>
      )}
    </div>
  );
}

// ─── ReceiverView ─────────────────────────────────────────────────────────────

export function ReceiverView({ roomId }: { roomId: string }) {
  const [state, actions] = useReceiverSession() as [
    ReturnType<typeof useReceiverSession>[0],
    ReturnType<typeof useReceiverSession>[1] & {
      acceptOffer: (fileIndex: number, offer: FileOfferInfo) => Promise<void>;
      declineOffer: (fileIndex: number) => void;
      cancel: () => void;
      acceptAll: () => void;
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

  const isTransferring =
    state.fileOffers.some((f) => f.status === "accepted") &&
    state.progress.size > 0;

  const hasPendingOffers = state.fileOffers.some((f) => f.status === "pending");

  // Overall receive progress
  const totalBytes = [...state.fileOffers]
    .filter((f) => f.status === "accepted")
    .reduce((s, f) => s + f.offer.size, 0);
  const totalReceived = [...state.progress.values()].reduce(
    (s, p) => s + p.bytesSent,
    0,
  );
  const overallPct =
    totalBytes > 0 ? Math.min(100, Math.round((totalReceived / totalBytes) * 100)) : 0;
  const isAllDone = overallPct === 100 || state.phase === "done";
  const totalSpeed = [...state.progress.values()].reduce((s, p) => s + p.speed, 0);
  const bytesRemaining = Math.max(0, totalBytes - totalReceived);

  return (
    <div className="w-full max-w-lg flex flex-col gap-6 py-2">
      {/* Header */}
      <header
        ref={headerRef}
        className="flex items-center justify-between mb-2"
      >
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Receive Files Securely
        </h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LockIcon />
        </div>
      </header>

      {/* Cancelled */}
      {state.cancelled && (
        <StatusBanner message="Transfer cancelled." variant="warning" />
      )}

      {/* Error state */}
      {!state.cancelled && state.phase === "failed" && state.error && (
        <ErrorScreen
          title={getErrorTitle(state.error.message)}
          message={state.error.message}
        />
      )}

      {/* Preparing keys */}
      {!state.cancelled && state.phase === "preparingKeys" && (
        <StatusBanner message="Preparing secure connection…" variant="info" />
      )}

      {/* Joining */}
      {!state.cancelled && state.phase === "joining" && (
        <StatusBanner message="Connecting to room…" variant="info" />
      )}

      {/* Waiting for sender to approve */}
      {!state.cancelled && state.phase === "waitingForKey" && (
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
      {!state.cancelled && state.phase === "rtcConnecting" && (
        <StatusBanner
          message="Establishing encrypted connection…"
          variant="info"
        />
      )}

      {/* Ready — connected, waiting for offers */}
      {!state.cancelled &&
        state.phase === "ready" &&
        state.fileOffers.length === 0 && (
          <StatusBanner
            message="Connected! Waiting for files…"
            variant="success"
          />
        )}

      {/* Overall receive progress card — visible once transfer starts */}
      {!state.cancelled && isTransferring && (
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center gap-4 px-5 py-4">
            {/* Circle ring */}
            <div className="relative shrink-0">
              <CircleRing pct={overallPct} size={72} stroke={5} done={isAllDone} />
              <div className="absolute inset-0 flex items-center justify-center">
                {isAllDone ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <span className="text-[13px] font-bold tabular-nums text-foreground leading-none">
                    {overallPct}%
                  </span>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Receiving
                </span>
                {!isAllDone && totalSpeed > 0 && (
                  <span className="flex items-center gap-1 text-xs font-mono text-foreground">
                    <Zap className="h-3 w-3 text-warning" />
                    {formatSpeed(totalSpeed)}
                  </span>
                )}
              </div>

              <SegmentBar pct={overallPct} done={isAllDone} />

              <div className="flex items-center justify-between text-[11px] text-muted-foreground/70 tabular-nums mt-0.5">
                <span />
                <span>
                  {isAllDone ? (
                    <span className="text-success font-medium">Complete</span>
                  ) : totalSpeed > 0 ? (
                    `ETA ${formatEta(bytesRemaining, totalSpeed)} · ${formatBytes(totalReceived)} / ${formatBytes(totalBytes)}`
                  ) : (
                    `${formatBytes(totalReceived)} / ${formatBytes(totalBytes)}`
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File offers */}
      {!state.cancelled &&
        state.fileOffers.length > 0 &&
        state.phase !== "failed" && (
          <div ref={offersRef} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
                Incoming Files
              </p>
              {/* Show Accept All whenever there's at least one pending offer and not already auto-accepting */}
              {state.fileOffers.some((f) => f.status === "pending") && !state.autoAccepting && (
                <Button
                  size="sm"
                  onClick={actions.acceptAll}
                  aria-label="Accept all incoming files automatically"
                  className="h-7 px-3 text-xs bg-success/10 text-success hover:bg-success/20 border border-success/20 transition-all"
                >
                  Accept All
                </Button>
              )}
              {/* Badge when auto-accept is active */}
              {state.autoAccepting && (
                <span className="flex items-center gap-1.5 text-[11px] text-success font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  Auto-accepting
                </span>
              )}
            </div>

            {state.fileOffers.map(({ offer, status }) => {
              const p = state.progress.get(offer.fileIndex);
              const pct = p
                ? Math.min(100, Math.round((p.bytesSent / Math.max(1, p.bytesTotal)) * 100))
                : 0;
              const bytesLeft = p ? p.bytesTotal - p.bytesSent : offer.size;
              const isDone = p ? p.bytesSent >= p.bytesTotal : false;
              const isActive = !!p && !isDone;

              return (
                <div
                  key={offer.fileIndex}
                  data-offer-card
                  className={`rounded-2xl border bg-card shadow-sm px-4 py-3.5 flex flex-col gap-2 transition-colors ${
                    isDone ? "border-success/30" : "border-border"
                  }`}
                >
                  {/* Top row */}
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {offer.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatBytes(offer.size)}
                        {offer.mime ? ` · ${offer.mime}` : ""}
                      </p>
                    </div>

                    {/* Status / actions */}
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
                      <span className="shrink-0 text-xs text-muted-foreground mt-0.5">
                        Declined
                      </span>
                    )}

                    {status === "accepted" && !isActive && isDone && (
                      <span className="shrink-0 text-xs font-medium text-success flex items-center gap-1 mt-0.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Saved
                      </span>
                    )}

                    {status === "accepted" && isActive && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground mt-0.5">
                        {formatBytes(p.bytesSent)} / {formatBytes(p.bytesTotal)}
                      </span>
                    )}
                  </div>

                  {/* Accepted but waiting for bytes */}
                  {status === "accepted" && !p && !isDone && (
                    <p className="text-xs text-muted-foreground/60">
                      Accepted — waiting for sender…
                    </p>
                  )}

                  {/* Active progress */}
                  {isActive && (
                    <>
                      <SegmentBar pct={pct} done={false} />
                      <div className="flex justify-between text-[11px] text-muted-foreground/60 tabular-nums">
                        <span>{formatSpeed(p.speed)}</span>
                        <span>ETA {formatEta(bytesLeft, p.speed)}</span>
                      </div>
                    </>
                  )}

                  {/* Done checkmark row */}
                  {isDone && (
                    <div className="flex items-center gap-1.5 text-xs text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Saved to your device
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      {/* Cancel button */}
      {!state.cancelled &&
        isTransferring &&
        !hasPendingOffers &&
        state.phase !== "done" && (
          <Button
            onClick={actions.cancel}
            variant="outline"
            size="sm"
            aria-label="Cancel transfer"
            className="self-start text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
          >
            Cancel Transfer
          </Button>
        )}

      {/* Receiving status banner */}
      {!state.cancelled && isTransferring && state.phase !== "done" && (
        <StatusBanner message="Receiving files…" variant="info" />
      )}

      {/* Done */}
      {!state.cancelled && state.phase === "done" && (
        <div
          ref={doneRef}
          className="flex flex-col items-center gap-4 py-10 text-center"
        >
          <Lock className="h-12 w-12 text-primary mb-4" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            All Files Received
          </h2>
          <p className="text-sm text-muted-foreground">
            Your files have been saved securely.
          </p>
          {transferDuration !== null && (
            <p className="text-xs text-muted-foreground/70 tabular-nums">
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
  )
    return "Connection Failed";
  return "Transfer Failed";
}
