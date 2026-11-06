import React from 'react';

interface ErrorScreenProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export const ErrorScreen: React.FC<ErrorScreenProps> = ({
  title = 'Something went wrong',
  message,
  onRetry,
}) => {
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        textAlign: 'center',
        padding: '2rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem',
      }}
    >
      <div style={{ fontSize: '3rem' }} aria-hidden="true">❌</div>
      <h2
        style={{
          fontSize: '1.3rem',
          fontWeight: 700,
          color: 'var(--danger)',
        }}
      >
        {title}
      </h2>
      <p
        style={{
          color: 'var(--fg-muted)',
          maxWidth: '400px',
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          aria-label="Try again"
          style={{
            padding: '0.6rem 1.5rem',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            fontWeight: 600,
            fontSize: '0.95rem',
          }}
        >
          Try Again
        </button>
      )}
    </div>
  );
};
