'use client';

import { useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';

interface FrequencySelectorProps {
  gameId: string;
  currentFrequency: string;
  onFrequencyChanged?: () => void;
}

const frequencyOptions = [
  { value: 'hourly', label: '⏰ Hourly', description: 'Check every hour (recommended)' },
  { value: 'daily', label: '📅 Daily', description: 'Check once per day' },
  { value: 'weekly', label: '📆 Weekly', description: 'Check once per week' },
  { value: 'manual', label: '🔧 Manual', description: 'No automatic checking' }
];

export function FrequencySelector({ gameId, currentFrequency, onFrequencyChanged }: FrequencySelectorProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedFrequency, setSelectedFrequency] = useState(currentFrequency);
  const { showSuccess, showError } = useNotification();

  const handleFrequencyChange = async (newFrequency: string) => {
    if (newFrequency === selectedFrequency || isUpdating) return;

    setIsUpdating(true);
    try {
      const response = await fetch('/api/tracking/frequency', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          frequency: newFrequency
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setSelectedFrequency(newFrequency);
        showSuccess('Frequency Updated', result.message);
        onFrequencyChanged?.();
      } else {
        const error = await response.json();
        showError('Update Failed', error.error || 'Failed to update frequency');
      }
    } catch (error) {
      console.error('Frequency update error:', error);
      showError('Network Error', 'Unable to update frequency. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Update Frequency
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {frequencyOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => handleFrequencyChange(option.value)}
            disabled={isUpdating}
            className={`
              relative p-3 rounded-lg border text-left transition-all duration-200 text-sm
              ${selectedFrequency === option.value
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-primary-300 dark:hover:border-primary-600'
              }
              ${isUpdating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-sm'}
            `}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="font-medium">{option.label}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {option.description}
                </div>
              </div>
              {selectedFrequency === option.value && (
                <div className="ml-2 text-primary-500">
                  ✓
                </div>
              )}
            </div>
            {isUpdating && selectedFrequency === option.value && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-800/50 rounded-lg">
                <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </button>
        ))}
      </div>
      
      {selectedFrequency === 'manual' && (
        <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
          ⚠️ Manual mode disables automatic updates. You&apos;ll need to check manually.
        </div>
      )}
      
      {selectedFrequency === 'hourly' && (
        <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-xs text-green-700 dark:text-green-300">
          ⚡ Hourly checking provides the fastest update notifications.
        </div>
      )}
    </div>
  );
}