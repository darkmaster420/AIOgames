'use client';

import { useState, useEffect, useCallback } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';

export interface RSSTokenResponse {
  token: string | null;
  createdAt: string | null;
  feedUrl: string | null;
}

export default function RSSFeedManager() {
  const { showSuccess, showError } = useNotification();
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [rssData, setRssData] = useState<RSSTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const loadRSSToken = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/rss/token');
      if (!res.ok) {
        showError('Failed to load RSS token');
        return;
      }
      const data = await res.json();
      setRssData(data);
    } catch (error) {
      console.error('Failed to load RSS token:', error);
      showError('Failed to load RSS token');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadRSSToken();
  }, [loadRSSToken]);

  const handleGenerateToken = async () => {
    const confirmed = await confirm({
      title: 'Generate New RSS Token?',
      message: 'This will generate a new RSS feed token. Any existing token will be invalidated.'
    });

    if (!confirmed) return;

    try {
      setGenerating(true);
      const res = await fetch('/api/rss/token', {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'Failed to generate token');
        return;
      }
      setRssData(data);
      showSuccess('RSS token generated successfully!');
    } catch (error) {
      console.error('Failed to generate token:', error);
      showError('Failed to generate RSS token');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevokeToken = async () => {
    const confirmed = await confirm({
      title: 'Revoke RSS Token?',
      message: 'This will invalidate your current RSS feed. You can generate a new one anytime.'
    });

    if (!confirmed) return;

    try {
      setRevoking(true);
      const res = await fetch('/api/rss/token', {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'Failed to revoke token');
        return;
      }
      setRssData(null);
      showSuccess('RSS token revoked');
    } catch (error) {
      console.error('Failed to revoke token:', error);
      showError('Failed to revoke RSS token');
    } finally {
      setRevoking(false);
    }
  };

  const handleCopyUrl = () => {
    if (rssData?.feedUrl) {
      navigator.clipboard.writeText(rssData.feedUrl);
      setCopied(true);
      showSuccess('Feed URL copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return <div className="p-4">Loading RSS settings...</div>;
  }

  return (
    <div className="space-y-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border border-orange-200 dark:border-orange-700">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
          📡 RSS Feed
        </h3>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Subscribe to your tracked games with an RSS reader. Get automatic updates with download links included.
        </p>
      </div>

      {rssData?.token ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Feed URL
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={rssData.feedUrl || ''}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs font-mono"
              />
              <button
                onClick={handleCopyUrl}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md transition"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Add this URL to your RSS reader to get updates on your tracked games.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Created
            </label>
            <p className="text-xs text-gray-700 dark:text-gray-300">
              {rssData.createdAt ? new Date(rssData.createdAt).toLocaleDateString() : 'Unknown'}
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleGenerateToken}
              disabled={generating}
              className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-xs font-medium rounded-md transition"
            >
              {generating ? 'Generating...' : 'Regenerate Token'}
            </button>
            <button
              onClick={handleRevokeToken}
              disabled={revoking}
              className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white text-xs font-medium rounded-md transition"
            >
              {revoking ? 'Revoking...' : 'Revoke Token'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            No RSS token yet. Generate one to start using RSS feeds with your tracked games.
          </p>
          <button
            onClick={handleGenerateToken}
            disabled={generating}
            className="w-full px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white text-xs font-medium rounded-md transition"
          >
            {generating ? 'Generating...' : 'Generate RSS Token'}
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded p-2 mt-3">
        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">📝 Query Parameters:</p>
        <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
          <li><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">?sort=recent</code> - Recent updates (default, 7 days)</li>
          <li><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">?sort=all</code> - All tracked games</li>
          <li><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">?sort=updated</code> - Games with updates only</li>
          <li><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">?limit=100</code> - Limit items (max 500)</li>
        </ul>
      </div>
    </div>
  );
}
