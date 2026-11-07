"use client";

import { useEffect, useRef, useState } from "react";
import type { TransferProgress } from "@/lib/core";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  formatDuration,
} from "@/lib/format";
import { CheckCircle2, Zap } from "lucide-react";
import gsap from "gsap";

// ─── SVG circular ring ────────────────────────────────────────────────────────

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
      {/* Track */}
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        strokeWidth={stroke}
        className="stroke-muted"
      />
      {/* Progress arc */}
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        className={
          done
            ? "stroke-success transition-[stroke-dashoffset] duration-500"
            : "transition-[stroke-dashoffset] duration-300"
        }
        style={
          done
            ? undefined
            : {
                stroke: "url(#ringGrad)",
              }
        }
      />
      {/* Gradient def */}
      {!done && (
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="100%" stopColor="oklch(from var(--color-primary) l c calc(h + 30))" />
          </linearGradient>
        </defs>
      )}
    </svg>
  );
}

// ─── Segmented / shimmer bar ──────────────────────────────────────────────────

function SegmentBar({
  pct,
  done = false,
}: {
  pct: number;
  done?: boolean;
}) {
  return (
    <div className="relative h-1.5 w-full rounded-full overflow-hidden bg-muted">
      {/* Filled portion */}
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${
          done ? "bg-success" : "bg-primary"
        }`}
        style={{ width: `${pct}%` }}
      />
      {/* Shimmer overlay — only when active */}
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

// ─── Live elapsed timer ───────────────────────────────────────────────────────

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="tabular-nums">{formatDuration(elapsed)}</span>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FileList({
  files,
  progress,
  transferStartedAt,
}: {
  files: File[];
  progress: Map<number, TransferProgress>;
  transferStartedAt?: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      const rows = listRef.current.querySelectorAll("[data-file-row]");
      gsap.fromTo(
        rows,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: 0.06 },
      );
    }
  }, []);

  if (files.length === 0) return null;

  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const totalSent = [...progress.values()].reduce((s, p) => s + p.bytesSent, 0);
  const overallPct = totalBytes > 0 ? Math.round((totalSent / totalBytes) * 100) : 0;
  const isAllDone = overallPct === 100;
  const totalSpeed = [...progress.values()].reduce((s, p) => s + p.speed, 0);
  const bytesRemaining = totalBytes - totalSent;

  return (
    <div ref={listRef} className="flex flex-col gap-3">
      {/* ── Overall card with circle ring ── */}
      {progress.size > 0 && (
        <div
          data-file-row
          className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
        >
          <div className="flex items-center gap-4 px-5 py-4">
            {/* Circle ring */}
            <div className="relative shrink-0">
              <CircleRing pct={overallPct} size={72} stroke={5} done={isAllDone} />
              {/* Center label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
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
                  Overall
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
                {transferStartedAt && !isAllDone ? (
                  <ElapsedTimer startedAt={transferStartedAt} />
                ) : (
                  <span />
                )}
                <span>
                  {isAllDone ? (
                    <span className="text-success font-medium">Complete</span>
                  ) : totalSpeed > 0 ? (
                    `ETA ${formatEta(bytesRemaining, totalSpeed)} · ${formatBytes(totalSent)} / ${formatBytes(totalBytes)}`
                  ) : (
                    `${formatBytes(totalSent)} / ${formatBytes(totalBytes)}`
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Per-file rows ── */}
      {files.map((file, i) => {
        const p = progress.get(i);
        const pct = p
          ? Math.min(100, Math.round((p.bytesSent / Math.max(1, p.bytesTotal)) * 100))
          : 0;
        const isDone = p ? p.bytesSent >= p.bytesTotal : false;
        const isActive = !!p && !isDone;
        const bytesLeft = p ? p.bytesTotal - p.bytesSent : file.size;

        return (
          <div
            key={i}
            data-file-row
            className={`rounded-2xl border bg-card shadow-sm px-4 py-3.5 flex flex-col gap-2 transition-colors ${
              isDone ? "border-success/30" : "border-border"
            }`}
          >
            {/* Top row */}
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Status dot */}
              <span
                className={`shrink-0 h-2 w-2 rounded-full transition-colors ${
                  isDone
                    ? "bg-success"
                    : isActive
                      ? "bg-primary animate-pulse"
                      : "bg-muted-foreground/25"
                }`}
              />

              {/* File name */}
              <p className="flex-1 text-sm font-medium text-foreground truncate">
                {file.name}
              </p>

              {/* Right label */}
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {isDone ? (
                  <span className="flex items-center gap-1 text-success font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Sent
                  </span>
                ) : p ? (
                  `${formatBytes(p.bytesSent)} / ${formatBytes(p.bytesTotal)}`
                ) : (
                  <span className="text-muted-foreground/40">
                    {formatBytes(file.size)}
                  </span>
                )}
              </span>
            </div>

            {/* Progress bar + speed/eta */}
            {(isActive || isDone) && (
              <>
                <SegmentBar pct={pct} done={isDone} />
                {isActive && (
                  <div className="flex justify-between text-[11px] text-muted-foreground/60 tabular-nums">
                    <span>{formatSpeed(p.speed)}</span>
                    <span>ETA {formatEta(bytesLeft, p.speed)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
