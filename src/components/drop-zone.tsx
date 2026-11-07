"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Upload } from "lucide-react";
import { formatBytes } from "@/lib/format";
import gsap from "gsap";

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
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (rootRef.current) {
      gsap.fromTo(
        rootRef.current,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
      );
    }
  }, []);

  useEffect(() => {
    if (listRef.current && selectedFiles.length > 0) {
      const items = listRef.current.querySelectorAll("li");
      gsap.fromTo(
        items,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: 0.05 },
      );
    }
  }, [selectedFiles.length]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [onFiles, disabled],
  );

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
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
        "relative rounded-xl border border-dashed p-8 text-center min-h-[200px]",
        "flex flex-col items-center justify-center",
        "transition-all duration-300 cursor-pointer outline-none",
        "bg-[radial-gradient(circle,_theme(colors.foreground/0.04)_1px,_transparent_1px)] bg-[size:20px_20px]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        dragging
          ? "border-primary/60 bg-primary/5 shadow-[0_0_20px_theme(colors.primary/0.15)] scale-[1.01]"
          : "border-border hover:border-primary/40 hover:bg-muted/50",
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
          if (files.length > 0) onFiles(files);
          e.target.value = "";
        }}
      />
      <Upload className="h-10 w-10 text-muted-foreground mb-4" />
      <p className="text-sm font-medium text-foreground">
        Drop files here or click to browse
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Any file type · encrypted before sending
      </p>
      {selectedFiles.length > 0 && (
        <>
          <div className="mt-5 w-full border-t border-border" />
          <ul ref={listRef} className="mt-4 w-full space-y-1 text-left">
            {selectedFiles.map((f, i) => (
              <li
                key={i}
                className="flex justify-between gap-2 text-xs text-muted-foreground"
              >
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground/70">
                  {formatBytes(f.size)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
