'use client';

import { useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';

interface BuildNumberVerificationProps {
  gameId: string;
  gameTitle: string;
  steamAppId?: number;
  currentBuildNumber?: string;
  latestBuildNumber?: string;
  latestVersion?: string;
  buildNumberVerified: boolean;
  onVerified: () => void;
}

export function BuildNumberVerification({ 
  gameId, 
  gameTitle,
  steamAppId,
  currentBuildNumber,
  latestBuildNumber,
  latestVersion,
  buildNumberVerified,
  onVerified 
}: BuildNumberVerificationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [buildNumber, setBuildNumber] = useState(currentBuildNumber || '');
  const [isLoading, setIsLoading] = useState(false);
  const { showSuccess, showError } = useNotification();
  const { confirm } = useConfirm();

  const handleVerifyBuildNumber = async () => {
    if (!buildNumber.trim()) {
      showError('Validation Error', 'Please enter a build number.');
      return;
    }

    // Basic validation - should be numeric
    if (!/^\d+$/.test(buildNumber.trim())) {
      showError('Validation Error', 'Build number should contain only digits.');
      return;
    }

    const confirmed = await confirm(
      'Verify Build Number',
      `Are you sure you want to set the build number for "${gameTitle}" to "${buildNumber.trim()}"? This will be used for update tracking.`,
      { confirmText: 'Verify', cancelText: 'Cancel' }
    );

    if (!confirmed) return;

    setIsLoading(true);

    try {
      const response = await fetch('/api/games/build-number-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          buildNumber: buildNumber.trim(),
          source: 'steamdb'
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify build number');
      }

      showSuccess(
        'Build Number Verified',
        `Successfully verified build number ${buildNumber.trim()} for "${gameTitle}".`
      );

      setIsOpen(false);
      onVerified();

    } catch (error) {
      showError(
        'Verification Failed',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveVerification = async () => {
    const confirmed = await confirm(
      'Remove Build Number Verification',
      `Are you sure you want to remove the build number verification for "${gameTitle}"?`,
      { confirmText: 'Remove', cancelText: 'Cancel', type: 'danger' }
    );

    if (!confirmed) return;

    setIsLoading(true);

    try {
      const response = await fetch('/api/games/build-number-verify', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gameId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove build number verification');
      }

      showSuccess(
        'Verification Removed',
        `Build number verification removed for "${gameTitle}".`
      );

      setBuildNumber('');
      onVerified();

    } catch (error) {
      showError(
        'Failed to Remove',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (buildNumberVerified && !isOpen) {
    return (
      <div className="p-3 border rounded-lg bg-blue-500/10 border-blue-500/30">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-blue-400">
                Steam Verified
              </span>
              {steamAppId && (
                <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-300 rounded">
                  ID: {steamAppId}
                </span>
              )}
            </div>
            {currentBuildNumber && (
              <div className="text-sm text-gray-300 mb-1">Build #{currentBuildNumber}</div>
            )}
            {/* Latest Version Info from SteamDB */}
            {(latestBuildNumber || latestVersion) && (
              <div className="mt-2 pt-2 border-t border-blue-500/20">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-blue-300">Latest from SteamDB:</span>
                  {latestVersion && (
                    <span className="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 rounded text-xs">
                      v{latestVersion}
                    </span>
                  )}
                  {latestBuildNumber && (
                    <span className="px-1.5 py-0.5 bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200 rounded text-xs">
                      Build #{latestBuildNumber}
                    </span>
                  )}
                </div>
              </div>
            )}
            {steamAppId && (
              <a
                href={`https://steamdb.info/app/${steamAppId}/patchnotes/`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline mt-2"
              >
                🔗 SteamDB
              </a>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsOpen(true)}
              className="px-3 py-1.5 text-xs font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded transition-colors"
            >
              ⚙️ Manage
            </button>
            <button
              onClick={handleRemoveVerification}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-medium bg-gray-500/20 hover:bg-gray-500/30 text-gray-300 rounded transition-colors disabled:opacity-50"
            >
              ❌
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <div className="space-y-2">
        <button
          onClick={() => setIsOpen(true)}
          className="w-full px-3 py-2 text-sm font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg transition-colors"
        >
          🔢 Add Build Number
        </button>
        {steamAppId && (
          <a
            href={`https://steamdb.info/app/${steamAppId}/patchnotes/`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
          >
            🔗 SteamDB
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
      <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
        Manual Build Number Verification
      </h4>
      
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Current Build Number
          </label>
          <input
            type="text"
            value={buildNumber}
            onChange={(e) => setBuildNumber(e.target.value)}
            placeholder="e.g., 15832751"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Find this on SteamDB → App → Patchnotes (latest build ID)
          </p>
        </div>

        {steamAppId && (
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs">
            <p className="text-blue-700 dark:text-blue-300">
              <strong>Tip:</strong> Visit <a 
                href={`https://steamdb.info/app/${steamAppId}/patchnotes/`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-blue-800 dark:hover:text-blue-200"
              >
                steamdb.info/app/{steamAppId}/patchnotes/
              </a> to find the latest build number.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleVerifyBuildNumber}
            disabled={isLoading || !buildNumber.trim()}
            className="px-3 py-2 bg-purple-600 text-white text-xs font-medium rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Verifying...' : 'Verify Build Number'}
          </button>
          <button
            onClick={() => {
              setIsOpen(false);
              setBuildNumber(currentBuildNumber || '');
            }}
            className="px-3 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}