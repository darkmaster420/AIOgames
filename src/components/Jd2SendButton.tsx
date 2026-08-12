'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useNotification } from '../contexts/NotificationContext';

interface Jd2SendButtonProps {
  /** Numeric WordPress post id from the gameapi (`originalId`). */
  postId?: string;
  siteType?: string;
  title: string;
  /** Original post URL used to identify the dispatch. */
  gameLink?: string;
  version?: string;
  /** Links already on the result, saving a round-trip to the source site. */
  downloadLinks?: Array<{ url: string; label?: string; service?: string }>;
  className?: string;
}

export function Jd2SendButton({
  postId,
  siteType,
  title,
  gameLink,
  version,
  downloadLinks,
  className = '',
}: Jd2SendButtonProps) {
  const [isSending, setIsSending] = useState(false);
  const { data: session } = useSession();
  const { showSuccess, showError, showInfo } = useNotification();

  // Without either embedded links or a resolvable post there is nothing to send.
  const canSend = Boolean((downloadLinks && downloadLinks.length > 0) || (postId && siteType));

  const handleSend = async () => {
    setIsSending(true);
    try {
      const response = await fetch('/api/downloads/jd2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, siteType, title, gameLink, version, downloadLinks }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = data.error || 'Failed to send to JDownloader';
        // A host-preference mismatch is a config problem the user can fix, so
        // surface what was actually available rather than just "failed".
        if (data.outcome === 'skipped' && Array.isArray(data.availableHosts)) {
          showInfo(
            'Nothing sent to JD2',
            `${message}\n\nPreferred: ${(data.hierarchy || []).join(' > ') || 'none'}\nAvailable: ${data.availableHosts.join(', ') || 'none'}`,
          );
        } else {
          showError('JDownloader', data.hint ? `${message}\n\n${data.hint}` : message);
        }
        return;
      }

      showSuccess(
        'Sent to JDownloader',
        `${data.packageName || title} — ${data.linkCount} link(s) via ${(data.selectedHosts || []).join(', ') || 'preferred hosts'}.`,
      );
    } catch (error) {
      console.error('JD2 send error:', error);
      showError('Network Error', 'Could not reach the server. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  if (!session || !canSend) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleSend();
      }}
      disabled={isSending}
      className={`flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium ${className}`}
      title="Send this release to JDownloader 2"
      aria-label={`Send ${title} to JDownloader`}
    >
      {isSending ? (
        <>
          <span className="h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          Sending…
        </>
      ) : (
        <>⬇️ Send to JD2</>
      )}
    </button>
  );
}
