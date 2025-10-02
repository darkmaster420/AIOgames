"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { GameDownloadLinks } from '../../components/GameDownloadLinks';
import { SteamVerification } from '../../components/SteamVerification';
import { SmartVersionVerification } from '../../components/SmartVersionVerification';
import { ReleaseGroupSelector } from '../../components/ReleaseGroupSelector';
import { SequelNotifications } from '../../components/SequelNotifications';
import { AddCustomGame } from '../../components/AddCustomGame';
import { useConfirm } from '../../contexts/ConfirmContext';
import { ImageWithFallback } from '../../utils/imageProxy';
import { cleanGameTitle } from '../../utils/steamApi';
import { useNotification } from '../../contexts/NotificationContext';



// Utility to format version/build badge
function formatVersionBadge(version: string): string {
  if (!version) return '';
  // Only extract the build/version number, not the full string
  // Build number
  const buildMatch = version.match(/Build\s*(\d+)/i);
  if (buildMatch) {
    return `Build ${buildMatch[1]}`;
  }
  // v1.2.3, v20106408, etc.
  const vMatch = version.match(/v?(\d+(?:\.\d+)+)/i);
  if (vMatch) {
    return `v${vMatch[1]}`;
  }
  // Just a long number (6+ digits)
  const numMatch = version.match(/(\d{6,})/);
  if (numMatch) {
    return `v${numMatch[1]}`;
  }
  // If the string contains 'Build' and a number, extract just that
  const buildOnly = version.match(/(Build\s*\d+)/i);
  if (buildOnly) {
    return buildOnly[1];
  }
  // Fallback: extract the last number in the string
  const lastNum = version.match(/(\d+)/g);
  if (lastNum && lastNum.length > 0) {
    return lastNum[lastNum.length - 1];
  }
  // Fallback to a trimmed version
  return version.length > 16 ? version.slice(0, 16) + '…' : version;
}

