import React, { useState, useCallback } from 'react';
import { useSenderSession } from '../hooks/useSenderSession.js';
import { DropZone } from '../components/DropZone.js';
import { FileList } from '../components/FileList.js';
import { ShareLinkCard } from '../components/ShareLinkCard.js';
import { FingerprintCard } from '../components/FingerprintCard.js';
import { StatusBanner } from '../components/StatusBanner.js';
import { ErrorScreen } from '../components/ErrorScreen.js';
import { LockIcon } from '../components/LockIcon.js';

export const SenderPage: React.FC = () => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [state, actions] = useSenderSession();

  const handleFiles = useCallback((files: File[]) => {
    setSelectedFiles(files);
  }, []);

  const handleStart = useCallback(() => {
    if (selectedFiles.length === 0) return;
    void actions.start(selectedFiles);
  }, [selectedFiles, actions]);

  const handleReset = useCallback(() => {
    actions.reset();
    setSelectedFiles([]);
  }, [actions]);

  const isActive =
    state.phase !== 'idle' &&
    state.phase !== 'done' &&
    state.phase !== 'failed' &&
    state.phase !== 'cancelled';

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
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            flex: 1,
          }}
        >
          Send Files Securely
        </h1>
        <LockIcon />
      </header>

      {/* Error state */}
      {state.phase === 'failed' && state.error && (
        <ErrorScreen
          title="Transfer failed"
          message={state.error.message}
          onRetry={handleReset}
        />
      )}

      {/* Cancelled */}
      {state.phase === 'cancelled' && (
        <div style={{ textAlign: 'center' }}>
          <StatusBanner message="Transfer cancelled." variant="warning" />
          <button
            onClick={handleReset}
            style={{
              marginTop: '1rem',
              padding: '0.6rem 1.5rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              fontWeight: 600,
            }}
          >
            Start Over
          </button>
        </div>
      )}

      {/* Done state */}
      {state.phase === 'done' && (
        <div
          style={{
            textAlign: 'center',
            padding: '2rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div style={{ fontSize: '3rem' }} aria-hidden="true">🎉</div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--success)' }}>
            Transfer Complete!
          </h2>
          <p style={{ color: 'var(--fg-muted)' }}>
            All files were sent successfully.
          </p>
          <button
            onClick={handleReset}
            aria-label="Share more files"
            style={{
              padding: '0.6rem 1.5rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              fontWeight: 600,
              fontSize: '0.95rem',
            }}
          >
            Share More Files
          </button>
        </div>
      )}

      {/* Idle — file picker + start button */}
      {state.phase === 'idle' && (
        <>
          <DropZone
            onFiles={handleFiles}
            selectedFiles={selectedFiles}
            disabled={false}
          />
          {selectedFiles.length > 0 && (
            <button
              onClick={handleStart}
              aria-label="Create a secure share link"
              style={{
                padding: '0.75rem',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                fontWeight: 700,
                fontSize: '1rem',
                width: '100%',
              }}
            >
              🔐 Create Secure Link
            </button>
          )}
        </>
      )}

      {/* Creating room */}
      {state.phase === 'creatingRoom' && (
        <StatusBanner message="Creating a secure room…" variant="info" />
      )}

      {/* Share link available */}
      {state.shareUrl && state.expiresAt && isActive && (
        <ShareLinkCard shareUrl={state.shareUrl} expiresAt={state.expiresAt} />
      )}

      {/* Waiting for receiver */}
      {state.phase === 'waitingForReceiver' && (
        <StatusBanner message="Waiting for the recipient to open the link…" variant="info" />
      )}

      {/* Awaiting approval — show fingerprint + approve/reject */}
      {state.phase === 'awaitingApproval' && (
        <>
          <StatusBanner
            message="Recipient connected. Verify the fingerprint, then approve."
            variant="warning"
            aria-live="assertive"
          />
          {state.fingerprint && (
            <FingerprintCard
              fingerprint={state.fingerprint}
              hint="Optional: compare this fingerprint with what the recipient sees to confirm you're talking to the right person."
            />
          )}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={actions.approve}
              aria-label="Approve connection and begin transfer"
              style={{
                flex: 1,
                padding: '0.7rem',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--success)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '1rem',
              }}
            >
              ✅ Approve
            </button>
            <button
              onClick={actions.reject}
              aria-label="Reject connection"
              style={{
                flex: 1,
                padding: '0.7rem',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--danger)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '1rem',
              }}
            >
              ✗ Reject
            </button>
          </div>
        </>
      )}

      {/* Key exchange / RTC connecting */}
      {(state.phase === 'keyExchange' || state.phase === 'rtcConnecting') && (
        <StatusBanner message="Establishing encrypted connection…" variant="info" />
      )}

      {/* Ready — connecting, about to start sending */}
      {state.phase === 'ready' && (
        <StatusBanner message="Connected! Starting transfer…" variant="success" />
      )}

      {/* Transferring */}
      {(state.phase === 'transferring' || state.phase === 'ready') && selectedFiles.length > 0 && (
        <>
          <FileList files={selectedFiles} progress={state.progress} />
          <button
            onClick={actions.cancel}
            aria-label="Cancel transfer"
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              fontWeight: 600,
              fontSize: '0.9rem',
              alignSelf: 'flex-start',
            }}
          >
            Cancel Transfer
          </button>
        </>
      )}

      {/* Show files during transfer */}
      {state.phase === 'transferring' && selectedFiles.length > 0 && (
        <StatusBanner message="Sending files…" variant="info" />
      )}
    </div>
  );
};
