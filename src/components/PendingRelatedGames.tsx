'use client';

import { useState, useEffect } from 'react';
import { useNotification } from '../contexts/NotificationContext';

type PendingRelatedGame = {
  gameId: string;
  title: string;
  originalTitle: string;
  similarity: number;
  relationshipType: 'potential_sequel' | 'potential_edition' | 'potential_dlc';
  link: string;
  image?: string;
  description?: string;
  source: string;
  version: string;
  detectedDate: Date;
  dismissed: boolean;
};

type PendingRelation = {
  trackedGameId: string;
  trackedGameTitle: string;
  pendingGames: PendingRelatedGame[];
};

export function PendingRelatedGames() {
  const [relations, setRelations] = useState<PendingRelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const notify = useNotification();

  useEffect(() => {
    loadPendingRelations();
  }, []);

  const loadPendingRelations = async () => {
    try {
      const response = await fetch('/api/tracking/related');
      if (response.ok) {
        const data = await response.json();
        setRelations(data.relations || []);
      }
    } catch (error) {
      console.error('Failed to load pending related games:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (
    trackedGameId: string,
    pendingGameId: string,
    action: 'track_same' | 'track_separate' | 'dismiss',
    gameName: string
  ) => {
    setProcessing(pendingGameId);
    try {
      const response = await fetch('/api/tracking/related', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          trackedGameId,
          pendingGameId,
          action
        })
      });

      if (response.ok) {
        if (action === 'track_same') {
          notify?.showSuccess(`Updated tracked game with "${gameName}"`);
        } else if (action === 'track_separate') {
          notify?.showSuccess(`"${gameName}" added as separate game!`);
        } else {
          notify?.showSuccess('Related game dismissed');
        }
        // Reload the list
        await loadPendingRelations();
      } else {
        const error = await response.json();
        notify?.showError(error.error || 'Failed to process action');
      }
    } catch (error) {
      console.error('Error processing related game:', error);
      notify?.showError('Failed to process action');
    } finally {
      setProcessing(null);
    }
  };

  const getRelationshipBadge = (type: string) => {
    switch (type) {
      case 'potential_sequel':
        return <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded">Sequel?</span>;
      case 'potential_edition':
        return <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">Edition?</span>;
      case 'potential_dlc':
        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded">DLC?</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200 rounded">Related?</span>;
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <div className="flex items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading related games...</div>
        </div>
      </div>
    );
  }

  if (relations.length === 0) {
    return null; // Don't show anything if there are no pending relations
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
        🔍 Potential Related Games
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        We found games that might be sequels, DLC, or editions of your tracked games. Use <strong>Track</strong> to update the existing game, <strong>Sequel</strong> to add as a separate game, or <strong>Dismiss</strong> if not related.
      </p>

      <div className="space-y-6">
        {relations.map((relation) => (
          <div key={relation.trackedGameId} className="border-t dark:border-gray-700 pt-4">
            <div className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              Related to: <span className="text-blue-600 dark:text-blue-400">{relation.trackedGameTitle}</span>
            </div>
            
            <div className="space-y-3">
              {relation.pendingGames.map((pending) => (
                <div
                  key={pending.gameId}
                  className="flex items-start justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getRelationshipBadge(pending.relationshipType)}
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {(pending.similarity * 100).toFixed(0)}% match
                      </span>
                    </div>
                    <h3 className="font-medium text-gray-900 dark:text-white mb-1">
                      {pending.originalTitle}
                    </h3>
                    {pending.version && (
                      <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                        Version: {pending.version}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      Source: {pending.source}
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleAction(
                        relation.trackedGameId,
                        pending.gameId,
                        'track_same',
                        pending.title
                      )}
                      disabled={processing === pending.gameId}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-lg transition-colors"
                      title="Update the existing tracked game with this version"
                    >
                      {processing === pending.gameId ? '...' : 'Track'}
                    </button>
                    <button
                      onClick={() => handleAction(
                        relation.trackedGameId,
                        pending.gameId,
                        'track_separate',
                        pending.title
                      )}
                      disabled={processing === pending.gameId}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 rounded-lg transition-colors"
                      title="Add as a separate game"
                    >
                      {processing === pending.gameId ? '...' : 'Sequel'}
                    </button>
                    <button
                      onClick={() => handleAction(
                        relation.trackedGameId,
                        pending.gameId,
                        'dismiss',
                        pending.title
                      )}
                      disabled={processing === pending.gameId}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 disabled:bg-gray-100 dark:disabled:bg-gray-700 rounded-lg transition-colors"
                      title="Dismiss this suggestion"
                    >
                      {processing === pending.gameId ? '...' : 'Dismiss'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
