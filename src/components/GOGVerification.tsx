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
  onVerificationComplete?: () => void;
}

export default function GOGVerification({
  gameId,
  gameTitle,
  currentGogId,
  currentGogName,
  currentGogVersion,
  currentGogBuildId,
  isVerified = false,
  onVerificationComplete
}: GOGVerificationProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [searchResults, setSearchResults] = useState<GOGDBSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const { showSuccess, showError, showWarning, showInfo } = useNotification();

interface GOGDBSearchResult {
  id: number;
  title: string;
  slug: string;
  type: string;
  image?: string;
  releaseDate?: string;
}

  const handleAutoVerify = async () => {
    setIsSearching(true);
    try {
      const response = await fetch(`/api/gogdb?action=verify&gameTitle=${encodeURIComponent(gameTitle)}`);
      const data = await response.json();

      if (data.success && data.verified && data.gogId) {
        // Update the game with GOG verification
        const updateResponse = await fetch(`/api/games/gog-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameId,
            gogId: data.gogId,
            gogName: data.gogTitle,
            gogVersion: data.version,
            gogBuildId: data.buildId
          })
        });

        if (updateResponse.ok) {
          showSuccess( `✅ GOG verification successful: ${data.gogTitle}`);
          if (onVerificationComplete) onVerificationComplete();
        } else {
          showError( '❌ Failed to save GOG verification');
        }
      } else {
        showWarning( '⚠️ No GOG match found. Try manual search.');
      }
    } catch (error) {
      console.error('GOG verification error:', error);
      showError( '❌ GOG verification failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleManualSearch = async () => {
    setIsSearching(true);
    try {
      const response = await fetch(`/api/gogdb?action=search&query=${encodeURIComponent(gameTitle)}`);
      const data = await response.json();

      if (data.success && data.results.length > 0) {
        setSearchResults(data.results);
        setShowResults(true);
      } else {
        showWarning( '⚠️ No GOG results found');
      }
    } catch (error) {
      console.error('GOG search error:', error);
      showError( '❌ GOG search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectResult = async (result: GOGDBSearchResult) => {
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
          gogVersion: versionData.version,
          gogBuildId: versionData.buildId
        })
      });

      if (updateResponse.ok) {
        showSuccess( `✅ GOG verified: ${result.title}`);
        setShowResults(false);
        if (onVerificationComplete) onVerificationComplete();
      } else {
        showError( '❌ Failed to save GOG verification');
      }
    } catch (error) {
      console.error('GOG selection error:', error);
      showError( '❌ Failed to verify GOG game');
    }
  };

  const handleCheckUpdate = async () => {
    if (!currentGogId) return;

    setIsChecking(true);
    try {
      const response = await fetch(
        `/api/gogdb?action=compare&productId=${currentGogId}` +
        `${currentGogVersion ? `&currentVersion=${encodeURIComponent(currentGogVersion)}` : ''}` +
        `${currentGogBuildId ? `&currentBuild=${encodeURIComponent(currentGogBuildId)}` : ''}`
      );
      const data = await response.json();

      if (data.success) {
        if (data.hasUpdate) {
          showInfo( 
            `🆕 GOG Update Available!\n` +
            `Current: ${currentGogVersion || currentGogBuildId || 'Unknown'}\n` +
            `Latest: ${data.latestVersion || data.latestBuild || 'Unknown'}`
          );
        } else {
          showSuccess( '✅ GOG version is up to date');
        }
      }
    } catch (error) {
      console.error('GOG update check error:', error);
      showError( '❌ Failed to check GOG updates');
    } finally {
      setIsChecking(false);
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
        showSuccess( '✅ GOG verification removed');
        if (onVerificationComplete) onVerificationComplete();
      } else {
        showError( '❌ Failed to remove GOG verification');
      }
    } catch (error) {
      console.error('GOG removal error:', error);
      showError( '❌ Failed to remove GOG verification');
    }
  };

  return (
    <div className="space-y-3">
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
              {(currentGogVersion || currentGogBuildId) && (
                <div className="text-xs text-gray-400">
                  {currentGogVersion && `Version: ${currentGogVersion}`}
                  {currentGogVersion && currentGogBuildId && ' • '}
                  {currentGogBuildId && `Build: ${currentGogBuildId}`}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCheckUpdate}
                disabled={isChecking}
                className="px-3 py-1.5 text-xs font-medium bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded transition-colors disabled:opacity-50"
              >
                {isChecking ? '⏳' : '🔄'} Check
              </button>
              <button
                onClick={handleRemoveVerification}
                className="px-3 py-1.5 text-xs font-medium bg-gray-500/20 hover:bg-gray-500/30 text-gray-300 rounded transition-colors"
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
            onClick={handleAutoVerify}
            disabled={isSearching}
            className="flex-1 px-3 py-2 text-sm font-medium bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSearching ? '⏳ Searching...' : '🔍 Auto-Verify GOG'}
          </button>
          <button
            onClick={handleManualSearch}
            disabled={isSearching}
            className="px-3 py-2 text-sm font-medium bg-gray-600/20 hover:bg-gray-600/30 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
          >
            📋 Manual
          </button>
        </div>
      )}

      {/* Search Results Modal */}
      {showResults && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Select GOG Game</h3>
              <button
                onClick={() => setShowResults(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleSelectResult(result)}
                  className="w-full p-3 bg-gray-700/50 hover:bg-gray-700 border border-gray-600 rounded-lg transition-colors text-left"
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
          </div>
        </div>
      )}
    </div>
  );
}
