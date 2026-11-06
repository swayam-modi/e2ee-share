"use client";

import { useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import type { TransferProgress } from "@/lib/core";
import { formatBytes, formatSpeed, formatEta } from "@/lib/format";
import { CheckCircle2 } from "lucide-react";
import gsap from "gsap";

export function FileList({
  files,
  progress,
}: {
  files: File[];
  progress: Map<number, TransferProgress>;
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

  return (
    <div
      ref={listRef}
      className="rounded-xl border border-white/5 bg-card/80 backdrop-blur-sm overflow-hidden"
    >
      {files.map((file, i) => {
        const p = progress.get(i);
        const fraction = p ? p.bytesSent / Math.max(1, p.bytesTotal) : 0;
        const isDone = p ? p.bytesSent >= p.bytesTotal : false;
        const bytesLeft = p ? p.bytesTotal - p.bytesSent : file.size;

        return (
          <div
            key={i}
            data-file-row
            className="px-4 py-3 border-b border-white/5 last:border-0"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-white truncate leading-tight">
                {file.name}
              </p>
              <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
                {isDone ? (
                  <span className="text-success font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Sent
                  </span>
                ) : p ? (
                  `${formatBytes(p.bytesSent)} / ${formatBytes(p.bytesTotal)}`
                ) : (
                  formatBytes(file.size)
                )}
              </span>
            </div>
            {p && !isDone && (
              <>
                <div className="[&_[data-slot=progress-indicator]]:bg-success mt-2">
                  <Progress
                    value={Math.round(fraction * 100)}
                    className="h-0.5"
                  />
                </div>
                <div className="flex justify-between text-xs text-zinc-600 mt-1">
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
