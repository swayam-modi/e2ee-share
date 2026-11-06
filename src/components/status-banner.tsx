"use client";

import { useEffect, useRef } from "react";
import { Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import gsap from "gsap";

const variantStyles = {
  info: "border-zinc-600",
  success: "border-success",
  warning: "border-amber-500",
  error: "border-destructive",
} as const;

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

export function StatusBanner({
  message,
  variant = "info",
  ...props
}: {
  message: string;
  variant?: "info" | "success" | "warning" | "error";
  "aria-live"?: "polite" | "assertive";
}) {
  const Icon = icons[variant];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      gsap.fromTo(
        ref.current,
        { opacity: 0, x: -8 },
        { opacity: 1, x: 0, duration: 0.3, ease: "power2.out" },
      );
    }
  }, []);

  return (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "flex items-center gap-2.5 border-l-2 pl-4 py-3 bg-transparent",
        variantStyles[variant],
      )}
      {...props}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="text-sm text-zinc-300">{message}</span>
    </div>
  );
}
