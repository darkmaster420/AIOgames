'use client';

import { useState, useEffect } from 'react';

interface AIDetectionStatus {
  configured: boolean;
  status: 'available' | 'unavailable' | 'unreachable' | 'not_configured' | 'integrated';
  message: string;
  workerInfo?: Record<string, unknown>;
  workerUrl?: string;
}

export function AIDetectionStatus() {
  const [status, setStatus] = useState<AIDetectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check AI detection status via API endpoint
      const response = await fetch('/api/admin/ai-detection-status');
      if (!response.ok) {
        throw new Error('Failed to fetch AI detection status');
      }
      
      const statusData = await response.json();
      setStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI detection status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const getStatusIcon = () => {
    if (!status) return '⏳';
    switch (status.status) {
      case 'available': return '🤖✅';
      case 'unavailable': return '🤖⚠️';
      case 'unreachable': return '🤖❌';
      case 'not_configured': return '🤖⚪';
      default: return '🤖';
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-3">
          <div className="animate-spin">⏳</div>
          <div>
            <h3 className="font-semibold">AI Update Detection</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">Checking status...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-red-200 dark:border-red-700 p-4">
        <div className="flex items-center gap-3">
          <div className="text-red-500">❌</div>
          <div>
            <h3 className="font-semibold text-red-700 dark:text-red-400">AI Detection Error</h3>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button 
              onClick={loadStatus}
              className="text-sm text-red-700 dark:text-red-400 hover:underline mt-1"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg border p-4 ${
      status.status === 'available' 
        ? 'border-green-200 dark:border-green-700' 
        : status.status === 'not_configured'
        ? 'border-gray-200 dark:border-gray-700'
        : 'border-yellow-200 dark:border-yellow-700'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="text-xl">{getStatusIcon()}</div>
          <div>
            <h3 className="font-semibold">AI Update Detection</h3>
            <p className={`text-sm ${
              status.status === 'available' 
                ? 'text-green-600 dark:text-green-400' 
                : status.status === 'not_configured'
                ? 'text-gray-600 dark:text-gray-400'
                : 'text-yellow-600 dark:text-yellow-400'
            }`}>
              {status.message}
            </p>
          </div>
        </div>
        
        <button
          onClick={loadStatus}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:underline"
        >
          Refresh
        </button>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        {status.configured ? (
          <div className="text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Configuration:</span>
              <span className="text-green-600 dark:text-green-400">✅ Worker URL configured</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Service Status:</span>
              <span className={`${
                status.status === 'available' 
                  ? 'text-green-600 dark:text-green-400' 
                  : 'text-yellow-600 dark:text-yellow-400'
              }`}>
                {status.status === 'available' ? '✅ Online' : '⚠️ Offline/Error'}
              </span>
            </div>
            {status.workerInfo && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Worker Info:</span>
                <span className="text-gray-600 dark:text-gray-300">
                  {String(status.workerInfo.service || 'unknown')} v{String(status.workerInfo.version || '1.0')}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            💡 <strong>AI detection is disabled.</strong> Set <code>AI_DETECTION_WORKER_URL</code> in your environment to enable AI-powered update detection.
            When disabled, the system uses regex-based detection only.
          </div>
        )}
      </div>

      {status.status === 'available' && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-green-600 dark:text-green-400">
            🚀 <strong>AI Enhanced:</strong> Update detection now uses AI to improve accuracy when regex patterns are uncertain.
          </div>
        </div>
      )}
    </div>
  );
}