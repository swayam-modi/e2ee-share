"use client";

import { useEffect, useRef, useState } from "react";
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "@/components/ui/progress";
import type { TransferProgress } from "@/lib/core";
import { formatBytes, formatSpeed, formatEta, formatDuration } from "@/lib/format";
import { CheckCircle2, Clock, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import gsap from "gsap";

/** Live elapsed-time ticker for a single file row */
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="tabular-nums">{formatDuration(elapsed)}</span>;
}

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
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: 0.05 },
      );
    }
  }, []);

  if (files.length === 0) return null;

  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const totalSent = [...progress.values()].reduce((s, p) => s + p.bytesSent, 0);
  const overallFraction = totalBytes > 0 ? totalSent / totalBytes : 0;
  const overallPct = Math.round(overallFraction * 100);
  const isAllDone = overallPct === 100;

  // aggregate speed from all active files
  const totalSpeed = [...progress.values()].reduce((s, p) => s + p.speed, 0);
  const bytesRemaining = totalBytes - totalSent;

  return (
    <div
      ref={listRef}
      className="rounded-xl border border-border bg-card/80 backdrop-blur-sm overflow-hidden"
    >
      {/* ── Overall transfer header ── */}
      {progress.size > 0 && (
        <div className="px-4 pt-4 pb-3 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between mb-2 gap-3">
            <span className="text-xs font-semibold text-foreground uppercase tracking-widest">
              Overall
            </span>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* elapsed */}
              {transferStartedAt && !isAllDone && (
                <Badge variant="secondary" className="gap-1 font-mono text-[11px] px-2 py-0.5">
                  <Clock className="h-3 w-3" />
                  <ElapsedTimer startedAt={transferStartedAt} />
                </Badge>
              )}
              {/* speed */}
              {totalSpeed > 0 && !isAllDone && (
                <Badge variant="secondary" className="gap-1 font-mono text-[11px] px-2 py-0.5">
                  <Zap className="h-3 w-3 text-warning" />
                  {formatSpeed(totalSpeed)}
                </Badge>
              )}
              {/* percent */}
              <span className="text-sm font-bold tabular-nums text-foreground">
                {overallPct}%
              </span>
            </div>
          </div>

          {/* Overall progress bar — taller, coloured */}
          <Progress value={overallPct} className="gap-0">
            <ProgressLabel className="sr-only">Overall progress</ProgressLabel>
            <ProgressValue className="sr-only">{overallPct}%</ProgressValue>
            <ProgressTrack className="h-2.5 rounded-full bg-muted">
              <ProgressIndicator
                className={`rounded-full transition-all duration-300 ${
                  isAllDone
                    ? "bg-success"
                    : "bg-gradient-to-r from-primary via-primary/90 to-primary/70"
                }`}
              />
            </ProgressTrack>
          </Progress>

          {/* ETA row */}
          {!isAllDone && totalSpeed > 0 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground/70 text-right tabular-nums">
              ETA {formatEta(bytesRemaining, totalSpeed)} ·{" "}
              {formatBytes(totalSent)} / {formatBytes(totalBytes)}
            </p>
          )}
        </div>
      )}

      {/* ── Per-file rows ── */}
      {files.map((file, i) => {
        const p = progress.get(i);
        const fraction = p ? p.bytesSent / Math.max(1, p.bytesTotal) : 0;
        const pct = Math.round(fraction * 100);
        const isDone = p ? p.bytesSent >= p.bytesTotal : false;
        const bytesLeft = p ? p.bytesTotal - p.bytesSent : file.size;
        const isActive = p && !isDone;

        return (
          <div
            key={i}
            data-file-row
            className="px-4 py-3 border-b border-border last:border-0 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              {/* File name + status dot */}
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`shrink-0 h-1.5 w-1.5 rounded-full ${
                    isDone
                      ? "bg-success"
                      : isActive
                        ? "bg-primary animate-pulse"
                        : "bg-muted-foreground/30"
                  }`}
                />
                <p className="text-sm font-medium text-foreground truncate leading-tight">
                  {file.name}
                </p>
              </div>

              {/* Right-side status */}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {isDone ? (
                  <span className="text-success font-semibold flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Sent
                  </span>
                ) : p ? (
                  `${formatBytes(p.bytesSent)} / ${formatBytes(p.bytesTotal)}`
                ) : (
                  <span className="text-muted-foreground/50">{formatBytes(file.size)}</span>
                )}
              </span>
            </div>

            {/* Per-file progress bar */}
            {isActive && (
              <>
                <Progress value={pct} className="mt-2 gap-0">
                  <ProgressTrack className="h-1 rounded-full bg-muted">
                    <ProgressIndicator className="rounded-full bg-success/80 transition-all duration-300" />
                  </ProgressTrack>
                </Progress>
                <div className="flex justify-between text-[11px] text-muted-foreground/60 mt-1 tabular-nums">
                  <span>{formatSpeed(p.speed)}</span>
                  <span>ETA {formatEta(bytesLeft, p.speed)}</span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
