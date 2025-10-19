'use client';

import { useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';

interface NotificationToggleProps {
  gameId: string;
  currentEnabled: boolean;
  onToggleChanged?: () => void;
}

export function NotificationToggle({ gameId, currentEnabled, onToggleChanged }: NotificationToggleProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [enabled, setEnabled] = useState(currentEnabled);
  const { showSuccess, showError } = useNotification();

  const handleToggle = async () => {
    if (isUpdating) return;

    const newState = !enabled;
    setIsUpdating(true);

    try {
      const response = await fetch('/api/tracking/notifications', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          enabled: newState
        }),
      });

      if (response.ok) {
        setEnabled(newState);
        showSuccess(
          'Notifications Updated', 
          newState ? 'You will receive notifications for this game' : 'Notifications disabled for this game'
        );
        onToggleChanged?.();
      } else {
        const error = await response.json();
        showError('Update Failed', error.error || 'Failed to update notification settings');
      }
    } catch (error) {
      console.error('Notification toggle error:', error);
      showError('Network Error', 'Unable to update notification settings. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">Notifications:</span>
      <button
        onClick={handleToggle}
        disabled={isUpdating}
        className={`
          relative inline-flex items-center h-6 w-11 rounded-full transition-all duration-200
          ${enabled 
            ? 'bg-green-500 dark:bg-green-600' 
            : 'bg-gray-300 dark:bg-gray-600'
          }
          ${isUpdating 
            ? 'opacity-50 cursor-not-allowed' 
            : 'cursor-pointer hover:shadow-md active:scale-95'
          }
        `}
        title={enabled ? 'Notifications enabled - Click to disable' : 'Notifications disabled - Click to enable'}
        aria-label={`Toggle notifications ${enabled ? 'off' : 'on'}`}
      >
        {isUpdating ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <span
            className={`
              inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform duration-200
              ${enabled ? 'translate-x-6' : 'translate-x-1'}
            `}
          />
        )}
      </button>
      <span className={`text-xs font-medium ${enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
        {enabled ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}
