'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { copyTextToClipboard } from '../utils/clipboard';
import { isTorrentUrl } from '../lib/downloadLinks';

interface DownloadLink {
  service: string;
  url: string;
  type: string;
  displayName: string;
  icon: string;
}

interface DownloadContext {
  gameTitle: string;
  currentVersion: string;
  type: string;
  postUrl?: string;
  source?: string;
}

type DownloadLinksApiResponse = {
  downloadLinks?: DownloadLink[];
  context?: DownloadContext;
  notice?: string;
  noticeType?: string;
  noticeButtonLabel?: string;
};

interface GameDownloadLinksProps {
  // For tracked games
  gameId?: string;
  updateIndex?: number;
  // For any game from main dashboard
  postId?: string;
  siteType?: string;
  /** Original post URL (required for DODI follow-post notice). */
  postUrl?: string;
  // Embedded download links when a result already includes direct links.
  embeddedDownloadLinks?: Array<{ url: string; label?: string; service?: string }>;
  gameTitle?: string;
  className?: string;
}

export function GameDownloadLinks({ 
  gameId, 
  updateIndex, 
  postId, 
  siteType, 
  postUrl,
  embeddedDownloadLinks,
  gameTitle,
  className = '' 
}: GameDownloadLinksProps) {
  const [downloadLinks, setDownloadLinks] = useState<DownloadLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('');
  const [noticeButtonLabel, setNoticeButtonLabel] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  /** Which row was last copied, and whether it worked — drives inline feedback. */
  const [copyState, setCopyState] = useState<{ index: number; ok: boolean } | null>(null);
  /** Row currently being handed to a downloader, and the outcome of the last send. */
  const [sendingIndex, setSendingIndex] = useState<number | null>(null);
  const [sendState, setSendState] = useState<{ index: number; ok: boolean; message: string } | null>(null);
  /** Whether this server has qBittorrent configured; hides the button if not. */
  const [qbitConfigured, setQbitConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/downloads/qbittorrent')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!cancelled && data?.configured) setQbitConfigured(true);
      })
      .catch(() => {}); // Non-fatal: the button just stays hidden.
    return () => { cancelled = true; };
  }, []);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<DownloadContext>({ gameTitle: '', currentVersion: '', type: '' });

  // Max auto-retries when the scraper returns empty results (it's flaky on cold hits)
  const MAX_AUTO_RETRIES = 2;
  const RETRY_DELAY_MS = 800;

  const fetchDownloadLinks = async (attempt = 0): Promise<void> => {
    // If embedded download links are available, use them directly.
    if (embeddedDownloadLinks && embeddedDownloadLinks.length > 0) {
      setDownloadLinks(embeddedDownloadLinks.map((link, i) => ({
        service: link.service || 'Direct',
        url: link.url,
        type: 'direct',
        displayName: link.label || link.service || `Download ${i + 1}`,
        icon: '🔗'
      })));
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    setNoticeType('');

    try {
      let url: string;

      if (gameId) {
        const params = new URLSearchParams({ gameId });
        if (updateIndex !== undefined) params.append('updateIndex', updateIndex.toString());
        url = `/api/games/downloads?${params}`;
      } else if (postId && siteType) {
        const params = new URLSearchParams({
          postId,
          siteType,
          ...(gameTitle && { title: gameTitle }),
          ...(postUrl && { postUrl }),
        });
        url = `/api/games/links?${params}`;
      } else {
        throw new Error('Either gameId or (postId and siteType) must be provided');
      }

      // Always bypass browser HTTP cache — server owns the caching.
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Please sign in to view download links');
        }
        throw new Error('Failed to fetch download links');
      }

      const data = (await response.json()) as DownloadLinksApiResponse;
      const links: DownloadLink[] = data.downloadLinks || [];
      const ctx: DownloadContext = data.context || { gameTitle: '', currentVersion: '', type: '' };
      setContext(ctx);
      setNotice(data.notice || '');
      setNoticeType(data.noticeType || '');
      setNoticeButtonLabel(data.noticeButtonLabel || '');

      if (data.noticeType === 'follow_post') {
        setDownloadLinks([]);
        return;
      }

      // If scraper returned nothing, auto-retry a couple of times — the first
      // attempt often fails when FlareSolverr / upstream is cold.
      if (links.length === 0 && attempt < MAX_AUTO_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        return fetchDownloadLinks(attempt + 1);
      }

      setDownloadLinks(links);
    } catch (err: unknown) {
      console.error('Download links fetch error:', err);
      const message = err instanceof Error ? err.message : 'Failed to fetch download links';
      const isAuthError = message.toLowerCase().includes('sign in');
      if (!isAuthError && attempt < MAX_AUTO_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        return fetchDownloadLinks(attempt + 1);
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    if (!isOpen && downloadLinks.length === 0 && !loading) {
      fetchDownloadLinks();
    }
    
    if (!isOpen && buttonRef.current) {
      // Calculate initial position with viewport bounds checking
      const rect = buttonRef.current.getBoundingClientRect();
      
      // For fixed positioning, we use getBoundingClientRect() directly 
      // since it's relative to the viewport, not the document
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const dropdownHeight = 384; // max-h-96 = ~384px
      const dropdownWidth = Math.max(rect.width, 320);
      
      let top = rect.bottom + 4;
      let left = rect.left;
      
      // If dropdown would go off bottom of viewport, show it above the button
      if (rect.bottom + dropdownHeight > viewportHeight) {
        top = rect.top - dropdownHeight - 4;
      }
      
      // If dropdown would go off right edge, align it to the right
      if (rect.left + dropdownWidth > viewportWidth) {
        left = rect.right - dropdownWidth;
      }
      
      // Ensure it doesn't go off the left edge
      if (left < 0) {
        left = 4;
      }
      
      setDropdownPosition({
        top,
        left,
        width: rect.width
      });
    }
    
    setIsOpen(!isOpen);
  };

  // Close dropdown when clicking outside and handle scroll updates
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const updatePosition = () => {
      if (isOpen && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        
        // If button is scrolled too far off screen, close the dropdown
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          setIsOpen(false);
          return;
        }
        
        // For fixed positioning, use getBoundingClientRect() directly
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const dropdownHeight = 384; // max-h-96 = ~384px
        const dropdownWidth = Math.max(rect.width, 320);
        
        let top = rect.bottom + 4;
        let left = rect.left;
        
        // If dropdown would go off bottom of viewport, show it above the button
        if (rect.bottom + dropdownHeight > viewportHeight) {
          top = rect.top - dropdownHeight - 4;
        }
        
        // If dropdown would go off right edge, align it to the right
        if (rect.left + dropdownWidth > viewportWidth) {
          left = rect.right - dropdownWidth;
        }
        
        // Ensure it doesn't go off the left edge
        if (left < 0) {
          left = 4;
        }
        
        setDropdownPosition({
          top,
          left,
          width: rect.width
        });
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isOpen]);

  const copyToClipboard = async (url: string, index: number) => {
    const ok = await copyTextToClipboard(url);
    setCopyState({ index, ok });
    window.setTimeout(() => setCopyState(null), 1800);
  };

  const sendLinkToQbit = async (link: DownloadLink, index: number) => {
    setSendingIndex(index);
    try {
      const response = await fetch('/api/downloads/qbittorrent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: link.url,
          title: context.gameTitle || gameTitle || undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSendState({
          index,
          ok: false,
          message: data.hint ? `${data.error} ${data.hint}` : (data.error || 'Failed to send to qBittorrent'),
        });
        return;
      }
      setSendState({ index, ok: true, message: data.message || 'Added to qBittorrent' });
    } catch {
      setSendState({ index, ok: false, message: 'Could not reach the server.' });
    } finally {
      setSendingIndex(null);
      window.setTimeout(() => setSendState(null), 4000);
    }
  };

  const sendLinkToJd2 = async (link: DownloadLink, index: number) => {
    setSendingIndex(index);
    try {
      const response = await fetch('/api/downloads/jd2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: context.gameTitle || gameTitle || 'Download',
          version: context.currentVersion && context.currentVersion !== 'Unknown'
            ? context.currentVersion
            : undefined,
          gameLink: context.postUrl || postUrl || '',
          trackedGameId: gameId,
          postId,
          siteType,
          downloadLinks: [{ service: link.service, url: link.url, type: link.type }],
          // The user picked this exact link, so JD2_HOST_PRIORITY must not
          // filter it out for being an unlisted host.
          ignoreHostPriority: true,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSendState({
          index,
          ok: false,
          message: data.hint ? `${data.error} ${data.hint}` : (data.error || 'Failed to send to JDownloader'),
        });
        return;
      }
      setSendState({ index, ok: true, message: data.message || 'Sent to JDownloader' });
    } catch {
      setSendState({ index, ok: false, message: 'Could not reach the server.' });
    } finally {
      setSendingIndex(null);
      window.setTimeout(() => setSendState(null), 4000);
    }
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="w-full px-4 py-2 bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-700 dark:text-green-300 text-sm rounded-lg hover:from-green-500/30 hover:to-emerald-500/30 transition-all duration-200 flex items-center justify-center gap-2 min-h-[40px] backdrop-blur-sm border border-green-300/30 hover:scale-105"
      >
        <span>📁</span>
        <span>Download Links</span>
        <span className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          ⌄
        </span>
      </button>

      {isOpen && typeof window !== 'undefined' && createPortal(
        <>
          {/* Invisible overlay to capture outside clicks */}
          <div 
            className="fixed inset-0" 
            style={{ zIndex: 99998 }}
            onClick={() => setIsOpen(false)}
          />
          <div 
            ref={dropdownRef}
            className="fixed min-w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl max-h-96 overflow-y-auto"
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              minWidth: `${Math.max(dropdownPosition.width, 320)}px`,
              zIndex: 99999
            }}
          >
            {/* Header */}
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">Download Links</h3>
            {context.gameTitle && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {context.gameTitle} - {context.currentVersion}
              </p>
            )}
            {context.source && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Source: {context.source}
              </p>
            )}
          </div>

          {/* Content */}
          <div className="p-3">
            {loading && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"></div>
                <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Loading links...</span>
              </div>
            )}

            {error && !loading && (
              <div className="py-2">
                <div className="text-red-600 dark:text-red-400 text-sm mb-2">
                  {error}
                </div>
                <button
                  onClick={() => fetchDownloadLinks()}
                  className="px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                >
                  🔄 Retry
                </button>
              </div>
            )}

            {!loading && !error && noticeType === 'follow_post' && (
              <div className="py-2 space-y-3">
                <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
                  {notice}
                </p>
                {(context.postUrl || postUrl) && (
                  <a
                    href={context.postUrl || postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors min-h-[40px]"
                  >
                    {noticeButtonLabel || 'Open original post'}
                  </a>
                )}
              </div>
            )}

            {!loading && !error && noticeType !== 'follow_post' && downloadLinks.length === 0 && (
              <div className="py-2">
                <div className="text-gray-500 dark:text-gray-400 text-sm mb-2">
                  No download links available
                </div>
                <button
                  onClick={() => fetchDownloadLinks()}
                  className="px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                >
                  🔄 Retry
                </button>
              </div>
            )}

            {downloadLinks.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  {downloadLinks.length} download option{downloadLinks.length !== 1 ? 's' : ''} available:
                </p>
                
                {downloadLinks.map((link, index) => (
                  <div 
                    key={index}
                    className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-base">{link.icon}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {link.displayName}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
                        {link.type}
                      </span>
                    </div>
                    
                    <div className="flex gap-1 ml-2">
                      <button
                        onClick={() => copyToClipboard(link.url, index)}
                        className={`px-3 py-2 text-sm rounded-lg transition-colors min-h-[36px] ${
                          copyState?.index === index
                            ? copyState.ok
                              ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                              : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                            : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800'
                        }`}
                        title={
                          copyState?.index === index && !copyState.ok
                            ? 'Copy failed — select the link and copy manually'
                            : 'Copy link'
                        }
                      >
                        {copyState?.index === index ? (copyState.ok ? '✓' : '✕') : '📋'}
                      </button>
                      {qbitConfigured && isTorrentUrl(link.url, link.type, link.service) && (
                        <button
                          onClick={() => sendLinkToQbit(link, index)}
                          disabled={sendingIndex !== null}
                          className={`px-3 py-2 text-sm rounded-lg transition-colors min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed ${
                            sendState?.index === index
                              ? sendState.ok
                                ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                              : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800'
                          }`}
                          title="Send this torrent to qBittorrent"
                          aria-label="Send this torrent to qBittorrent"
                        >
                          {sendingIndex === index ? (
                            <span className="inline-block h-3.5 w-3.5 border-2 border-purple-500/40 border-t-purple-600 rounded-full animate-spin align-middle" />
                          ) : sendState?.index === index ? (
                            sendState.ok ? '✓' : '✕'
                          ) : (
                            '🧲'
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => sendLinkToJd2(link, index)}
                        disabled={sendingIndex !== null}
                        className={`px-3 py-2 text-sm rounded-lg transition-colors min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed ${
                          sendState?.index === index
                            ? sendState.ok
                              ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                              : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                            : 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800'
                        }`}
                        title="Send this link to JDownloader"
                        aria-label="Send this link to JDownloader"
                      >
                        {sendingIndex === index ? (
                          <span className="inline-block h-3.5 w-3.5 border-2 border-amber-500/40 border-t-amber-600 rounded-full animate-spin align-middle" />
                        ) : sendState?.index === index ? (
                          sendState.ok ? '✓' : '✕'
                        ) : (
                          '⬇️'
                        )}
                      </button>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 text-sm bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-800 transition-colors min-h-[36px]"
                        title="Open link"
                      >
                        🔗
                      </a>
                    </div>
                  </div>
                ))}
                
                {sendState && (
                  <div
                    className={`text-xs rounded-lg p-2 ${
                      sendState.ok
                        ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                        : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                    }`}
                  >
                    {sendState.message}
                  </div>
                )}

                {context.postUrl && (
                  <div className="pt-2 mt-2 border-t border-gray-200 dark:border-gray-600">
                    <a
                      href={context.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors min-h-[40px]"
                    >
                      📖 View Original Post
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        </>,
        document.body
      )}
    </div>
  );
}

// Keep the original component for backward compatibility
export function DownloadLinks({ gameId, updateIndex, className }: {
  gameId: string;
  updateIndex?: number;
  className?: string;
}) {
  return (
    <GameDownloadLinks 
      gameId={gameId}
      updateIndex={updateIndex}
      className={className}
    />
  );
}
