'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { SchedulerStatus } from '../../components/SchedulerStatus';
import { AIDetectionStatus } from '../../components/AIDetectionStatus';
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
  image?: string;
  source: string;
  currentVersion: string;
  lastVersionDate: string;
  updateHistory: UpdateHistoryItem[];
  totalUpdates: number;
}

interface PendingUpdate {
  _id: string;
  version: string; // Full title with version (e.g., "TEKKEN 8 v2.06.01-P2P")
  detectedVersion: string; // Clean version number
  build: string;
  releaseType: string;
  updateType: string;
  changeType: string;
  significance: number;
  newTitle: string;
  newLink: string;
  gameLink: string;
  previousVersion: string;
  newImage?: string;
  dateFound: string;
  confidence: number;
  reason: string;
  aiDetectionConfidence?: number;
  aiDetectionReason?: string;
  detectionMethod?: string;
  steamEnhanced?: boolean;
  steamValidated?: boolean;
  downloadLinks?: Array<{
    service: string;
    url: string;
    type: string;
  }>;
}

interface GameWithPending {
  _id: string;
  title: string;
  originalTitle: string;
  lastKnownVersion: string;
  currentVersionNumber: string;
  currentBuildNumber: string;
  image?: string;
  pendingUpdates: PendingUpdate[];
}

