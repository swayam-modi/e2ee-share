"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { formatCountdown } from "@/lib/format";
import gsap from "gsap";

export function ShareLinkCard({
  shareUrl,
  expiresAt,
}: {
  shareUrl: string;
  expiresAt: number;
}) {
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(() => formatCountdown(expiresAt));
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(
      () => setCountdown(formatCountdown(expiresAt)),
      1_000,
    );
    return () => clearInterval(id);
  }, [expiresAt]);

  useEffect(() => {
    if (cardRef.current) {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
      );
    }
  }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <div
      ref={cardRef}
      className="rounded-xl border border-white/5 bg-card/80 backdrop-blur-sm p-5"
    >
      <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-500 mb-3">
        Share Link
      </p>
      <div className="flex gap-2">
        <Input
          value={shareUrl}
          readOnly
          className="bg-zinc-900 border-white/5 text-zinc-300 font-mono text-xs focus-visible:ring-primary"
        />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void copy()}
          aria-label="Copy link"
          className="shrink-0 text-zinc-400 hover:text-white transition-colors"
        >
          {copied ? (
            <Check className="h-4 w-4 text-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Key lives in{" "}
        <code className="rounded bg-white/5 px-1 py-0.5 font-mono">
          #fragment
        </code>
        {" — "}
        never sent to server.{" "}
        <span className="text-zinc-600">Expires in {countdown}</span>
      </p>
    </div>
  );
}
