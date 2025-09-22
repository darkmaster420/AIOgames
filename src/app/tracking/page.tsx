'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Navigation } from '../../components/Navigation';
import { DownloadLinks } from '../../components/DownloadLinks';
import { SteamVerification } from '../../components/SteamVerification';
import { SequelNotifications } from '../../components/SequelNotifications';
import { AddCustomGame } from '../../components/AddCustomGame';
import { ImageWithFallback } from '../../utils/imageProxy';
import { cleanGameTitle } from '../../utils/steamApi';
import { useNotification } from '../../contexts/NotificationContext';

interface TrackedGame {
  _id: string;
  gameId: string;
  title: string;
  source: string;
  image?: string;
  description: string;
  gameLink: string;
  lastKnownVersion: string;
  steamAppId?: number;
  steamName?: string;
  steamVerified?: boolean;
  lastVersionDate?: string;
  dateAdded: string;
  lastChecked: string;
  notificationsEnabled: boolean;
  checkFrequency: string;
  updateHistory: Array<{
    version: string;
    dateFound: string;
    gameLink: string;
    downloadLinks?: Array<{
      service: string;
      url: string;
      type: string;
    }>;
  }>;
  pendingUpdates?: Array<{
    _id: string;
    newTitle: string;
    detectedVersion: string;
    reason: string;
    dateFound: string;
    downloadLinks?: Array<{
      service: string;
      url: string;
      type: string;
    }>;
  }>;
  isActive: boolean;
}

