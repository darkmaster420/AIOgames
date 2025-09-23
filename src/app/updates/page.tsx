'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { Navigation } from '../../components/Navigation';
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
  detectedVersion: string;
  build: string;
  releaseType: string;
  updateType: string;
  newTitle: string;
  newLink: string;
  newImage?: string;
  dateFound: string;
  confidence: number;
  reason: string;
  steamEnhanced?: boolean;
  steamValidated?: boolean;
}

interface GameWithPending {
  _id: string;
  title: string;
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
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">🔴 Major</span>;
    } else if (significance >= 2) {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">🟡 Minor</span>;
    } else {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">🔵 Patch</span>;
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Navigation />
        <div className="max-w-4xl mx-auto py-8 px-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Game Updates</h1>
            <p className="text-gray-600 dark:text-gray-400">Please sign in to view your game updates.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navigation />
      <div className="max-w-6xl mx-auto py-8 px-4">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Game Updates</h1>
            <p className="text-gray-600 dark:text-gray-400">Track version changes and new releases for your games</p>
          </div>
          <button
            onClick={checkForUpdates}
            disabled={checkingUpdates}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checkingUpdates ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Checking...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Check for Updates
              </>
            )}
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('recent')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'recent'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400'
              }`}
            >
              Recent Updates ({recentUpdates.length})
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'pending'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400'
              }`}
            >
              Pending Confirmation ({pendingUpdates.reduce((acc, game) => acc + game.pendingUpdates.length, 0)})
            </button>
          </nav>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 dark:text-gray-400 mt-4">Loading updates...</p>
          </div>
        ) : (
          <div>
            {activeTab === 'recent' && (
              <div className="space-y-6">
                {recentUpdates.length === 0 ? (
                  <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Recent Updates</h3>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Your tracked games haven&apos;t been updated recently.</h3>
                  </div>
                ) : (
                  recentUpdates.map((game) => (
                    <div key={game._id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                      <div className="flex items-start space-x-4">
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
                              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">{game.title}</h3>
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
                  <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Pending Updates</h3>
                    <p className="text-gray-600 dark:text-gray-400">All detected updates have been processed.</p>
                  </div>
                ) : (
                  pendingUpdates.map((game) => (
                    <div key={game._id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                      <div className="flex items-start space-x-4 mb-4">
                        {game.image && (
                          <Image 
                            src={game.image} 
                            alt={game.title}
                            width={64}
                            height={64}
                            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                          />
                        )}
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{game.title}</h3>
                          <p className="text-sm text-orange-600 dark:text-orange-400 mb-4">
                            ⚠️ The following updates need your confirmation:
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {game.pendingUpdates.map((update, idx) => (
                          <div key={idx} className="border border-orange-200 dark:border-orange-800 rounded-lg p-4 bg-orange-50 dark:bg-orange-900/20">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <div className="flex items-center space-x-2 mb-1">
                                  <span className="font-medium text-gray-900 dark:text-white">{update.newTitle}</span>
                                  {update.steamEnhanced && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                      Steam Enhanced
                                    </span>
                                  )}
                                  {update.steamValidated && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                      Steam Validated
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                                  {update.detectedVersion && (
                                    <span>Version: {update.detectedVersion}</span>
                                  )}
                                  {update.build && (
                                    <span>Build: {update.build}</span>
                                  )}
                                  {update.updateType && (
                                    <span>Type: {update.updateType}</span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  Confidence: {Math.round(update.confidence * 100)}% • {update.reason}
                                </div>
                              </div>
                              <span className="text-sm text-gray-500 dark:text-gray-400">
                                {formatDate(update.dateFound)}
                              </span>
                            </div>
                            
                            <div className="flex items-center justify-between">
                              <a 
                                href={update.newLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
                              >
                                View Update →
                              </a>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => rejectUpdate(game._id, idx)}
                                  className="px-3 py-1 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800 rounded-md"
                                >
                                  Reject
                                </button>
                                <button
                                  onClick={() => approveUpdate(game._id, idx)}
                                  className="px-3 py-1 text-sm font-medium text-green-700 bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800 rounded-md"
                                >
                                  Approve
                                </button>
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