'use client';

import { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import gsap from 'gsap';

export function FingerprintCard({ fingerprint, hint }: { fingerprint: string; hint?: string }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const groupsRef = useRef<(HTMLSpanElement | null)[]>([]);

  const groups = fingerprint.split('-');

  useEffect(() => {
    if (cardRef.current) {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
      );
    }
    const validGroups = groupsRef.current.filter(Boolean);
    if (validGroups.length > 0) {
      gsap.fromTo(
        validGroups,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out', stagger: 0.07, delay: 0.2 },
      );
    }
  }, []);

  return (
    <div ref={cardRef} className="rounded-xl border border-white/5 bg-card/80 backdrop-blur-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-500">
          Security Fingerprint
        </span>
      </div>
      <p
        className="text-center select-all drop-shadow-[0_0_8px_theme(colors.primary/0.4)]"
        aria-label={`Security fingerprint: ${fingerprint}`}
      >
        {groups.map((group, i) => (
          <span key={i}>
            <span
              ref={(el) => {
                groupsRef.current[i] = el;
              }}
              className="font-mono tracking-[0.25em] text-3xl text-white"
            >
              {group}
            </span>
            {i < groups.length - 1 && (
              <span className="font-mono text-3xl text-zinc-600 mx-1">-</span>
            )}
          </span>
        ))}
      </p>
      {hint && <p className="mt-4 text-xs text-zinc-500 leading-relaxed text-center">{hint}</p>}
    </div>
  );
}
