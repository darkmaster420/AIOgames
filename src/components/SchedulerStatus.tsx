// Scheduler Status Component - Shows automatic update scheduling status
'use client';

import { useState, useEffect } from 'react';

interface SchedulerStatus {
  isRunning: boolean;
  scheduledUsers: number;
  message: string;
  nextChecks: Array<{
    userId: string;
    frequency: string;
    nextCheck: string;
  }>;
}

export function SchedulerStatus() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSchedulerStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/scheduler');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scheduler status');
    } finally {
      setLoading(false);
    }
  };

  const updateSchedule = async () => {
    try {
      const response = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateSchedule' })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Reload status
      await loadSchedulerStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule');
    }
  };

  useEffect(() => {
    loadSchedulerStatus();
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-2"></div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-center gap-2">
          <span className="text-red-500">⚠️</span>
          <span className="text-red-700 dark:text-red-300 text-sm">
            Error: {error}
          </span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  const getStatusColor = () => {
    if (!status.isRunning) return 'text-red-500';
    return 'text-green-500';
  };

  const getStatusIcon = () => {
    if (!status.isRunning) return '⏸️';
    return '✅';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
          <span>{getStatusIcon()}</span>
          Automatic Updates
        </h3>
        <button
          onClick={updateSchedule}
          className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
          title="Refresh your automatic update schedule based on current game settings"
        >
          Refresh Schedule
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-600 dark:text-gray-400">Status:</span>
          <span className={`font-medium ${getStatusColor()}`}>
            {status.isRunning ? 'Running' : 'Stopped'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-600 dark:text-gray-400">Total Scheduled Users:</span>
          <span className="text-gray-900 dark:text-white font-medium">
            {status.scheduledUsers}
          </span>
        </div>

        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <p className="text-gray-700 dark:text-gray-300 text-xs">
            {status.message}
          </p>
        </div>

        {status.nextChecks && status.nextChecks.length > 0 && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Next Scheduled Checks:
            </div>
            <div className="space-y-1 max-h-20 overflow-y-auto">
              {status.nextChecks.slice(0, 3).map((check, index) => (
                <div key={index} className="flex justify-between items-center text-xs">
                  <span className="text-gray-600 dark:text-gray-400 capitalize">
                    {check.frequency}
                  </span>
                  <span className="text-gray-500 dark:text-gray-500">
                    {new Date(check.nextCheck).toLocaleString()}
                  </span>
                </div>
              ))}
              {status.nextChecks.length > 3 && (
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  +{status.nextChecks.length - 3} more...
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          💡 <strong>Automatic updates</strong> run based on your tracked games&apos; frequency settings. 
          No external setup required!
        </div>
      </div>
    </div>
  );
}