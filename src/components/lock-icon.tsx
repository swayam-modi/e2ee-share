'use client';

import { Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function LockIcon() {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
          aria-label="How is this secure?"
        >
          <Lock className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[240px] text-sm leading-relaxed">
          Files are encrypted in your browser with AES-256-GCM before leaving your device. The
          server only relays opaque signaling envelopes and never sees your files or encryption
          keys.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
