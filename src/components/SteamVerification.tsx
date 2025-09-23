'use client';

import { useState, useRef, useEffect } from 'react';
import { cleanGameTitle } from '@/utils/steamApi';
import { useNotification } from '../contexts/NotificationContext';

interface SteamGameResult {
  appid: number;
  name: string;
  developer?: string;
  publisher?: string;
  score_rank?: string;
  positive?: number;
  negative?: number;
  userscore?: number;
  price?: string;
  initialprice?: string;
  discount?: string;
  tags?: Record<string, number>;
}

interface SteamVerificationProps {
  gameId: string;
  gameTitle: string;
  steamName?: string;
  steamVerified?: boolean;
  onVerificationUpdate: (gameId: string, verified: boolean, steamAppId?: number, steamName?: string) => void;
}

export function SteamVerification({ 
  gameId, 
  gameTitle, 
  steamName, 
  steamVerified = false, 
  onVerificationUpdate 
}: SteamVerificationProps) {
  const { showError } = useNotification();
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SteamGameResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const cleanedTitle = cleanGameTitle(gameTitle);

  // Calculate dropdown position based on available viewport space - same as DownloadLinks
  const handleToggle = () => {
    if (!isOpen && buttonRef.current) {
      // Calculate position for dropdown - improved mobile-first positioning
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      // Responsive dropdown sizing
      const isMobile = viewportWidth < 768;
      const dropdownHeight = 400; // estimated height for Steam dropdown
      const dropdownWidth = isMobile ? Math.min(viewportWidth - 16, 320) : Math.max(rect.width, 300);
      
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

  // Close dropdown when clicking outside and handle scroll updates - same as DownloadLinks
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
        const dropdownHeight = 400; // estimated height
        const dropdownWidth = isMobile ? Math.min(viewportWidth - 16, 320) : Math.max(rect.width, 300);
        
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

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await fetch('/api/games/steam-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          query: searchQuery.trim()
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to search Steam API');
      }

      const data = await response.json();
      setSearchResults(data.results || []);
    } catch (error) {
      console.error('Steam search error:', error);
      showError('Search Failed', 'Failed to search Steam API. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleLinkGame = async (steamApp: SteamGameResult | null) => {
    setIsLinking(true);
    try {
      const response = await fetch('/api/games/steam-verify', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          steamAppId: steamApp?.appid || null,
          steamName: steamApp?.name || null
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to link Steam game');
      }

      const data = await response.json();
      onVerificationUpdate(gameId, true, steamApp?.appid, steamApp?.name);
      console.log('Steam game linked:', data);
      setIsOpen(false);
      setSearchResults([]);
      setSearchQuery('');
    } catch (error) {
      console.error('Steam link error:', error);
      showError('Linking Failed', 'Failed to link Steam game. Please try again.');
    } finally {
      setIsLinking(false);
    }
  };

  const handleRemoveVerification = async () => {
    setIsLinking(true);
    try {
      const response = await fetch(`/api/games/steam-verify?gameId=${gameId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to remove Steam verification');
      }

      onVerificationUpdate(gameId, false);
      setIsOpen(false);
    } catch (error) {
      console.error('Steam unlink error:', error);
      showError('Unlink Failed', 'Failed to remove Steam verification. Please try again.');
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div className="relative">
      {/* Current Status */}
      <div className="flex items-center gap-2 mb-2">
        {steamVerified && steamName ? (
          <div className="flex items-center gap-1 text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-1 rounded">
            <span>✅</span>
            <span>Steam: {steamName}</span>
            <button
              ref={buttonRef}
              onClick={handleToggle}
              className="ml-1 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200"
            >
              ⚙️
            </button>
          </div>
        ) : (
          <button
            ref={buttonRef}
            onClick={handleToggle}
            className="flex items-center gap-1 text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 px-2 py-1 rounded hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors"
          >
            <span>🔍</span>
            <span>Verify with Steam</span>
          </button>
        )}
      </div>

      {/* Search Interface - using fixed positioning like DownloadLinks */}
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
          <div className="p-3 max-h-96 overflow-y-auto">
            {/* Search Input */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Search Steam:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Try: "${cleanedTitle}"`}
                  className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch();
                  }}
                />
                <button
                  onClick={handleSearch}
                  disabled={isSearching}
                  className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSearching ? '🔄' : '🔍'}
                </button>
              </div>
            </div>

            {/* Quick Fill Button */}
            <button
              onClick={() => setSearchQuery(cleanedTitle)}
              className="mb-3 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 underline"
            >
              Use cleaned title
            </button>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto">
                <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select Steam Game:
                </h4>
                <div className="space-y-2">
                  {searchResults.map((result) => (
                    <div
                      key={result.appid}
                      className="p-2 bg-gray-50 dark:bg-gray-700 rounded border hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
                      onClick={() => handleLinkGame(result)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
                            {result.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            App ID: {result.appid}
                          </p>
                          {result.developer && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {result.developer}
                            </p>
                          )}
                        </div>
                        {result.score_rank && (
                          <div className="ml-2 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1 rounded">
                            #{result.score_rank}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex gap-2 flex-wrap">
              {steamVerified && (
                <button
                  onClick={handleRemoveVerification}
                  disabled={isLinking}
                  className="text-xs px-2 py-1 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800 disabled:opacity-50"
                >
                  {isLinking ? '🔄' : 'Remove Link'}
                </button>
              )}
              <button
                onClick={() => handleLinkGame(null)}
                disabled={isLinking}
                className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {isLinking ? '🔄' : 'Mark as Non-Steam'}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}