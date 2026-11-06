import React from 'react';

interface FingerprintCardProps {
  fingerprint: string;
  hint?: string;
}

export const FingerprintCard: React.FC<FingerprintCardProps> = ({
  fingerprint,
  hint = 'Compare this fingerprint with the other side to verify the connection is secure.',
}) => {
  // Format fingerprint in groups for readability
  const groups = fingerprint.match(/.{1,4}/g) ?? [fingerprint];

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '1rem 1.25rem',
      }}
    >
      <p
        style={{
          fontSize: '0.8rem',
          color: 'var(--fg-muted)',
          marginBottom: '0.5rem',
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        Security Fingerprint
      </p>
      <div
        aria-label="Security fingerprint"
        style={{
          fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", monospace',
          fontSize: '0.9rem',
          letterSpacing: '0.08em',
          color: 'var(--fg)',
          wordBreak: 'break-all',
          lineHeight: 1.8,
        }}
      >
        {groups.join(' ')}
      </div>
      {hint && (
        <p
          style={{
            marginTop: '0.5rem',
            fontSize: '0.8rem',
            color: 'var(--fg-muted)',
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
};
