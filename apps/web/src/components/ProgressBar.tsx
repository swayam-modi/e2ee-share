import React from 'react';

interface ProgressBarProps {
  value: number; // 0–1
  label?: string;
  'aria-label'?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, label, 'aria-label': ariaLabel }) => {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));

  return (
    <div
      style={{
        width: '100%',
      }}
    >
      {label && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.8rem',
            color: 'var(--fg-muted)',
            marginBottom: '4px',
          }}
        >
          <span>{label}</span>
          <span>{pct}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel ?? label ?? 'Progress'}
        style={{
          width: '100%',
          height: '8px',
          background: 'var(--progress-bg)',
          borderRadius: '999px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--progress-fg)',
            borderRadius: '999px',
            transition: 'width 0.1s linear',
          }}
        />
      </div>
    </div>
  );
};
