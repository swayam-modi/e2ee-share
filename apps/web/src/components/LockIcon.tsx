import React, { useState } from 'react';

export const LockIcon: React.FC = () => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        aria-label="How is this secure? Click for explanation"
        aria-expanded={showTooltip}
        onClick={() => setShowTooltip((v) => !v)}
        onBlur={() => setShowTooltip(false)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '1.1rem',
          padding: '0 0.25rem',
          color: 'var(--accent)',
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        🔒
      </button>

      {showTooltip && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem 1rem',
            width: '280px',
            boxShadow: 'var(--shadow-md)',
            fontSize: '0.82rem',
            color: 'var(--fg)',
            zIndex: 100,
            lineHeight: 1.5,
          }}
        >
          <strong>End-to-end encrypted</strong>
          <p style={{ marginTop: '0.4rem', color: 'var(--fg-muted)' }}>
            Files are encrypted in your browser using AES-256-GCM before being sent
            directly to the recipient via WebRTC. The server never sees your files
            or the encryption key — the key is in the URL fragment, which is never
            sent to the server.
          </p>
          <p style={{ marginTop: '0.4rem' }}>
            <a
              href="/docs/threat-model.md"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)', fontSize: '0.8rem' }}
            >
              Read the threat model →
            </a>
          </p>
        </div>
      )}
    </div>
  );
};
