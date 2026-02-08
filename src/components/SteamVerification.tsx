'use client';

import { useState, useEffect } from 'react';
import { cleanGameTitle } from '@/utils/steamApi';
import { useNotification } from '../contexts/NotificationContext';
import { ExternalLinkIcon } from './ExternalLinkIcon';

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
  steamLatestVersion?: string;
  steamLatestBuild?: string;
  steamLatestLink?: string;
  steamdbUpdate?: {
    title?: string;
    version?: string;
    buildNumber?: string;
    date?: string;
    link?: string;
    isOutdated?: boolean;
    outdatedReason?: string;
    suggestion?: string;
  };
  onVerificationUpdate: (gameId: string, verified: boolean, steamAppId?: number, steamName?: string) => void;
}

export function SteamVerification({ 
  gameId, 
  gameTitle, 
  steamName, 
  steamVerified = false,
  steamLatestVersion,
  steamLatestBuild,
  steamLatestLink,
  steamdbUpdate,
  onVerificationUpdate 
}: SteamVerificationProps) {
  const { showError } = useNotification();
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SteamGameResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  const cleanedTitle = cleanGameTitle(gameTitle);

  const handleSearch = async (query?: string) => {
    const searchTerm = query || searchQuery;
    if (!searchTerm.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await fetch('/api/games/steam-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          query: searchTerm.trim()
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

  const handleToggle = () => {
    const willBeOpen = !isOpen;
    setIsOpen(willBeOpen);
    // Auto-search when opening
    if (willBeOpen) {
      setSearchQuery(cleanedTitle);
      // Trigger search after state update
      setTimeout(() => handleSearch(cleanedTitle), 0);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && event.target instanceof Element && !event.target.closest('.steam-verification-container')) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

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

  const isSteamOutdated = steamdbUpdate?.isOutdated || false;

  return (
    <div className="steam-verification-container space-y-3">
      {/* Current Steam Status */}
      {steamVerified && steamName ? (
        <div className={`p-3 border rounded-lg ${
          isSteamOutdated
            ? 'bg-gradient-to-r from-orange-500/10 to-red-500/10 border-orange-300/30 dark:border-red-400/30'
            : 'bg-blue-500/10 border-blue-500/30'
        }`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm font-semibold ${
                  isSteamOutdated
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-blue-400'
                }`}>
                  {isSteamOutdated ? '⚠️ Version Behind Steam' : 'Steam Verified'}
                </span>
                {isSteamOutdated && steamdbUpdate?.link && (
                  <a
                    href={steamdbUpdate.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-500 hover:text-orange-700 dark:hover:text-orange-300 text-xs transition-colors"
                    title="View on SteamDB"
                  >
                    <ExternalLinkIcon className="w-3 h-3" />
                  </a>
                )}
              </div>
              <div className="text-sm text-gray-300 mb-1">{steamName}</div>
              
              {/* Outdated alert with version comparison */}
              {isSteamOutdated && (
                <div className="mt-1">
                  {steamdbUpdate?.outdatedReason && (
                    <div className="text-xs text-orange-700 dark:text-orange-300 mb-2">
                      {steamdbUpdate.outdatedReason}
                    </div>
                  )}
                  {steamdbUpdate?.suggestion && (
                    <div className="text-xs text-green-700 dark:text-green-300 mb-2 font-medium">
                      💡 {steamdbUpdate.suggestion}
                    </div>
                  )}
                  <div className="flex gap-1 flex-wrap">
                    {steamdbUpdate?.version && (
                      <span className="px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 rounded text-xs">
                        v{steamdbUpdate.version}
                      </span>
                    )}
                    {steamdbUpdate?.buildNumber && (
                      <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded text-xs">
                        Build {steamdbUpdate.buildNumber}
                      </span>
                    )}
                    {steamdbUpdate?.date && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {new Date(steamdbUpdate.date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Non-outdated: calm latest version display */}
              {!isSteamOutdated && (steamLatestVersion || steamLatestBuild) && (
                <div className="mt-2 pt-2 border-t border-blue-500/20">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-blue-300">Latest Version:</span>
                    {steamLatestVersion && (
                      <span className="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 rounded text-xs">
                        v{steamLatestVersion}
                      </span>
                    )}
                    {steamLatestBuild && (
                      <span className="px-1.5 py-0.5 bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200 rounded text-xs">
                        Build {steamLatestBuild}
                      </span>
                    )}
                    {steamLatestLink && (
                      <a
                        href={steamLatestLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 hover:text-sky-300 transition-colors text-xs inline-flex items-center gap-1"
                        title="View on SteamDB"
                      >
                        🔗 SteamDB
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleToggle}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  isSteamOutdated
                    ? 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-300'
                    : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300'
                }`}
              >
                ⚙️ Manage
              </button>
              <button
                onClick={handleRemoveVerification}
                disabled={isLinking}
                className="px-3 py-1.5 text-xs font-medium bg-gray-500/20 hover:bg-gray-500/30 text-gray-300 rounded transition-colors disabled:opacity-50"
              >
                ❌
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Verification Buttons */
        <div className="flex gap-2">
          <button
            onClick={handleToggle}
            className="flex-1 px-3 py-2 text-sm font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg transition-colors"
          >
            🔍 Verify with Steam
          </button>
        </div>
      )}

      {/* Search Results Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Steam Verification</h3>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setSearchResults([]);
                  setSearchQuery('');
                }}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Search Input */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-2">
                  Search Steam:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Try: "${cleanedTitle}"`}
                    className="flex-1 px-3 py-2 text-sm border border-gray-600 rounded-lg bg-gray-700 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearch();
                    }}
                  />
                  <button
                    onClick={() => handleSearch()}
                    disabled={isSearching}
                    className="px-4 py-2 text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSearching ? '⏳' : '🔍'}
                  </button>
                </div>
              </div>

              {/* Quick Fill Button */}
              <button
                onClick={() => setSearchQuery(cleanedTitle)}
                className="text-sm text-blue-400 hover:text-blue-300 underline"
              >
                Use cleaned title: &ldquo;{cleanedTitle}&rdquo;
              </button>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">
                    Select Steam Game:
                  </h4>
                  {searchResults.map((result) => (
                    <button
                      key={result.appid}
                      onClick={() => handleLinkGame(result)}
                      disabled={isLinking}
                      className="w-full p-3 bg-gray-700/50 hover:bg-gray-700 border border-gray-600 rounded-lg transition-colors text-left disabled:opacity-50"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">
                            {result.name}
                          </p>
                          <p className="text-xs text-gray-400">
                            App ID: {result.appid}
                          </p>
                          {result.developer && (
                            <p className="text-xs text-gray-400">
                              by {result.developer}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          {result.score_rank && (
                            <div className="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded mb-1">
                              #{result.score_rank}
                            </div>
                          )}
                          {result.positive && result.negative && (
                            <p className="text-xs text-gray-400">
                              {Math.round((result.positive / (result.positive + result.negative)) * 100)}% positive
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-3 border-t border-gray-600">
                <button
                  onClick={() => handleLinkGame(null)}
                  disabled={isLinking}
                  className="px-3 py-2 text-sm font-medium bg-gray-600/50 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isLinking ? '⏳' : 'Mark as Non-Steam'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}