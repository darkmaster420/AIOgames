'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';

interface SequelNotification {
  notificationId: string;
  originalGameId: string;
  originalTitle: string;
  sequel: {
    title: string;
    gameId: string;
    link: string;
    image: string;
    description: string;
    source: string;
    similarity: number;
    sequelType: string;
    dateFound: Date;
    isRead: boolean;
    isConfirmed: boolean;
    downloadLinks: Array<{
      service: string;
      url: string;
      type: string;
    }>;
  };
}

interface SequelPreferences {
  enabled: boolean;
  sensitivity: 'strict' | 'moderate' | 'loose';
  notifyImmediately: boolean;
}

interface SequelNotificationsProps {
  className?: string;
}

export function SequelNotifications({ className = '' }: SequelNotificationsProps) {
  const [notifications, setNotifications] = useState<SequelNotification[]>([]);
  const [preferences, setPreferences] = useState<SequelPreferences>({
    enabled: true,
    sensitivity: 'moderate',
    notifyImmediately: true
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchSequelData = useCallback(async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/sequels');
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Please sign in to view sequel notifications');
        }
        throw new Error('Failed to fetch sequel notifications');
      }
      
      const data = await response.json();
      setNotifications(data.notifications || []);
      setPreferences(data.preferences || { enabled: false, sensitivity: 'moderate', notifyImmediately: true });
      
      // Count unread notifications
      const unread = (data.notifications || []).filter((n: SequelNotification) => !n.sequel.isRead).length;
      setUnreadCount(unread);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sequel data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSequelData();
  }, [fetchSequelData]);

  const updatePreferences = async (newPrefs: Partial<SequelPreferences>) => {
    try {
      const response = await fetch('/api/sequels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...preferences, ...newPrefs }),
      });

      if (!response.ok) {
        throw new Error('Failed to update preferences');
      }

      setPreferences({ ...preferences, ...newPrefs });
    } catch (err) {
      console.error('Error updating preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to update preferences');
    }
  };

  const handleNotificationAction = async (
    gameId: string, 
    notificationId: string, 
    action: 'mark_read' | 'confirm' | 'track_sequel' | 'dismiss'
  ) => {
    try {
      const response = await fetch('/api/sequels', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gameId, notificationId, action }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action.replace('_', ' ')}`);
      }

      // Refresh the data
      await fetchSequelData();
    } catch (err) {
      console.error(`Error performing ${action}:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${action.replace('_', ' ')}`);
    }
  };

  const getSequelTypeIcon = (type: string) => {
    switch (type) {
      case 'numbered_sequel': return '2️⃣';
      case 'named_sequel': return '🆕';
      case 'expansion': return '📦';
      case 'remaster': return '✨';
      case 'definitive': return '👑';
      default: return '🎮';
    }
  };

  const getSequelTypeLabel = (type: string) => {
    switch (type) {
      case 'numbered_sequel': return 'Numbered Sequel';
      case 'named_sequel': return 'Named Sequel';
      case 'expansion': return 'Expansion/DLC';
      case 'remaster': return 'Remaster';
      case 'definitive': return 'Definitive Edition';
      default: return 'Related Game';
    }
  };

  return (
    <div className={`relative inline-block ${className}`}>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-sm rounded hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors flex items-center gap-2"
      >
        <span>🎮</span>
        <span>Sequels</span>
        {unreadCount > 0 && (
          <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount}
          </span>
        )}
        <span className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          ⌄
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          {/* Header */}
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">Sequel Notifications</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {notifications.length} notifications • {unreadCount} unread
            </p>
          </div>

          {/* Settings */}
          <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Enable Sequel Detection
              </label>
              <button
                onClick={() => updatePreferences({ enabled: !preferences.enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  preferences.enabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    preferences.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                Sensitivity
              </label>
              <select
                value={preferences.sensitivity}
                onChange={(e) => updatePreferences({ sensitivity: e.target.value as 'strict' | 'moderate' | 'loose' })}
                className="text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-2 py-1"
                disabled={!preferences.enabled}
              >
                <option value="strict">Strict</option>
                <option value="moderate">Moderate</option>
                <option value="loose">Loose</option>
              </select>
            </div>
          </div>

          {/* Content */}
          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-4">
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Loading...</span>
              </div>
            )}

            {error && (
              <div className="p-3 text-center">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {!loading && !error && notifications.length === 0 && (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">No sequel notifications</p>
              </div>
            )}

            {!loading && notifications.length > 0 && (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {notifications.map((notification) => (
                  <div
                    key={notification.notificationId}
                    className={`p-3 ${!notification.sequel.isRead ? 'bg-purple-50 dark:bg-purple-900/20' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0">
                        {notification.sequel.image ? (
                          <Image
                            src={notification.sequel.image}
                            alt={notification.sequel.title}
                            width={48}
                            height={48}
                            className="w-12 h-12 object-cover rounded"
                            unoptimized
                          />
                        ) : (
                          <div className="w-12 h-12 bg-gray-200 dark:bg-gray-600 rounded flex items-center justify-center">
                            <span className="text-lg">{getSequelTypeIcon(notification.sequel.sequelType)}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {notification.sequel.title}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {getSequelTypeLabel(notification.sequel.sequelType)} of &quot;{notification.originalTitle}&quot;
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              Found {new Date(notification.sequel.dateFound).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        
                        <div className="mt-2 flex gap-1 flex-wrap">
                          {!notification.sequel.isRead && (
                            <button
                              onClick={() => handleNotificationAction(
                                notification.originalGameId,
                                notification.notificationId,
                                'mark_read'
                              )}
                              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-500"
                            >
                              Mark Read
                            </button>
                          )}
                          
                          <button
                            onClick={() => handleNotificationAction(
                              notification.originalGameId,
                              notification.notificationId,
                              'track_sequel'
                            )}
                            className="px-2 py-1 text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-800"
                          >
                            Track
                          </button>
                          
                          <a
                            href={notification.sequel.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                          >
                            View
                          </a>
                          
                          <button
                            onClick={() => handleNotificationAction(
                              notification.originalGameId,
                              notification.notificationId,
                              'dismiss'
                            )}
                            className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}