export default function UpdatesPage() {
  const { data: session } = useSession();
  const { showSuccess, showError } = useNotification();
  const [recentUpdates, setRecentUpdates] = useState<GameWithUpdates[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<GameWithPending[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'recent' | 'pending'>('recent');
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

      // Fetch pending updates
      const pendingResponse = await fetch('/api/updates/pending');
      if (pendingResponse.ok) {
        const pendingData = await pendingResponse.json();
        setPendingUpdates(pendingData.games || []);
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

  const approveUpdate = async (gameId: string, updateIndex: number) => {
    try {
      const response = await fetch('/api/updates/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, updateIndex })
      });

      if (response.ok) {
        fetchUpdates(); // Refresh data
        showSuccess('Update Approved', 'Update approved and applied!');
      }
    } catch (error) {
      console.error('Failed to approve update:', error);
      showError('Approval Failed', 'Failed to approve update');
    }
  };

  const rejectUpdate = async (gameId: string, updateIndex: number) => {
    try {
      const response = await fetch('/api/updates/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, updateIndex })
      });

      if (response.ok) {
        fetchUpdates(); // Refresh data
        showSuccess('Update Rejected', 'Update rejected');
      }
    } catch (error) {
      console.error('Failed to reject update:', error);
      showError('Rejection Failed', 'Failed to reject update');
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
          <AIDetectionStatus />
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

        {/* Enhanced Tabs */}
        <div className="border-b border-white/20 dark:border-white/10 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('recent')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-all duration-200 ${
                activeTab === 'recent'
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
              }`}
            >
              <span className="flex items-center gap-2">
                📈 <span>Recent Updates ({recentUpdates.length})</span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-all duration-200 ${
                activeTab === 'pending'
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
              }`}
            >
              <span className="flex items-center gap-2">
                ⏳ <span>Pending Confirmation ({pendingUpdates.reduce((acc, game) => acc + game.pendingUpdates.length, 0)})</span>
              </span>
            </button>
          </nav>
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
            {activeTab === 'recent' && (
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
                              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">{game.originalTitle || game.title}</h3>
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
            )}

            {activeTab === 'pending' && (
              <div className="space-y-6">
                {pendingUpdates.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 max-w-md mx-auto">
                      <div className="text-6xl mb-4">✅</div>
                      <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">No Pending Updates</h3>
                      <p className="text-slate-500 dark:text-slate-400">All detected updates have been processed.</p>
                    </div>
                  </div>
                ) : (
                  pendingUpdates.map((game) => (
                    <div key={game._id} className="game-card animate-fade-in">
                      <div className="flex flex-col sm:flex-row sm:items-start space-y-4 sm:space-y-0 sm:space-x-4 p-6 border-b border-gray-200 dark:border-gray-700">
                        {game.image && (
                          <Image 
                            src={game.image} 
                            alt={game.title}
                            width={80}
                            height={80}
                            className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">{game.title}</h3>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                            {game.originalTitle && (
                              <>
                                <span className="font-medium">Current:</span>
                                <span className="text-gray-900 dark:text-white">{game.originalTitle}</span>
                              </>
                            )}
                            {game.lastKnownVersion && (
                              <>
                                <span>•</span>
                                <span>Version: {game.lastKnownVersion}</span>
                              </>
                            )}
                          </div>
                          <p className="text-sm text-warning-600 dark:text-warning-400 flex items-center gap-2">
                            ⚠️ <span>{game.pendingUpdates.length} update{game.pendingUpdates.length > 1 ? 's' : ''} awaiting confirmation</span>
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3 p-6">
                        {game.pendingUpdates.map((update, idx) => (
                          <div key={idx} className="card-gradient backdrop-blur-sm border border-warning-300/30 dark:border-warning-600/30 rounded-xl p-4">
                            <div className="flex flex-col space-y-3">
                              {/* Title and Badges */}
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center flex-wrap gap-2 mb-2">
                                    <span className="text-lg font-semibold text-gray-900 dark:text-white">
                                      {update.version || update.newTitle}
                                    </span>
                                    {update.steamEnhanced && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                        🎮 Steam Enhanced
                                      </span>
                                    )}
                                    {update.steamValidated && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                        ✓ Steam Validated
                                      </span>
                                    )}
                                    {getSignificanceBadge(update.significance || 0)}
                                  </div>
                                  
                                  {/* Version Information */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-2">
                                    {update.detectedVersion && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-500 dark:text-gray-400">Version:</span>
                                        <span className="font-medium text-gray-900 dark:text-white">{update.detectedVersion}</span>
                                      </div>
                                    )}
                                    {update.build && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-500 dark:text-gray-400">Build:</span>
                                        <span className="font-medium text-gray-900 dark:text-white">{update.build}</span>
                                      </div>
                                    )}
                                    {update.updateType && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-500 dark:text-gray-400">Type:</span>
                                        <span className="font-medium text-gray-900 dark:text-white">{update.updateType}</span>
                                      </div>
                                    )}
                                    {update.releaseType && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-500 dark:text-gray-400">Release:</span>
                                        <span className="font-medium text-gray-900 dark:text-white">{update.releaseType}</span>
                                      </div>
                                    )}
                                    {update.changeType && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-500 dark:text-gray-400">Change:</span>
                                        <span className="font-medium text-gray-900 dark:text-white">{update.changeType}</span>
                                      </div>
                                    )}
                                    {update.previousVersion && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-500 dark:text-gray-400">Previous:</span>
                                        <span className="font-medium text-gray-700 dark:text-gray-300">{update.previousVersion}</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* AI Detection Info */}
                                  {update.aiDetectionConfidence && update.aiDetectionConfidence > 0 && (
                                    <div className="flex items-center gap-2 text-xs mb-2">
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                                        🤖 AI: {Math.round(update.aiDetectionConfidence * 100)}%
                                      </span>
                                      {update.aiDetectionReason && (
                                        <span className="text-gray-600 dark:text-gray-400">{update.aiDetectionReason}</span>
                                      )}
                                    </div>
                                  )}

                                  {/* Detection Info */}
                                  <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                    <span>Confidence: {Math.round(update.confidence * 100)}%</span>
                                    <span>•</span>
                                    <span>{update.reason}</span>
                                    <span>•</span>
                                    <span>{new Date(update.dateFound).toLocaleDateString()}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Download Links */}
                              {update.downloadLinks && update.downloadLinks.length > 0 && (
                                <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Download Links:</p>
                                  <div className="flex flex-wrap gap-2">
                                    {update.downloadLinks.slice(0, 5).map((link, linkIdx) => (
                                      <a
                                        key={linkIdx}
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                                      >
                                        {link.service}
                                      </a>
                                    ))}
                                    {update.downloadLinks.length > 5 && (
                                      <span className="inline-flex items-center px-2 py-1 text-xs text-gray-600 dark:text-gray-400">
                                        +{update.downloadLinks.length - 5} more
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Action Buttons */}
                              <div className="flex items-center gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <button
                                  onClick={() => approveUpdate(game._id, idx)}
                                  className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                                >
                                  ✓ Approve
                                </button>
                                <button
                                  onClick={() => rejectUpdate(game._id, idx)}
                                  className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
                                >
                                  ✗ Reject
                                </button>
                                <a
                                  href={update.gameLink || update.newLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center px-4 py-2 border border-blue-300 dark:border-blue-600 text-sm font-medium rounded-lg text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                                >
                                  🔗 View
                                </a>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}