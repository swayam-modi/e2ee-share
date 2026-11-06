import React, { useEffect } from 'react';
import { useReceiverSession } from '../hooks/useReceiverSession.js';
import { FingerprintCard } from '../components/FingerprintCard.js';
import { StatusBanner } from '../components/StatusBanner.js';
import { ErrorScreen } from '../components/ErrorScreen.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { LockIcon } from '../components/LockIcon.js';
import { formatBytes, formatSpeed, formatEta } from '../utils/format.js';
import { parseReceiverUrl } from '../utils/links.js';
import type { FileOfferInfo } from '@e2ee-share/core';

export const ReceiverPage: React.FC = () => {
  const [state, actions] = useReceiverSession() as [
    ReturnType<typeof useReceiverSession>[0],
    ReturnType<typeof useReceiverSession>[1] & {
      acceptOffer: (fileIndex: number, offer: FileOfferInfo) => Promise<void>;
      declineOffer: (fileIndex: number) => void;
    }
  ];

  useEffect(() => {
    const parsed = parseReceiverUrl();
    if (parsed) {
      actions.start(parsed.roomId, parsed.secret);
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = parseReceiverUrl();
  if (!parsed) {
    return (
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          padding: '2rem 1rem',
        }}
      >
        <ErrorScreen
          title="Invalid Link"
          message="This share link is invalid or malformed. Please ask the sender for a new link."
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '560px',
        padding: '2rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}
    >
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, flex: 1 }}>
          Receive Files Securely
        </h1>
        <LockIcon />
      </header>

      {/* Error state */}
      {state.phase === 'failed' && state.error && (
        <ErrorScreen
          title={getErrorTitle(state.error.message)}
          message={state.error.message}
        />
      )}

      {/* Preparing keys */}
      {state.phase === 'preparingKeys' && (
        <StatusBanner message="Preparing secure connection…" variant="info" />
      )}

      {/* Joining */}
      {state.phase === 'joining' && (
        <StatusBanner message="Connecting to room…" variant="info" />
      )}

      {/* Waiting for key / sender to approve */}
      {(state.phase === 'waitingForKey') && (
        <>
          <StatusBanner
            message="Waiting for the sender to approve the connection…"
            variant="info"
            aria-live="polite"
          />
          {state.fingerprint && (
            <FingerprintCard
              fingerprint={state.fingerprint}
              hint="Share this fingerprint with the sender so they can verify they're connecting to you."
            />
          )}
        </>
      )}

      {/* RTC connecting */}
      {state.phase === 'rtcConnecting' && (
        <StatusBanner message="Establishing encrypted connection…" variant="info" />
      )}

      {/* Ready */}
      {state.phase === 'ready' && (
        <StatusBanner message="Connected! Waiting for files…" variant="success" />
      )}

      {/* File offers */}
      {state.fileOffers.length > 0 && state.phase !== 'failed' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Incoming Files</h2>
          {state.fileOffers.map(({ offer, status }) => {
            const p = state.progress.get(offer.fileIndex);
            const fraction = p ? p.bytesSent / Math.max(1, p.bytesTotal) : 0;
            const bytesLeft = p ? p.bytesTotal - p.bytesSent : offer.size;
            const isDone = p && p.bytesSent >= p.bytesTotal;

            return (
              <div
                key={offer.fileIndex}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Render filename as text node — never innerHTML */}
                    <p
                      style={{
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {offer.name}
                    </p>
                    <p style={{ fontSize: '0.82rem', color: 'var(--fg-muted)' }}>
                      {formatBytes(offer.size)}
                      {offer.mime ? ` · ${offer.mime}` : ''}
                    </p>
                  </div>

                  {status === 'pending' && (
                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                      <button
                        onClick={() => void actions.acceptOffer(offer.fileIndex, offer)}
                        aria-label={`Accept file ${offer.name}`}
                        style={{
                          padding: '0.4rem 0.8rem',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--success)',
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                        }}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => actions.declineOffer(offer.fileIndex)}
                        aria-label={`Decline file ${offer.name}`}
                        style={{
                          padding: '0.4rem 0.8rem',
                          borderRadius: 'var(--radius-sm)',
                          background: 'transparent',
                          border: '1px solid var(--danger)',
                          color: 'var(--danger)',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  )}

                  {status === 'declined' && (
                    <span
                      aria-label="File declined"
                      style={{
                        color: 'var(--fg-muted)',
                        fontSize: '0.85rem',
                        flexShrink: 0,
                      }}
                    >
                      Declined
                    </span>
                  )}

                  {status === 'accepted' && isDone && (
                    <span
                      aria-label="File saved"
                      style={{
                        color: 'var(--success)',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        flexShrink: 0,
                      }}
                    >
                      ✓ Saved
                    </span>
                  )}
                </div>

                {status === 'accepted' && p && !isDone && (
                  <>
                    <ProgressBar
                      value={fraction}
                      aria-label={`Download progress for ${offer.name}`}
                    />
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.8rem',
                        color: 'var(--fg-muted)',
                      }}
                    >
                      <span>{formatSpeed(p.speed)}</span>
                      <span>ETA: {formatEta(bytesLeft, p.speed)}</span>
                    </div>
                  </>
                )}

                {status === 'accepted' && isDone && (
                  <ProgressBar value={1} aria-label={`${offer.name} download complete`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Done */}
      {state.phase === 'done' && (
        <div
          style={{
            textAlign: 'center',
            padding: '1.5rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <div style={{ fontSize: '3rem' }} aria-hidden="true">🎉</div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--success)' }}>
            All Files Received!
          </h2>
          <p style={{ color: 'var(--fg-muted)' }}>
            Your files have been saved securely.
          </p>
        </div>
      )}
    </div>
  );
};

function getErrorTitle(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('expired') || lower.includes('not found')) return 'Room Expired';
  if (lower.includes('integrity') || lower.includes('auth')) return 'Integrity Check Failed';
  if (lower.includes('ice') || lower.includes('rtc') || lower.includes('connection')) {
    return 'Connection Failed';
  }
  return 'Transfer Failed';
}