interface TrackedGame {
  _id: string;
  gameId: string;
  title: string;
  originalTitle: string;
  source: string;
  image?: string;
  description: string;
  gameLink: string;
  lastKnownVersion: string;
  steamAppId?: number;
  steamName?: string;
  steamVerified?: boolean;
  buildNumberVerified?: boolean;
  currentBuildNumber?: string;
  buildNumberSource?: string;
  versionNumberVerified?: boolean;
  currentVersionNumber?: string;
  versionNumberSource?: string;
  lastVersionDate?: string;
  dateAdded: string;
  lastChecked: string;
  notificationsEnabled: boolean;
  checkFrequency: string;
  hasNewUpdate?: boolean;
  newUpdateSeen?: boolean;
  updateHistory: Array<{
    version: string;
    dateFound: string;
    gameLink: string;
    isLatest?: boolean;
    downloadLinks?: Array<{
      service: string;
      url: string;
      type: string;
    }>;
  }>;
  latestApprovedUpdate?: {
    version: string;
    dateFound: string;
    gameLink: string;
    downloadLinks?: Array<{
      service: string;
      url: string;
      type: string;
    }>;
  };
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
  const { confirm } = useConfirm();
  const [trackedGames, setTrackedGames] = useState<TrackedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkingSingleGame, setCheckingSingleGame] = useState<string | null>(null);

  // Handle Steam verification updates
  const handleVerificationUpdate = (gameId: string, verified: boolean, steamAppId?: number, steamName?: string) => {
    setTrackedGames(prev => prev.map(game => 
      game._id === gameId 
        ? { ...game, steamVerified: verified, steamAppId, steamName }


        : game
    ));
  };

  // Handle marking update as seen
  const handleMarkUpdateSeen = async (gameId: string) => {
    try {
      const response = await fetch('/api/games/mark-seen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gameId }),
      });

      if (response.ok) {
        // Update the local state
        setTrackedGames(prev => prev.map(game => 
          game._id === gameId 
            ? { ...game, hasNewUpdate: false, newUpdateSeen: true }
            : game
        ));
        showSuccess('Update marked as seen');
      } else {
        const error = await response.json();
        showError(error.error || 'Failed to mark update as seen');
      }
    } catch {
      showError('Failed to mark update as seen');
    }
  };

  // Handle single game update check
  const handleSingleGameUpdate = async (gameId: string, gameTitle: string) => {
    try {
      setCheckingSingleGame(gameId);
      const response = await fetch('/api/updates/check-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.updatesFound > 0 || result.sequelsFound > 0) {
          showSuccess(
            'Update Check Complete', 
            `🎮 ${gameTitle}\n📊 Updates found: ${result.updatesFound}\n🎬 Sequels found: ${result.sequelsFound}`
          );
        } else {
          showInfo('No Updates Found', `No new updates found for "${gameTitle}"`);
        }
        // Refresh the game data to show updated lastChecked time
        loadTrackedGames();
      }
    } catch (error) {
      console.error('Failed to check single game updates:', error);
      showError('Update Check Failed', `Failed to check updates for "${gameTitle}". Please try again.`);
    } finally {
      setCheckingSingleGame(null);
    }
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
      const gameTitle = trackedGames.find(g => g.gameId === gameId)?.title || 'Game';
      
      const confirmed = await confirm(
        'Remove Game from Tracking',
        `Are you sure you want to stop tracking "${gameTitle}"? This action cannot be undone.`,
        { confirmText: 'Remove', cancelText: 'Close', type: 'danger' }
      );

      if (!confirmed) return;

      const response = await fetch(`/api/tracking?gameId=${gameId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setTrackedGames(prev => prev.filter(game => game.gameId !== gameId));
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
      <div className="min-h-screen bg-hero flex items-center justify-center">
        <div className="text-center card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400 font-medium">Loading your games...</p>
        </div>
      </div>
    );
  }

    return (
    <>
      <div className="min-h-screen p-2 sm:p-4">
        <div className="max-w-7xl mx-auto">
          {/* Page Header with enhanced styling */}
          <div className="text-center sm:text-left mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient mb-2">🎮 Your Tracked Games</h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">Manage your game collection and check for updates</p>
            <div className="w-24 h-1 bg-gradient-to-r from-primary-500 to-accent-500 mx-auto sm:mx-0 mt-3 rounded-full"></div>
          </div>
          
          {/* Enhanced Action Buttons */}
          <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3 mb-6">
            <AddCustomGame onGameAdded={loadTrackedGames} />
            <button
              onClick={handleCheckForUpdates}
              disabled={checkingUpdates || trackedGames.length === 0}
              className="px-6 py-3 btn-success disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-medium shadow-lg"
            >
              {checkingUpdates ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Checking...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  🔄 <span>Check Updates</span>
                </span>
              )}
            </button>
            <SequelNotifications />
          </div>

        {/* Enhanced Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 p-6 rounded-xl shadow-lg">
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">📊 Total Tracked</h3>
            <p className="text-3xl font-bold text-gradient">{trackedGames.length}</p>
          </div>
          <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 p-6 rounded-xl shadow-lg">
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">✅ Active Tracking</h3>
            <p className="text-3xl font-bold text-success-600 dark:text-success-400">{trackedGames.filter(g => g.isActive).length}</p>
          </div>
          <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 p-6 rounded-xl shadow-lg">
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">🆕 Recent Updates</h3>
            <p className="text-3xl font-bold text-warning-600 dark:text-warning-400">
              {trackedGames.filter(g => 
                g.updateHistory.length > 0 && 
                new Date(g.updateHistory[g.updateHistory.length - 1].dateFound).getTime() > 
                Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
              ).length}
            </p>
          </div>
          <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 p-6 rounded-xl shadow-lg">
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">🌐 Original Sources</h3>
            <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
              {new Set(trackedGames.map(g => g.source)).size}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Updates checked across all sites
            </p>
          </div>
        </div>

        {/* Enhanced Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-300/30 dark:border-red-600/30 text-red-700 dark:text-red-300 rounded-xl backdrop-blur-sm animate-slide-up">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              {error}
            </div>
          </div>
        )}

        {/* Enhanced Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 max-w-sm mx-auto">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 mb-4"></div>
              <p className="text-slate-600 dark:text-slate-400 font-medium">Loading tracked games...</p>
            </div>
          </div>
        )}

        {/* Enhanced Empty State */}
        {!loading && trackedGames.length === 0 ? (
          <div className="text-center py-16">
            <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 max-w-md mx-auto">
              <div className="text-6xl mb-4">🎮</div>
              <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">No games tracked yet</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Start tracking your favorite games to get updates</p>
              <Link 
                href="/"
                className="btn-primary inline-flex items-center gap-2 px-6 py-3"
              >
                <span>🔍</span>
                <span>Browse Games to Track</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {trackedGames.map((game) => (
              <div key={game._id} className="game-card animate-fade-in">
                <div className="flex flex-col sm:flex-row gap-4 p-4 sm:p-6">
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
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white truncate">
                              {cleanGameTitle(game.title)}
                            </h3>
                            {game.hasNewUpdate && !game.newUpdateSeen && (
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-1 bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs font-bold rounded-full animate-pulse shadow-lg">
                                  ✨ NEW
                                </span>
                                <button
                                  onClick={() => handleMarkUpdateSeen(game._id)}
                                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 underline transition-colors"
                                  title="Mark as seen"
                                >
                                  dismiss
                                </button>
                              </div>
                            )}
                          </div>
                          {game.lastKnownVersion && (
                            <div className="inline-flex items-center gap-1.5">
                              <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 text-xs rounded-full">
                                {formatVersionBadge(game.lastKnownVersion)}
                              </span>
                            </div>
                          )}
                          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                            <p>Original: {game.originalTitle}</p>
                          </div>
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
                        
                        {/* Smart Version & Build Number Verification */}
                        <div className="mt-2">
                          <SmartVersionVerification
                            gameId={game.gameId}
                            gameTitle={game.title}
                            originalTitle={game.originalTitle || game.title}
                            steamAppId={game.steamAppId}
                            currentBuildNumber={game.currentBuildNumber}
                            buildNumberVerified={game.buildNumberVerified || false}
                            currentVersionNumber={game.currentVersionNumber}
                            versionNumberVerified={game.versionNumberVerified || false}
                            onVerified={loadTrackedGames}
                          />
                        </div>

                        {/* Release Group Selector */}
                        <div className="mt-2">
                          <ReleaseGroupSelector
                            gameId={game._id}
                            onReleaseGroupChange={() => {
                              // You can add logic here to handle release group changes
                            }}
                          />
                        </div>
                      </div>
                      
                      {/* Enhanced Action Buttons */}
                      <div className="self-start flex flex-col gap-2">
                        <button
                          onClick={() => handleSingleGameUpdate(game._id, game.title)}
                          disabled={checkingSingleGame === game._id}
                          className="px-4 py-2 bg-gradient-to-r from-primary-500/20 to-accent-500/20 text-primary-700 dark:text-primary-300 hover:from-primary-500/30 hover:to-accent-500/30 text-sm rounded-lg transition-all duration-200 min-h-[42px] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm border border-primary-300/30 hover:scale-105"
                        >
                          {checkingSingleGame === game._id ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-300/30 border-t-primary-600 mr-2"></div>
                              Checking...
                            </>
                          ) : (
                            <span className="flex items-center gap-2">
                              🔄 <span>Check Updates</span>
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => handleUntrack(game.gameId)}
                          className="px-4 py-2 bg-gradient-to-r from-red-500/20 to-pink-500/20 text-red-700 dark:text-red-300 hover:from-red-500/30 hover:to-pink-500/30 text-sm rounded-lg transition-all duration-200 min-h-[42px] flex items-center justify-center backdrop-blur-sm border border-red-300/30 hover:scale-105"
                        >
                          <span className="flex items-center gap-2">
                            🗑️ <span>Untrack</span>
                          </span>
                        </button>
                      </div>
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

                    {/* Latest Update Status - Mobile optimized */}
                    {game.latestApprovedUpdate && (
                      <div className="mt-3 sm:mt-4">
                        <h4 className="text-xs sm:text-sm font-medium text-green-700 dark:text-green-300 mb-2 flex items-center gap-2">
                          <span>✅</span>
                          Current Version
                        </h4>
                        <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div className="flex-1">
                              <span className="font-medium text-sm">v{game.latestApprovedUpdate.version}</span>
                              <span className="text-gray-500 dark:text-gray-400 text-xs ml-2">
                                approved {formatDate(game.latestApprovedUpdate.dateFound)}
                              </span>
                            </div>
                            <div className="self-start">
                              <GameDownloadLinks 
                                gameId={game._id} 
                                className="inline-block"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Previous Updates - Mobile optimized */}
                    {game.updateHistory && game.updateHistory.length > 1 && (
                      (() => {
                        // Exclude the latest/current version from previous updates
                        const latestVersion = game.latestApprovedUpdate?.version || (game.updateHistory[0]?.version);
                        const previousUpdates = game.updateHistory.filter(update => update.version !== latestVersion);
                        if (previousUpdates.length === 0) return null;
                        return (
                          <div className="mt-3 sm:mt-4">
                            <h4 className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Previous Updates ({previousUpdates.length})
                            </h4>
                            <div className="space-y-1 sm:space-y-2">
                              {previousUpdates.slice(0, 2).map((update, updateIndex) => (
                                <div key={updateIndex} className="text-xs sm:text-sm bg-gray-50 dark:bg-gray-900/20 p-2 rounded">
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                                    <div className="flex-1">
                                      <span className="font-medium">v{update.version}</span>
                                      <span className="text-gray-500 dark:text-gray-400 ml-2">
                                        found {formatDate(update.dateFound)}
                                      </span>
                                    </div>
                                    <div className="self-start sm:ml-2">
                                      <GameDownloadLinks 
                                        gameId={game._id} 
                                        updateIndex={updateIndex + 1}
                                        className="inline-block"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()
                    )}

                    {/* Enhanced Action Links */}
                    <div className="mt-3 sm:mt-4 flex flex-col sm:flex-row gap-2 sm:gap-3">
                      <a
                        href={game.gameLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 btn-glass text-sm transition-all text-center min-h-[42px] flex items-center justify-center w-full sm:w-auto group"
                      >
                        <span className="flex items-center gap-2">
                          📖 <span>View Latest Post</span>
                          <span className="transform transition-transform group-hover:translate-x-1">→</span>
                        </span>
                      </a>
                      <div className="w-full sm:w-auto">
                        <GameDownloadLinks 
                          gameId={game._id} 
                          className="w-full" 
                        />
                      </div>
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
                                  <GameDownloadLinks 
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