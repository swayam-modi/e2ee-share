"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { formatCountdown } from "@/lib/format";
import gsap from "gsap";
import { QRCodeSVG } from "qrcode.react";

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
      className="rounded-xl border border-border bg-card/80 backdrop-blur-sm p-5"
    >
      <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground mb-3">
        Share Link
      </p>
      <div className="flex gap-2">
        <Input
          value={shareUrl}
          readOnly
          className="bg-muted border-border text-foreground font-mono text-xs focus-visible:ring-primary"
        />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void copy()}
          aria-label="Copy link"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <Check className="h-4 w-4 text-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* QR Code */}
      <div className="mt-4 flex flex-col items-center gap-2">
        <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
          Scan to open
        </p>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg overflow-hidden border border-border p-2 bg-white hover:scale-105 transition-transform duration-200"
          title="Scan QR code to open link"
        >
          <QRCodeSVG
            value={shareUrl}
            size={160}
            level="M"
            marginSize={1}
            fgColor="#000000"
            bgColor="#ffffff"
            title="Scan to open share link"
          />
        </a>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Key lives in{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">
          #fragment
        </code>
        {" — "}
        never sent to server.{" "}
        <span className="text-muted-foreground/60">Expires in {countdown}</span>
      </p>
    </div>
  );
}
