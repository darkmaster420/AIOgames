'use client';

import { useState, useEffect } from 'react';
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

  const cleanedTitle = cleanGameTitle(gameTitle);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && event.target instanceof Element && !event.target.closest('.steam-verification-container')) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
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
    <div className="steam-verification-container">
      {/* Current Status */}
      <div className="flex items-center gap-2 mb-2">
        {steamVerified && steamName ? (
          <div className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 px-2 py-1 rounded border border-gray-300 dark:border-gray-600">
            <span>✔️</span>
            <span>Steam: {steamName}</span>
            <button
              onClick={handleToggle}
              className="ml-1 text-white-600 dark:text-white-400 hover:text-white-800 dark:hover:text-white-200"
            >
              ⚙️
            </button>
          </div>
        ) : (
          <button
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
        <div className="mt-2 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                Steam Verification
              </h4>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            {/* Search Input */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Search Steam:
              </label>
              <div className="flex gap-2 flex-col sm:flex-row">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Try: "${cleanedTitle}"`}
                  className="w-full sm:flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch();
                  }}
                />
                <button
                  onClick={handleSearch}
                  disabled={isSearching}
                  className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 w-full sm:w-auto"
                >
                  {isSearching ? '🔄' : '🔍'}
                </button>
              </div>
            </div>

            {/* Quick Fill Button */}
            <button
              onClick={() => setSearchQuery(cleanedTitle)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 underline"
            >
              Use cleaned title: &ldquo;{cleanedTitle}&rdquo;
            </button>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select Steam Game:
                </h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {searchResults.map((result) => (
                    <div
                      key={result.appid}
                      className="p-3 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer transition-colors"
                      onClick={() => handleLinkGame(result)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {result.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            App ID: {result.appid}
                          </p>
                          {result.developer && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              by {result.developer}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          {result.score_rank && (
                            <div className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-1 rounded mb-1">
                              #{result.score_rank}
                            </div>
                          )}
                          {result.positive && result.negative && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {Math.round((result.positive / (result.positive + result.negative)) * 100)}% positive
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-600">
              {steamVerified && (
                <button
                  onClick={handleRemoveVerification}
                  disabled={isLinking}
                  className="text-sm px-3 py-1 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800 disabled:opacity-50"
                >
                  {isLinking ? '🔄' : 'Remove Link'}
                </button>
              )}
              <button
                onClick={() => handleLinkGame(null)}
                disabled={isLinking}
                className="text-sm px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {isLinking ? '🔄' : 'Mark as Non-Steam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}