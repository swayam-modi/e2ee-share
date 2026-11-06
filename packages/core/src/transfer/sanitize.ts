/**
 * Filename sanitization utilities.
 * Implements Section 8.6 of the specification.
 *
 * NEVER use the result of sanitizeFilename to build OS file-system paths.
 * It is only suitable for browser save APIs (showSaveFilePicker / <a download>).
 */

/** Windows reserved device names (case-insensitive, with optional extension). */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..+)?$/i;

/** Control characters (0x00–0x1F) and forbidden chars: < > : " | ? * \ / */
const FORBIDDEN_CHARS = /[\x00-\x1f<>:"|?*\\/]/g;

/** Maximum safe filename length (chars). */
const MAX_FILENAME_LEN = 200;

/**
 * Sanitize an untrusted filename from a remote peer.
 *
 * Rules applied in order:
 * 1. Take only the basename (strip path separators).
 * 2. Remove control characters and forbidden chars: `< > : " | ? * \ /`
 * 3. Strip leading dots and spaces.
 * 4. Strip trailing dots and spaces.
 * 5. Prepend `_` for Windows reserved names.
 * 6. Truncate base name to stay within 200 total characters (preserving extension).
 * 7. Fall back to `'download'` if the result is empty.
 */
export function sanitizeFilename(name: string): string {
  // 1. Basename only: strip everything up to and including the last / or \
  const slashIdx = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  let result = slashIdx >= 0 ? name.slice(slashIdx + 1) : name;

  // 2. Remove control characters and forbidden chars
  result = result.replace(FORBIDDEN_CHARS, '');

  // 3. Strip leading dots and spaces
  result = result.replace(/^[. ]+/, '');

  // 4. Strip trailing dots and spaces
  result = result.replace(/[. ]+$/, '');

  // 5. Windows reserved names
  if (WINDOWS_RESERVED.test(result)) {
    result = `_${result}`;
  }

  // 6. Truncate to MAX_FILENAME_LEN, preserving extension
  if (result.length > MAX_FILENAME_LEN) {
    const dotIdx = result.lastIndexOf('.');
    if (dotIdx > 0) {
      const ext = result.slice(dotIdx); // e.g. ".txt"
      const maxBase = MAX_FILENAME_LEN - ext.length;
      result = result.slice(0, maxBase > 0 ? maxBase : 0) + ext;
    } else {
      result = result.slice(0, MAX_FILENAME_LEN);
    }
  }

  // 7. Fallback
  return result.length > 0 ? result : 'download';
}
