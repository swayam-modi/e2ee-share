import React from 'react';
import type { TransferProgress } from '@e2ee-share/core';
import { ProgressBar } from './ProgressBar.js';
import { formatBytes, formatSpeed, formatEta } from '../utils/format.js';

interface FileListProps {
  files: File[];
  progress: Map<number, TransferProgress>;
}

export const FileList: React.FC<FileListProps> = ({ files, progress }) => {
  if (files.length === 0) return null;

  return (
    <ul
      aria-label="Files being sent"
      style={{
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {files.map((file, i) => {
        const p = progress.get(i);
        const fraction = p ? p.bytesSent / Math.max(1, p.bytesTotal) : 0;
        const bytesLeft = p ? p.bytesTotal - p.bytesSent : file.size;
        const isDone = p && p.bytesSent >= p.bytesTotal;

        return (
          <li
            key={i}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 1rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: p ? '0.5rem' : 0,
                gap: '0.5rem',
              }}
            >
              <span
                style={{
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {file.name}
              </span>
              <span style={{ color: 'var(--fg-muted)', fontSize: '0.85rem', flexShrink: 0 }}>
                {isDone ? (
                  <span style={{ color: 'var(--success)' }}>✓ Sent</span>
                ) : p ? (
                  `${formatBytes(p.bytesSent)} / ${formatBytes(p.bytesTotal)}`
                ) : (
                  formatBytes(file.size)
                )}
              </span>
            </div>

            {p && !isDone && (
              <>
                <ProgressBar
                  value={fraction}
                  aria-label={`Transfer progress for ${file.name}`}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '0.3rem',
                    fontSize: '0.8rem',
                    color: 'var(--fg-muted)',
                  }}
                >
                  <span>{formatSpeed(p.speed)}</span>
                  <span>ETA: {formatEta(bytesLeft, p.speed)}</span>
                </div>
              </>
            )}

            {isDone && (
              <ProgressBar value={1} aria-label={`${file.name} complete`} />
            )}
          </li>
        );
      })}
    </ul>
  );
};
