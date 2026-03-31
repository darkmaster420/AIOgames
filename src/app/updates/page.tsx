'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { SchedulerStatus } from '../../components/SchedulerStatus';
import { useNotification } from '../../contexts/NotificationContext';

interface UpdateHistoryItem {
  _id: string;
  version: string;
  build?: string;
  releaseType?: string;
  updateType?: string;
  changeType: string;
  significance: number;
  dateFound: string;
  gameLink: string;
  previousVersion: string;
  downloadLinks?: Array<{
    service: string;
    url: string;
    type: string;
  }>;
  steamEnhanced?: boolean;
  steamAppId?: string;
}

interface GameWithUpdates {
  _id: string;
  title: string;
  originalTitle: string;
  steamName?: string;
  steamVerified?: boolean;
  image?: string;
  source: string;
  currentVersion: string;
  lastVersionDate: string;
  updateHistory: UpdateHistoryItem[];
  totalUpdates: number;
}

export default function UpdatesPage() {
  const { data: session } = useSession();
  const { showSuccess, showError } = useNotification();
  const [recentUpdates, setRecentUpdates] = useState<GameWithUpdates[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  useEffect(() => {
    if (session?.user) {
      fetchUpdates();
    }
  }, [session]);

  const fetchUpdates = async () => {
    try {
      setLoading(true);
      
      // Fetch recent updates
      const recentResponse = await fetch('/api/updates/recent');
      if (recentResponse.ok) {
        const recentData = await recentResponse.json();
        setRecentUpdates(recentData.games || []);
      }

    } catch (error) {
      console.error('Failed to fetch updates:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkForUpdates = async () => {
    try {
      setCheckingUpdates(true);
      const response = await fetch('/api/updates/check', {
        method: 'POST'
      });
      
      if (response.ok) {
        const result = await response.json();
        showSuccess('Update Check Complete', `📊 Checked: ${result.checked} games\n🆕 Updates found: ${result.updatesFound}\n🎮 Sequels found: ${result.sequelsFound}`);
        fetchUpdates(); // Refresh the data
      }
    } catch (error) {
      console.error('Failed to check updates:', error);
      showError('Update Check Failed', 'Failed to check for updates. Please try again.');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getSignificanceBadge = (significance: number) => {
    if (significance >= 3) {
      return <span className="status-badge bg-red-100/80 text-red-800 border border-red-200/50 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700/50">🔴 Major</span>;
    } else if (significance >= 2) {
      return <span className="status-badge bg-warning-100/80 text-warning-800 border border-warning-200/50 dark:bg-warning-900/30 dark:text-warning-300 dark:border-warning-700/50">🟡 Minor</span>;
    } else {
      return <span className="status-badge bg-primary-100/80 text-primary-800 border border-primary-200/50 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-700/50">🔵 Patch</span>;
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getDisplayChangeType = (changeType: string | undefined, significance: number) => {
    const normalized = String(changeType || '').trim().toLowerCase();

    if (!normalized || normalized === 'unknown') {
      if (significance >= 3) return 'major';
      if (significance >= 2) return 'minor';
      return 'patch';
    }

    return normalized.replace(/_/g, ' ');
  };

  if (!session) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto py-8 px-4">
          <div className="text-center">
            <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 max-w-md mx-auto">
              <div className="text-6xl mb-4">🔒</div>
              <h1 className="text-2xl font-bold text-gradient mb-4">Game Updates</h1>
              <p className="text-slate-600 dark:text-slate-400">Please sign in to view your game updates.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Automatic Update Scheduler Status */}
      <div className="max-w-6xl mx-auto py-8 px-4">
        <div className="mb-6 space-y-4">
          <SchedulerStatus />
        </div>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient mb-2">🔄 Game Updates</h1>
            <p className="text-slate-600 dark:text-slate-400">Track version changes and new releases for your games</p>
            <div className="w-24 h-1 bg-gradient-to-r from-primary-500 to-accent-500 mt-3 rounded-full"></div>
          </div>
          <button
            onClick={checkForUpdates}
            disabled={checkingUpdates}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {checkingUpdates ? (
              <span className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
                Checking...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                🔄 <span>Check for Updates</span>
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 max-w-sm mx-auto">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 mb-4"></div>
              <p className="text-slate-600 dark:text-slate-400 font-medium">Loading updates...</p>
            </div>
          </div>
        ) : (
          <div>
            <div className="space-y-6">
                {recentUpdates.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 max-w-md mx-auto">
                      <div className="text-6xl mb-4">📈</div>
                      <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">No Recent Updates</h3>
                      <p className="text-slate-500 dark:text-slate-400">Your tracked games haven&apos;t been updated recently.</p>
                    </div>
                  </div>
                ) : (
                  recentUpdates.map((game) => (
                    <div key={game._id} className="game-card animate-fade-in">
                      <div className="flex flex-col sm:flex-row sm:items-start space-y-4 sm:space-y-0 sm:space-x-4 p-6">
                        {game.image && (
                          <Image 
                            src={game.image} 
                            alt={game.title}
                            width={64}
                            height={64}
                            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                                {(game.steamVerified && game.steamName) ? game.steamName : (game.originalTitle || game.title)}
                              </h3>
                              <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                                <span>Source: {game.source}</span>
                                <span>•</span>
                                <span>Current: {game.currentVersion}</span>
                                <span>•</span>
                                <span>{game.totalUpdates} updates total</span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="space-y-3">
                            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Recent Update History:</h4>
                            {game.updateHistory.slice(0, 3).map((update, idx) => (
                              <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                                <div className="flex items-center space-x-3">
                                  {getSignificanceBadge(update.significance)}
                                  <div>
                                    <div className="flex items-center space-x-2">
                                      <span className="font-medium text-gray-900 dark:text-white">{update.version}</span>
                                      {update.steamEnhanced && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                          Steam
                                        </span>
                                      )}
                                      {update.updateType && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">({update.updateType})</span>
                                      )}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      {update.previousVersion} → {update.version}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-3">
                                  <span className="text-sm text-gray-500 dark:text-gray-400">
                                    {formatDate(update.dateFound)}
                                  </span>
                                  <a 
                                    href={update.gameLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                                  >
                                    Download
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}