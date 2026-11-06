import React, { useState, useRef, useCallback } from 'react';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  selectedFiles: File[];
}

export const DropZone: React.FC<DropZoneProps> = ({ onFiles, disabled, selectedFiles }) => {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [onFiles]
  );

  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        inputRef.current?.click();
      }
    },
    [disabled]
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Drop files here or click to select files"
        aria-disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          border: `2px dashed ${dragging ? 'var(--dropzone-active-border)' : 'var(--dropzone-border)'}`,
          borderRadius: 'var(--radius)',
          background: dragging ? 'var(--dropzone-active-bg)' : 'var(--dropzone-bg)',
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }} aria-hidden="true">📁</div>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.95rem' }}>
          {dragging
            ? 'Drop files here'
            : 'Drag & drop files here, or click to select'}
        </p>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
          Multiple files supported
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        style={{ display: 'none' }}
        onChange={handleInputChange}
        disabled={disabled}
      />

      {selectedFiles.length > 0 && (
        <ul
          aria-label="Selected files"
          style={{
            marginTop: '1rem',
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}
        >
          {selectedFiles.map((f, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5rem 0.75rem',
                background: 'var(--bg-hover)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.9rem',
                gap: '0.5rem',
              }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {f.name}
              </span>
              <span
                style={{
                  color: 'var(--fg-muted)',
                  fontSize: '0.8rem',
                  flexShrink: 0,
                }}
              >
                {formatFileSize(f.size)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

function formatFileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
