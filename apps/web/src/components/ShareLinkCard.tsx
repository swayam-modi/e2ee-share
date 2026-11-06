import React, { useState, useEffect, useCallback } from 'react';
import { formatCountdown } from '../utils/format.js';

interface ShareLinkCardProps {
  shareUrl: string;
  expiresAt: number;
}

export const ShareLinkCard: React.FC<ShareLinkCardProps> = ({ shareUrl, expiresAt }) => {
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(() => formatCountdown(expiresAt));

  useEffect(() => {
    setCountdown(formatCountdown(expiresAt));
    const interval = setInterval(() => {
      setCountdown(formatCountdown(expiresAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [shareUrl]);

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '1.25rem',
        boxShadow: 'var(--shadow)',
      }}
    >
      <p
        style={{
          fontSize: '0.8rem',
          color: 'var(--fg-muted)',
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          marginBottom: '0.5rem',
        }}
      >
        Share Link
      </p>

      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'stretch',
          flexWrap: 'wrap',
        }}
      >
        <input
          readOnly
          value={shareUrl}
          aria-label="Share URL"
          onClick={(e) => (e.target as HTMLInputElement).select()}
          style={{
            flex: 1,
            minWidth: '0',
            padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--fg)',
            fontSize: '0.85rem',
            fontFamily: 'ui-monospace, monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        />
        <button
          onClick={handleCopy}
          aria-label={copied ? 'Copied!' : 'Copy share link'}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius-sm)',
            background: copied ? 'var(--success)' : 'var(--accent)',
            color: 'var(--accent-fg)',
            fontWeight: 600,
            fontSize: '0.9rem',
            transition: 'background 0.15s',
            flexShrink: 0,
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      <p
        style={{
          marginTop: '0.5rem',
          fontSize: '0.8rem',
          color: countdown === 'Expired' ? 'var(--danger)' : 'var(--fg-muted)',
        }}
      >
        Expires in: <strong>{countdown}</strong>
      </p>

      <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
        Send this link to the recipient. The secret key is in the{' '}
        <code
          style={{
            fontFamily: 'ui-monospace, monospace',
            background: 'var(--bg-hover)',
            padding: '0 4px',
            borderRadius: '3px',
          }}
        >
          #fragment
        </code>{' '}
        and never sent to the server.
      </p>
    </div>
  );
};
