'use client';

import { useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';

interface FrequencySelectorProps {
  gameId: string;
  currentFrequency: string;
  onFrequencyChanged?: () => void;
}

const frequencyOptions = [
  { value: 'hourly', label: '1hr', icon: '⚡', description: 'Every hour' },
  { value: 'daily', label: '1d', icon: '📅', description: 'Every day' },
  { value: 'weekly', label: '1w', icon: '📆', description: 'Every week' },
  { value: 'monthly', label: '1mo', icon: '🗓️', description: 'Every month' },
  { value: 'manual', label: 'Manual', icon: '🔧', description: 'Manual only' }
];

export function FrequencySelector({ gameId, currentFrequency, onFrequencyChanged }: FrequencySelectorProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedFrequency, setSelectedFrequency] = useState(currentFrequency);
  const { showSuccess, showError } = useNotification();

  const currentIndex = frequencyOptions.findIndex(opt => opt.value === selectedFrequency);
  const currentOption = frequencyOptions[currentIndex] || frequencyOptions[0];

  const handleFrequencyToggle = async () => {
    if (isUpdating) return;

    // Cycle to next frequency
    const nextIndex = (currentIndex + 1) % frequencyOptions.length;
    const nextFrequency = frequencyOptions[nextIndex].value;

    setIsUpdating(true);
    try {
      const response = await fetch('/api/tracking/frequency', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          frequency: nextFrequency
        }),
      });

      if (response.ok) {
        setSelectedFrequency(nextFrequency);
        const newOption = frequencyOptions[nextIndex];
        showSuccess('Frequency Updated', `Now checking ${newOption.description.toLowerCase()}`);
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
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">Check:</span>
      <button
        onClick={handleFrequencyToggle}
        disabled={isUpdating}
        className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
          transition-all duration-200 min-w-[70px] justify-center
          ${selectedFrequency === 'hourly' 
            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700' 
            : selectedFrequency === 'daily'
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700'
            : selectedFrequency === 'weekly'
            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600'
          }
          ${isUpdating 
            ? 'opacity-50 cursor-not-allowed' 
            : 'cursor-pointer hover:scale-105 hover:shadow-sm active:scale-95'
          }
        `}
        title={`Currently: ${currentOption.description}. Click to cycle to next frequency.`}
      >
        {isUpdating ? (
          <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin"></div>
        ) : (
          <>
            <span className="text-xs">{currentOption.icon}</span>
            <span>{currentOption.label}</span>
          </>
        )}
      </button>
    </div>
  );
}