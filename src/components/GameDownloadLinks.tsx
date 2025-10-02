'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface DownloadLink {
  service: string;
  url: string;
  type: string;
  displayName: string;
  icon: string;
}

interface GameDownloadLinksProps {
  // For tracked games
  gameId?: string;
  updateIndex?: number;
  pendingUpdateId?: string;
  // For any game from main dashboard
  postId?: string;
  siteType?: string;
  gameTitle?: string;
  className?: string;
}

export function GameDownloadLinks({ 
  gameId, 
  updateIndex, 
  pendingUpdateId, 
  postId, 
  siteType, 
  gameTitle,
  className = '' 
}: GameDownloadLinksProps) {
  const [downloadLinks, setDownloadLinks] = useState<DownloadLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<{
    gameTitle: string;
    currentVersion: string;
    type: string;
    postUrl?: string;
    source?: string;
  }>({ gameTitle: '', currentVersion: '', type: '' });

  const fetchDownloadLinks = async () => {
    setLoading(true);
    setError('');
    
    try {
      let url: string;
      
      if (gameId) {
        // For tracked games, use existing API
        const params = new URLSearchParams({ gameId });
        if (updateIndex !== undefined) params.append('updateIndex', updateIndex.toString());
        if (pendingUpdateId) params.append('pendingUpdateId', pendingUpdateId);
        url = `/api/games/downloads?${params}`;
      } else if (postId && siteType) {
        // For any game, use new gameapi endpoint
        const params = new URLSearchParams({ 
          postId, 
          siteType,
          ...(gameTitle && { title: gameTitle })
        });
        url = `/api/games/links?${params}`;
      } else {
        throw new Error('Either gameId or (postId and siteType) must be provided');
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Please sign in to view download links');
        }
        throw new Error('Failed to fetch download links');
      }
      
      const data = await response.json();
      setDownloadLinks(data.downloadLinks || []);
      setContext(data.context || { gameTitle: '', currentVersion: '', type: '' });
    } catch (err: unknown) {
      console.error('Download links fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch download links');
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

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      // You could add a toast notification here
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
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

            {error && (
              <div className="text-red-600 dark:text-red-400 text-sm py-2">
                {error}
              </div>
            )}

            {!loading && !error && downloadLinks.length === 0 && (
              <div className="text-gray-500 dark:text-gray-400 text-sm py-2">
                No download links available
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
                        onClick={() => copyToClipboard(link.url)}
                      className="px-3 py-2 text-sm bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors min-h-[36px]"
                        title="Copy link"
                      >
                        📋
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
export function DownloadLinks({ gameId, updateIndex, pendingUpdateId, className }: {
  gameId: string;
  updateIndex?: number;
  pendingUpdateId?: string;
  className?: string;
}) {
  return (
    <GameDownloadLinks 
      gameId={gameId}
      updateIndex={updateIndex}
      pendingUpdateId={pendingUpdateId}
      className={className}
    />
  );
}