export default function TrackingDashboard() {
  const { status } = useSession();
  const { showSuccess, showError, showInfo } = useNotification();
  const [trackedGames, setTrackedGames] = useState<TrackedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Handle Steam verification updates
  const handleVerificationUpdate = (gameId: string, verified: boolean, steamAppId?: number, steamName?: string) => {
    setTrackedGames(prev => prev.map(game => 
      game._id === gameId 
        ? { ...game, steamVerified: verified, steamAppId, steamName }
        : game
    ));
  };
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      loadTrackedGames();
    }
  }, [status]);

  const loadTrackedGames = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/tracking');
      if (!response.ok) throw new Error('Failed to load tracked games');
      const data = await response.json();
      setTrackedGames(data.games || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleUntrack = async (gameId: string) => {
    try {
      const response = await fetch(`/api/tracking?gameId=${gameId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setTrackedGames(prev => prev.filter(game => game.gameId !== gameId));
        const gameTitle = trackedGames.find(g => g.gameId === gameId)?.title || 'Game';
        showSuccess('Game Removed!', `${gameTitle} has been removed from tracking.`);
      } else {
        const error = await response.json();
        showError('Failed to Remove Game', error.error || 'An unexpected error occurred.');
      }
    } catch {
      showError('Network Error', 'Unable to connect to the server. Please try again.');
    }
  };

  const handleCheckForUpdates = async () => {
    try {
      setCheckingUpdates(true);
      const response = await fetch('/api/updates/check', {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to check for updates');
      
      const result = await response.json();
      showInfo('Update Check Complete!', `Checked ${result.checked} games and found ${result.updatesFound} updates.`);
      
      // Reload tracked games to show any updates
      loadTrackedGames();
    } catch (err) {
      showError('Update Check Failed', err instanceof Error ? err.message : 'Unable to check for updates.');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getTimeSince = (dateString: string) => {
    const now = new Date();
    const then = new Date(dateString);
    const diffTime = Math.abs(now.getTime() - then.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  // Show loading spinner while checking auth
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-2 sm:p-4">
        <div className="max-w-7xl mx-auto">
          {/* Page Header */}
          <div className="text-center sm:text-left mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Your Tracked Games</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">Manage your game collection and check for updates</p>
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <span className="font-medium">🔍 Smart Cross-Site Tracking:</span> Updates are automatically checked across all sites (GameDrive, SteamRip, SkidRow, FreeGog) regardless of where you originally found the game.
              </p>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3 mb-6">
            <AddCustomGame onGameAdded={loadTrackedGames} />
            <button
              onClick={handleCheckForUpdates}
              disabled={checkingUpdates || trackedGames.length === 0}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-h-[40px] flex items-center justify-center"
            >
              {checkingUpdates ? 'Checking...' : 'Check Updates'}
            </button>
            <SequelNotifications />
          </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Tracked</h3>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{trackedGames.length}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Active Tracking</h3>
            <p className="text-2xl font-bold text-green-600">{trackedGames.filter(g => g.isActive).length}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Recent Updates</h3>
            <p className="text-2xl font-bold text-orange-600">
              {trackedGames.filter(g => 
                g.updateHistory.length > 0 && 
                new Date(g.updateHistory[g.updateHistory.length - 1].dateFound).getTime() > 
                Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
              ).length}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Original Sources</h3>
            <p className="text-2xl font-bold text-purple-600">
              {new Set(trackedGames.map(g => g.source)).size}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Updates checked across all sites
            </p>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Loading tracked games...</p>
          </div>
        )}

        {/* Tracked Games List */}
        {!loading && trackedGames.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400 mb-4">No games are currently being tracked.</p>
            <Link 
              href="/"
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Browse Games to Track
            </Link>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {trackedGames.map((game) => (
              <div key={game._id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
                <div className="flex flex-col sm:flex-row gap-3 p-3 sm:p-6">
                  {/* Game Image - Mobile optimized */}
                  {game.image && (
                    <div className="flex-shrink-0 mx-auto sm:mx-0">
                      <ImageWithFallback
                        src={game.image}
                        alt={game.title}
                        width={96}
                        height={96}
                        className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-lg"
                      />
                    </div>
                  )}
                  
                  {/* Game Details - Mobile optimized */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white truncate">
                          {game.title}
                        </h3>
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 space-y-0.5">
                          <p>Source: {game.source}</p>
                          {game.lastKnownVersion && (
                            <p>Last Version: {game.lastKnownVersion}</p>
                          )}
                          <p><span className="font-medium">Cleaned:</span> {cleanGameTitle(game.title)}</p>
                        </div>
                        
                        {/* Steam Verification */}
                        <div className="mt-2">
                          <SteamVerification
                            gameId={game._id}
                            gameTitle={game.title}
                            steamName={game.steamName}
                            steamVerified={game.steamVerified}
                            onVerificationUpdate={handleVerificationUpdate}
                          />
                        </div>
                      </div>
                      
                      <button
                        onClick={() => handleUntrack(game.gameId)}
                        className="self-start px-4 py-2 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 text-sm rounded-lg hover:bg-red-200 dark:hover:bg-red-800 transition-colors min-h-[40px] flex items-center justify-center"
                      >
                        Untrack
                      </button>
                    </div>

                    {/* Tracking Info - Mobile optimized grid */}
                    <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-xs sm:text-sm">
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Added:</span>
                        <span className="ml-1 sm:ml-2 text-gray-900 dark:text-white">
                          {formatDate(game.dateAdded)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Last Checked:</span>
                        <span className="ml-1 sm:ml-2 text-gray-900 dark:text-white">
                          {getTimeSince(game.lastChecked)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Check Frequency:</span>
                        <span className="ml-1 sm:ml-2 text-gray-900 dark:text-white capitalize">
                          {game.checkFrequency}
                        </span>
                      </div>
                    </div>

                    {/* Update History - Mobile optimized */}
                    {game.updateHistory.length > 0 && (
                      <div className="mt-3 sm:mt-4">
                        <h4 className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Recent Updates ({game.updateHistory.length})
                        </h4>
                        <div className="space-y-1 sm:space-y-2">
                          {game.updateHistory.slice(0, 3).map((update, updateIndex) => (
                            <div key={updateIndex} className="text-xs sm:text-sm bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                                <div className="flex-1">
                                  <span className="font-medium">v{update.version}</span>
                                  <span className="text-gray-500 dark:text-gray-400 ml-2">
                                    found {formatDate(update.dateFound)}
                                  </span>
                                </div>
                                <div className="self-start sm:ml-2">
                                  <DownloadLinks 
                                    gameId={game._id} 
                                    updateIndex={game.updateHistory.length - 1 - updateIndex}
                                    className="inline-block"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Links - Mobile optimized */}
                    <div className="mt-3 sm:mt-4 flex flex-col sm:flex-row gap-2 sm:gap-3">
                      <a
                        href={game.gameLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-sm rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 text-center transition-colors min-h-[40px] flex items-center justify-center w-full sm:w-auto"
                      >
                        View Original Post
                      </a>
                      <div className="w-full sm:w-auto">
                        <DownloadLinks 
                          gameId={game._id} 
                          className="w-full sm:w-auto px-4 py-2 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-sm rounded-lg hover:bg-green-200 dark:hover:bg-green-800 transition-colors min-h-[40px] flex items-center justify-center" 
                        />
                      </div>
                      <button
                        onClick={() => handleUntrack(game.gameId)}
                        className="px-4 py-2 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 text-sm rounded-lg hover:bg-red-200 dark:hover:bg-red-800 transition-colors min-h-[40px] flex items-center justify-center w-full sm:w-auto"
                      >
                        Untrack
                      </button>
                    </div>

                    {/* Pending Updates - Mobile optimized */}
                    {game.pendingUpdates && game.pendingUpdates.length > 0 && (
                      <div className="mt-3 sm:mt-4">
                        <h4 className="text-xs sm:text-sm font-medium text-yellow-700 dark:text-yellow-300 mb-2 flex items-center gap-1 sm:gap-2">
                          <span>⏳</span>
                          Pending Updates ({game.pendingUpdates.length})
                        </h4>
                        <div className="space-y-1 sm:space-y-2">
                          {game.pendingUpdates.slice(0, 3).map((update) => (
                            <div key={update._id} className="text-xs sm:text-sm bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-2">
                                <div className="flex-1">
                                  <span className="font-medium">{update.newTitle}</span>
                                  {update.detectedVersion && (
                                    <span className="text-yellow-600 dark:text-yellow-400 ml-2">
                                      v{update.detectedVersion}
                                    </span>
                                  )}
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    {update.reason} • Found {formatDate(update.dateFound)}
                                  </div>
                                </div>
                                <div className="self-start sm:ml-2">
                                  <DownloadLinks 
                                    gameId={game._id} 
                                    pendingUpdateId={update._id}
                                    className="inline-block"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </>
  );
}