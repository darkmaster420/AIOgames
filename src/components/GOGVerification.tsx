/**
 * GOG Verification Component
 * Allows users to verify games against GOGDB and fetch version information
 */

'use client';

import { useState } from 'react';
import { useNotification } from '@/contexts/NotificationContext';

interface GOGVerificationProps {
  gameId: string;
  gameTitle: string;
  currentGogId?: number;
  currentGogName?: string;
  currentGogVersion?: string;
  currentGogBuildId?: string;
  isVerified?: boolean;
  gogLatestVersion?: string;
  gogLatestBuildId?: string;
  gogLatestDate?: string;
  onVerificationComplete?: () => void;
}

export default function GOGVerification({
  gameId,
  gameTitle,
  currentGogId,
  currentGogName,
  currentGogVersion: _currentGogVersion,
  currentGogBuildId: _currentGogBuildId,
  isVerified = false,
  gogLatestVersion,
  gogLatestBuildId,
  gogLatestDate,
  onVerificationComplete
}: GOGVerificationProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<GOGDBSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const { showSuccess, showError, showWarning } = useNotification();

interface GOGDBSearchResult {
  id: number;
  title: string;
  slug: string;
  type: string;
  image?: string;
  releaseDate?: string;
}

  const handleManualSearch = async (query?: string) => {
    const searchTerm = query || searchQuery;
    if (!searchTerm.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await fetch(`/api/gogdb?action=search&query=${encodeURIComponent(searchTerm.trim())}`);
      const data = await response.json();

      if (data.success && data.results.length > 0) {
        setSearchResults(data.results);
      } else {
        showWarning('⚠️ No GOG results found');
        setSearchResults([]);
      }
    } catch (error) {
      console.error('GOG search error:', error);
      showError('❌ GOG search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggle = () => {
    const willBeOpen = !showResults;
    setShowResults(willBeOpen);
    // Auto-search when opening
    if (willBeOpen) {
      setSearchQuery(gameTitle);
      // Trigger search after state update
      setTimeout(() => handleManualSearch(gameTitle), 0);
    }
  };

  const handleSelectResult = async (result: GOGDBSearchResult) => {
    setIsLinking(true);
    try {
      // Get version info for selected product
      const versionResponse = await fetch(`/api/gogdb?action=version&productId=${result.id}`);
      const versionData = await versionResponse.json();

      // Update the game with GOG verification
      const updateResponse = await fetch(`/api/games/gog-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          gogId: result.id,
          gogName: result.title,
          gogVersion: versionData.version || undefined,
          gogBuildId: versionData.buildId || undefined
        })
      });

      if (updateResponse.ok) {
        showSuccess(`✅ GOG verified: ${result.title}`);
        setShowResults(false);
        setSearchResults([]);
        setSearchQuery('');
        if (onVerificationComplete) onVerificationComplete();
      } else {
        showError('❌ Failed to save GOG verification');
      }
    } catch (error) {
      console.error('GOG selection error:', error);
      showError('❌ Failed to verify GOG game');
    } finally {
      setIsLinking(false);
    }
  };

  const handleRemoveVerification = async () => {
    try {
      const response = await fetch(`/api/games/gog-verify`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId })
      });

      if (response.ok) {
        showSuccess('✅ GOG verification removed');
        if (onVerificationComplete) onVerificationComplete();
      } else {
        showError('❌ Failed to remove GOG verification');
      }
    } catch (error) {
      console.error('GOG removal error:', error);
      showError('❌ Failed to remove GOG verification');
    }
  };

  return (
    <div className="gog-verification-container space-y-3">
      {/* Current GOG Status */}
      {isVerified && currentGogId ? (
        <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-purple-400">GOG Verified</span>
                <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-300 rounded">
                  ID: {currentGogId}
                </span>
              </div>
              <div className="text-sm text-gray-300 mb-1">{currentGogName}</div>
              {/* Latest Version Info */}
              {(gogLatestVersion || gogLatestBuildId) && (
                <div className="mt-2 pt-2 border-t border-purple-500/20">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-purple-300">Latest Version:</span>
                    {gogLatestVersion && (
                      <span className="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 rounded text-xs">
                        v{gogLatestVersion}
                      </span>
                    )}
                    {gogLatestBuildId && (
                      <span className="px-1.5 py-0.5 bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200 rounded text-xs">
                        Build {gogLatestBuildId}
                      </span>
                    )}
                    {gogLatestDate && (
                      <span className="text-xs text-gray-400">
                        {new Date(gogLatestDate).toLocaleDateString()}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-[10px] font-bold">
                      PRIORITY
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleToggle}
                className="px-3 py-1.5 text-xs font-medium bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded transition-colors"
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
        /* Verification Button */
        <button
          onClick={handleToggle}
          className="w-full px-3 py-2 text-sm font-medium bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg transition-colors"
        >
          🔍 Verify with GOG
        </button>
      )}

      {/* Search Results Modal */}
      {showResults && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">GOG Verification</h3>
              <button
                onClick={() => {
                  setShowResults(false);
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
                  Search GOG:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleManualSearch();
                      }
                    }}
                    placeholder={`Try: ${gameTitle}`}
                    className="flex-1 px-3 py-2 text-sm border border-gray-600 rounded-lg bg-gray-700 text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  <button
                    onClick={() => handleManualSearch()}
                    disabled={isSearching}
                    className="px-4 py-2 text-sm font-medium bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSearching ? '⏳' : '🔍'}
                  </button>
                </div>
              </div>

              {/* Results */}
              {searchResults.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm text-gray-400">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
                  </div>
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      onClick={() => handleSelectResult(result)}
                      disabled={isLinking}
                      className="w-full p-3 text-left bg-gray-700/50 hover:bg-gray-700 border border-gray-600 hover:border-purple-500/50 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="flex items-start gap-3">
                        {result.image && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={result.image}
                            alt={result.title}
                            className="w-12 h-12 object-cover rounded"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white truncate">{result.title}</div>
                          <div className="text-sm text-gray-400">
                            ID: {result.id} • Type: {result.type}
                          </div>
                          {result.releaseDate && (
                            <div className="text-xs text-gray-500">Released: {result.releaseDate}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : !isSearching && searchQuery ? (
                <div className="text-center py-8 text-gray-400">
                  No results found for &quot;{searchQuery}&quot;
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
