/**
 * Phase 5 — Filename Sanitization Tests (Section 8.6)
 */
import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '../transfer/sanitize.js';

describe('sanitizeFilename', () => {
  it('strips path separators (unix)', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
  });

  it('strips path separators (windows backslash)', () => {
    expect(sanitizeFilename('C:\\Users\\Admin\\secret.txt')).toBe('secret.txt');
  });

  it('strips mixed path separators', () => {
    expect(sanitizeFilename('foo/bar\\baz.pdf')).toBe('baz.pdf');
  });

  it('prefixes _ for Windows reserved name CON.txt', () => {
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
  });

  it('prefixes _ for Windows reserved name con (lowercase)', () => {
    expect(sanitizeFilename('con')).toBe('_con');
  });

  it('prefixes _ for Windows reserved name NUL', () => {
    expect(sanitizeFilename('NUL')).toBe('_NUL');
  });

  it('prefixes _ for Windows reserved name COM9', () => {
    expect(sanitizeFilename('COM9')).toBe('_COM9');
  });

  it('prefixes _ for Windows reserved name LPT1.txt', () => {
    expect(sanitizeFilename('LPT1.txt')).toBe('_LPT1.txt');
  });

  it('prefixes _ for Windows reserved name PRN', () => {
    expect(sanitizeFilename('PRN')).toBe('_PRN');
  });

  it('strips leading dots and spaces', () => {
    expect(sanitizeFilename('  .hidden')).toBe('hidden');
  });

  it('strips leading dots only', () => {
    expect(sanitizeFilename('...readme.txt')).toBe('readme.txt');
  });

  it('strips trailing dots and spaces', () => {
    expect(sanitizeFilename('trailing...')).toBe('trailing');
  });

  it('strips trailing spaces', () => {
    expect(sanitizeFilename('file.txt   ')).toBe('file.txt');
  });

  it('removes control characters', () => {
    // \x01 and \x1f are control characters
    expect(sanitizeFilename('file\x01name\x1f.txt')).toBe('filename.txt');
  });

  it('removes forbidden chars < > : " | ? *', () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h.txt')).toBe('abcdefgh.txt');
  });

  it('returns "download" for empty string', () => {
    expect(sanitizeFilename('')).toBe('download');
  });

  it('returns "download" for string that becomes empty after sanitization', () => {
    expect(sanitizeFilename('...')).toBe('download');
  });

  it('returns "download" for all-control-char string', () => {
    expect(sanitizeFilename('\x00\x01\x1f')).toBe('download');
  });

  it('truncates long base name to 200 chars, preserving extension', () => {
    const longBase = 'a'.repeat(300);
    const ext = '.txt'; // 4 chars
    const name = longBase + ext;
    const result = sanitizeFilename(name);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('.txt')).toBe(true);
    // Base should be 196 chars + 4 ext = 200
    expect(result.length).toBe(200);
  });

  it('truncates extensionless long name to 200 chars', () => {
    const longName = 'b'.repeat(300);
    const result = sanitizeFilename(longName);
    expect(result.length).toBe(200);
  });

  it('preserves a normal safe filename unchanged', () => {
    expect(sanitizeFilename('report-2024-Q4.pdf')).toBe('report-2024-Q4.pdf');
  });

  it('handles filename that is only spaces → download', () => {
    expect(sanitizeFilename('   ')).toBe('download');
  });

  it('handles Windows path with reserved name in final segment', () => {
    expect(sanitizeFilename('C:\\temp\\AUX')).toBe('_AUX');
  });

  it('does not prefix non-reserved look-alike names', () => {
    // CONAN is not a reserved name
    expect(sanitizeFilename('CONAN.txt')).toBe('CONAN.txt');
  });
});
