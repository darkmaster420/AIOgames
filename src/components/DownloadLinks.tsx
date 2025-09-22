'use client';

import { useState, useRef, useEffect } from 'react';

interface DownloadLink {
  service: string;
  url: string;
  type: string;
  displayName: string;
  icon: string;
}

interface DownloadLinksProps {
  gameId: string;
  updateIndex?: number;
  pendingUpdateId?: string;
  className?: string;
}

export function DownloadLinks({ gameId, updateIndex, pendingUpdateId, className = '' }: DownloadLinksProps) {
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
  }>({ gameTitle: '', currentVersion: '', type: '' });

  const fetchDownloadLinks = async () => {
    setLoading(true);
    setError('');
    
    try {
      const params = new URLSearchParams({ gameId });
      if (updateIndex !== undefined) params.append('updateIndex', updateIndex.toString());
      if (pendingUpdateId) params.append('pendingUpdateId', pendingUpdateId);
      
      const response = await fetch(`/api/games/downloads?${params}`);
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
      // Calculate position for dropdown - improved mobile-first positioning
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      // Responsive dropdown sizing
      const isMobile = viewportWidth < 768;
      const dropdownHeight = 300; // estimated height
      const dropdownWidth = isMobile ? Math.min(viewportWidth - 16, 320) : Math.max(rect.width, 200);
      
      let top = rect.bottom + 4;
      let left = rect.left;
      
      // Mobile-specific positioning
      if (isMobile) {
        // On mobile, center the dropdown or align to screen edges
        const idealLeft = Math.max(8, Math.min(rect.left, viewportWidth - dropdownWidth - 8));
        left = idealLeft;
        
        // If dropdown would go off bottom, show above with mobile considerations
        if (rect.bottom + dropdownHeight > viewportHeight - 20) {
          top = Math.max(20, rect.top - dropdownHeight - 4);
        }
      } else {
        // Desktop positioning logic
        if (rect.bottom + dropdownHeight > viewportHeight) {
          top = rect.top - dropdownHeight - 4;
        }
        
        if (rect.left + dropdownWidth > viewportWidth) {
          left = rect.right - dropdownWidth;
        }
        
        if (left < 4) {
          left = 4;
        }
      }
      
      setDropdownPosition({
        top,
        left,
        width: dropdownWidth
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
        
        // Improved mobile-responsive positioning
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const isMobile = viewportWidth < 768;
        const dropdownHeight = 300; // estimated height
        const dropdownWidth = isMobile ? Math.min(viewportWidth - 16, 320) : Math.max(rect.width, 200);
        
        let top = rect.bottom + 4;
        let left = rect.left;
        
        if (isMobile) {
          // Mobile positioning - keep within screen bounds
          const idealLeft = Math.max(8, Math.min(rect.left, viewportWidth - dropdownWidth - 8));
          left = idealLeft;
          
          if (rect.bottom + dropdownHeight > viewportHeight - 20) {
            top = Math.max(20, rect.top - dropdownHeight - 4);
          }
        } else {
          // Desktop positioning
          if (rect.bottom + dropdownHeight > viewportHeight) {
            top = rect.top - dropdownHeight - 4;
          }
          
          if (rect.left + dropdownWidth > viewportWidth) {
            left = rect.right - dropdownWidth;
          }
          
          if (left < 4) {
            left = 4;
          }
        }
        
        setDropdownPosition({
          top,
          left,
          width: dropdownWidth
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
    <>
      <div className={`relative inline-block ${className}`}>
        <button
          ref={buttonRef}
          onClick={handleToggle}
          className="px-3 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-sm rounded hover:bg-green-200 dark:hover:bg-green-800 transition-colors flex items-center gap-2"
        >
          <span>📁</span>
          <span>Download Links</span>
          <span className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`}>
            ⌄
          </span>
        </button>
      </div>

      {isOpen && (
        <div 
          ref={dropdownRef}
          className="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-96 overflow-y-auto"
          style={{
            position: 'fixed',
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: dropdownPosition.width > 0 ? `${dropdownPosition.width}px` : '20rem',
            minWidth: '16rem',
            maxWidth: '90vw',
            zIndex: 9999
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
          </div>

          {/* Content */}
          <div className="p-3">
            {loading && (
              <div className="flex items-center justify-center py-4">
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Loading...</span>
              </div>
            )}

            {error && (
              <div className="text-center py-4">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {!loading && !error && downloadLinks.length === 0 && (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">No download links available</p>
              </div>
            )}

            {!loading && downloadLinks.length > 0 && (
              <div className="space-y-2">
                {downloadLinks.map((link, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-lg">{link.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {link.displayName}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {link.url}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => copyToClipboard(link.url)}
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                        title="Copy link"
                      >
                        <span className="text-sm">📋</span>
                      </button>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                        title="Open link"
                      >
                        <span className="text-sm">🔗</span>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {!loading && downloadLinks.length > 0 && (
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                {downloadLinks.length} download link{downloadLinks.length !== 1 ? 's' : ''} available
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}