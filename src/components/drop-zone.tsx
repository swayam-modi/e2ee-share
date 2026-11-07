"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { FileUp, X, FolderOpen } from "lucide-react";
import { formatBytes } from "@/lib/format";
import gsap from "gsap";

/** Tiny chip showing one selected file with a remove button */
function FileChip({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-1.5 bg-muted/60 border border-border rounded-full pl-3 pr-1.5 py-1 text-xs text-foreground max-w-[220px]">
      <span className="truncate flex-1">{file.name}</span>
      <span className="shrink-0 text-muted-foreground/70 tabular-nums">
        {formatBytes(file.size)}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${file.name}`}
        className="shrink-0 rounded-full p-0.5 hover:bg-destructive/15 hover:text-destructive transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </li>
  );
}

export function DropZone({
  onFiles,
  selectedFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  selectedFiles: File[];
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);

  /* ── Entrance animation ── */
  useEffect(() => {
    if (rootRef.current) {
      gsap.fromTo(
        rootRef.current,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
      );
    }
  }, []);

  /* ── Chips stagger-in when new files added ── */
  useEffect(() => {
    if (chipsRef.current && selectedFiles.length > 0) {
      const items = chipsRef.current.querySelectorAll("li");
      gsap.fromTo(
        items,
        { opacity: 0, scale: 0.85, y: 4 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.25,
          ease: "back.out(1.4)",
          stagger: 0.04,
        },
      );
    }
  }, [selectedFiles.length]);

  /** Deduplicate by name+size — prevents the same file being added twice */
  const mergeFiles = useCallback(
    (incoming: File[]): File[] => {
      const existing = new Set(selectedFiles.map((f) => `${f.name}::${f.size}`));
      const deduped = incoming.filter((f) => !existing.has(`${f.name}::${f.size}`));
      return [...selectedFiles, ...deduped];
    },
    [selectedFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(mergeFiles(files));
    },
    [onFiles, disabled, mergeFiles],
  );

  const removeFile = useCallback(
    (index: number) => {
      const next = selectedFiles.filter((_, i) => i !== index);
      onFiles(next);
    },
    [selectedFiles, onFiles],
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {/* ── Drop target ── */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Drop files here or click to browse"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) =>
          e.key === "Enter" && !disabled && inputRef.current?.click()
        }
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          // Base layout — Google Lens-style: wide, short, centered row
          "relative flex items-center justify-center gap-6 rounded-2xl",
          "px-8 py-10 cursor-pointer outline-none select-none",
          "border-2 border-dashed transition-all duration-200",
          // Solid background so it never bleeds into page bg
          "bg-card shadow-sm",
          // Focus ring
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          dragging
            ? [
                "border-primary scale-[1.01]",
                "bg-primary/5",
                "shadow-[0_0_32px_theme(colors.primary/0.18)]",
              ]
            : [
                "border-border/60",
                "hover:border-primary/50",
                "hover:bg-muted/30",
              ],
          disabled && "pointer-events-none opacity-40",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onFiles(mergeFiles(files));
            e.target.value = "";
          }}
        />

        {/* Icon cluster — two overlapping file icons like Google Lens */}
        <div className="relative shrink-0 h-14 w-14">
          {/* Back shadow file */}
          <div
            className={cn(
              "absolute bottom-0 left-1 h-11 w-9 rounded-lg border-2 rotate-[-8deg] transition-transform duration-200",
              dragging
                ? "border-primary/60 bg-primary/10 rotate-[-12deg]"
                : "border-border bg-muted/60",
            )}
          />
          {/* Front file with upload icon */}
          <div
            className={cn(
              "absolute bottom-0 right-0 h-11 w-9 rounded-lg border-2 flex items-center justify-center transition-transform duration-200",
              dragging
                ? "border-primary bg-primary/10 rotate-[4deg]"
                : "border-primary/50 bg-card rotate-[2deg]",
            )}
          >
            <FileUp
              className={cn(
                "h-5 w-5 transition-colors",
                dragging ? "text-primary" : "text-primary/70",
              )}
            />
          </div>
        </div>

        {/* Text content */}
        <div className="flex flex-col gap-0.5 text-left">
          {dragging ? (
            <p className="text-base font-semibold text-primary">
              Drop files to add them
            </p>
          ) : (
            <>
              <p className="text-base font-semibold text-foreground">
                Drag files here
              </p>
              <p className="text-sm text-muted-foreground">
                or{" "}
                <span className="text-primary underline underline-offset-2 cursor-pointer hover:text-primary/80 transition-colors">
                  browse files
                </span>
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground/60 mt-1">
            Any type · end-to-end encrypted
          </p>
        </div>

        {/* Drag overlay pulse ring */}
        {dragging && (
          <span className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-primary/30 animate-ping" />
        )}
      </div>

      {/* ── Selected file chips ── */}
      {selectedFiles.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              <FolderOpen className="h-3 w-3" />
              {selectedFiles.length}{" "}
              {selectedFiles.length === 1 ? "file" : "files"} selected
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFiles([]);
              }}
              className="text-[11px] text-muted-foreground/60 hover:text-destructive transition-colors"
            >
              Clear all
            </button>
          </div>
          <ul
            ref={chipsRef}
            className="flex flex-wrap gap-1.5"
          >
            {selectedFiles.map((f, i) => (
              <FileChip key={i} file={f} onRemove={() => removeFile(i)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
