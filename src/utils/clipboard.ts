/**
 * Copy text to the clipboard, with a fallback for non-secure origins.
 *
 * `navigator.clipboard` only exists in a secure context (HTTPS, or localhost).
 * This app is commonly reached over plain HTTP on a LAN address such as
 * `http://192.168.1.10:3001`, where the property is `undefined` and calling it
 * throws — which is why the copy buttons appeared to do nothing. Fall back to
 * the legacy `execCommand('copy')` path there.
 *
 * Returns whether the text actually made it to the clipboard, so callers can
 * tell the user instead of silently swallowing the failure.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or the document isn't focused — try the fallback.
    }
  }

  return copyViaExecCommand(text);
}

function copyViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Keep it off-screen and non-disruptive: `readOnly` stops mobile keyboards
  // appearing, and fixed positioning avoids scrolling the page on focus.
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  textarea.style.opacity = '0';

  const previouslyFocused = document.activeElement as HTMLElement | null;
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    previouslyFocused?.focus?.();
  }
}
