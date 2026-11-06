import React from 'react';

type Variant = 'info' | 'success' | 'warning' | 'error';

interface StatusBannerProps {
  message: string;
  variant?: Variant;
  'aria-live'?: 'polite' | 'assertive';
}

const VARIANT_STYLES: Record<Variant, { background: string; color: string; border: string }> = {
  info: {
    background: 'var(--bg-hover)',
    color: 'var(--fg)',
    border: 'var(--border)',
  },
  success: {
    background: 'rgba(22, 163, 74, 0.1)',
    color: 'var(--success)',
    border: 'rgba(22, 163, 74, 0.3)',
  },
  warning: {
    background: 'rgba(217, 119, 6, 0.1)',
    color: 'var(--warning)',
    border: 'rgba(217, 119, 6, 0.3)',
  },
  error: {
    background: 'rgba(220, 38, 38, 0.1)',
    color: 'var(--danger)',
    border: 'rgba(220, 38, 38, 0.3)',
  },
};

const ICONS: Record<Variant, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

export const StatusBanner: React.FC<StatusBannerProps> = ({
  message,
  variant = 'info',
  'aria-live': ariaLive = 'polite',
}) => {
  const styles = VARIANT_STYLES[variant];

  return (
    <div
      role="status"
      aria-live={ariaLive}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1rem',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${styles.border}`,
        background: styles.background,
        color: styles.color,
        fontSize: '0.9rem',
      }}
    >
      <span aria-hidden="true">{ICONS[variant]}</span>
      <span>{message}</span>
    </div>
  );
};
