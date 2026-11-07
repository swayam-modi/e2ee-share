'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { XCircle } from 'lucide-react';
import gsap from 'gsap';

export function ErrorScreen({
  title = 'Transfer Failed',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
      );
    }
  }, []);

  return (
    <div ref={ref} className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 w-full">
      <div className="flex items-center gap-2 mb-2">
        <XCircle className="h-4 w-4 text-destructive shrink-0" />
        <p className="text-sm font-medium text-destructive">{title}</p>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-4 border-border text-muted-foreground hover:text-foreground"
        >
          Try Again
        </Button>
      )}
    </div>
  );
}
