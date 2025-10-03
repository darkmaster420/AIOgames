'use client';

import { useState, useEffect } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { analyzeGameTitle, validateVersionNumber, validateBuildNumber, normalizeVersionNumber, normalizeBuildNumber } from '../utils/versionDetection';

interface SmartVersionVerificationProps {
  gameId: string;
  gameTitle: string;
  originalTitle: string;
  steamAppId?: number;
  currentBuildNumber?: string;
  buildNumberVerified: boolean;
  currentVersionNumber?: string;
  versionNumberVerified: boolean;
  onVerified: () => void;
}

export function SmartVersionVerification({ 
  gameId, 
  gameTitle,
  originalTitle,
  steamAppId,
  currentBuildNumber,
  buildNumberVerified,
  currentVersionNumber,
  versionNumberVerified,
  onVerified
}: SmartVersionVerificationProps) {
  const [pendingVerify, setPendingVerify] = useState<null | 'version' | 'build'>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'version' | 'build'>('version');
  const [versionNumber, setVersionNumber] = useState(currentVersionNumber || '');
  const [buildNumber, setBuildNumber] = useState(currentBuildNumber || '');
  const [buildSource] = useState('steamdb');
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<ReturnType<typeof analyzeGameTitle> | null>(null);
  const { showSuccess, showError } = useNotification();
  const { confirm } = useConfirm();

// removed stray text
  // Effect to trigger verification after state is set
  useEffect(() => {
    if (pendingVerify === 'version' && versionNumber) {
      setPendingVerify(null);
      handleVerifyVersion();
    } else if (pendingVerify === 'build' && buildNumber) {
      setPendingVerify(null);
      handleVerifyBuild();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVerify, versionNumber, buildNumber]);

  const handleResolveMissing = async () => {
    if (!steamAppId) return;
    try {
      setIsLoading(true);
      if (activeTab === 'version' && buildNumber && !versionNumber) {
        // In Version tab, resolve version from build
        const res = await fetch('/api/games/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: steamAppId, build: buildNumber })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || 'Failed to resolve version');
        if (data.version) {
          setVersionNumber(String(data.version));
          setPendingVerify('version');
        } else {
          showError('Not Found', 'No matching version found for that build on SteamDB.');
        }
      } else if (activeTab === 'build' && versionNumber && !buildNumber) {
        // In Build tab, resolve build from version
        const res = await fetch('/api/games/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: steamAppId, version: versionNumber })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || 'Failed to resolve build');
        if (data.build) {
          setBuildNumber(String(data.build));
          setPendingVerify('build');
        } else {
          showError('Not Found', 'No matching build found for that version on SteamDB.');
        }
      }
    } catch (e) {
      showError('Resolve Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  // Analyze the title and always update version/build if a new update is detected
  useEffect(() => {
    const titleAnalysis = analyzeGameTitle(originalTitle || gameTitle);
    setAnalysis(titleAnalysis);

    // Always update version/build if detected and different from current
    if (titleAnalysis.detectedVersion && titleAnalysis.detectedVersion !== versionNumber) {
      setVersionNumber(titleAnalysis.detectedVersion);
    }
    if (titleAnalysis.detectedBuild && titleAnalysis.detectedBuild !== buildNumber) {
      setBuildNumber(titleAnalysis.detectedBuild);
    }

    // Set default tab based on what's suggested
    if (titleAnalysis.suggestions.shouldAskForVersion && !titleAnalysis.suggestions.shouldAskForBuild) {
      setActiveTab('version');
    } else if (titleAnalysis.suggestions.shouldAskForBuild && !titleAnalysis.suggestions.shouldAskForVersion) {
      setActiveTab('build');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalTitle, gameTitle]); // Remove versionNumber and buildNumber from deps to prevent infinite loops

  const handleVerifyVersion = async () => {
    try {
      const validation = validateVersionNumber(versionNumber);
      if (!validation.valid) {
        showError('Validation Error', validation.error || 'Invalid version number');
        return;
      }

      const normalizedVersion = normalizeVersionNumber(versionNumber);
      
      const confirmed = await confirm(
        'Verify Version Number',
        `Are you sure you want to set the version number for "${gameTitle}" to "${normalizedVersion}"?`,
        { confirmText: 'Verify', cancelText: 'Close' }
      );

      if (!confirmed) return;

      setIsLoading(true);
      
      const response = await fetch('/api/games/version-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          versionNumber: normalizedVersion,
          source: 'manual'
        }),
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to verify version');

      showSuccess('Version Verified', `Successfully verified version ${normalizedVersion} for "${gameTitle}".`);
      setIsOpen(false); // Close the editing panel
      onVerified();
    } catch (error) {
      console.error('Version verification error:', error);
      showError('Verification Failed', error instanceof Error ? error.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyBuild = async () => {
    try {
      const validation = validateBuildNumber(buildNumber);
      if (!validation.valid) {
        showError('Validation Error', validation.error || 'Invalid build number');
        return;
      }

      const normalizedBuild = normalizeBuildNumber(buildNumber);
      
      const confirmed = await confirm(
        'Verify Build Number',
        `Are you sure you want to set the build number for "${gameTitle}" to "${normalizedBuild}"?`,
        { confirmText: 'Verify', cancelText: 'Close' }
      );

      if (!confirmed) return;

      setIsLoading(true);
      
      const response = await fetch('/api/games/build-number-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          buildNumber: normalizedBuild,
          source: buildSource
        }),
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to verify build');

      showSuccess('Build Number Verified', `Successfully verified build ${normalizedBuild} for "${gameTitle}".`);
      setIsOpen(false); // Close the editing panel
      onVerified();
    } catch (error) {
      console.error('Build verification error:', error);
      showError('Verification Failed', error instanceof Error ? error.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveVersion = async () => {
    const confirmed = await confirm(
      'Remove Version Verification',
      `Are you sure you want to remove the version number verification for "${gameTitle}"?`,
      { confirmText: 'Remove', cancelText: 'Close', type: 'danger' }
    );

    if (!confirmed) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/games/version-verify', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });

      if (!response.ok) throw new Error('Failed to remove version verification');

      showSuccess('Version Removed', `Version verification removed for "${gameTitle}".`);
      setVersionNumber('');
      onVerified();
    } catch (error) {
      showError('Failed to Remove', error instanceof Error ? error.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveBuild = async () => {
    const confirmed = await confirm(
      'Remove Build Verification',
      `Are you sure you want to remove the build number verification for "${gameTitle}"?`,
      { confirmText: 'Remove', cancelText: 'Close', type: 'danger' }
    );

    if (!confirmed) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/games/build-number-verify', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });

      if (!response.ok) throw new Error('Failed to remove build verification');

      showSuccess('Build Removed', `Build number verification removed for "${gameTitle}".`);
      setBuildNumber('');
      onVerified();
    } catch (error) {
      showError('Failed to Remove', error instanceof Error ? error.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  // Show current status when both are verified and not editing
  if ((buildNumberVerified || versionNumberVerified) && !isOpen) {
    return (
      <div className="space-y-2">
        {/* Show verified version */}
        {versionNumberVerified && currentVersionNumber && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
              ✅ v{currentVersionNumber}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {analysis?.detectedVersion && (
                analysis.detectedVersion === currentVersionNumber || 
                analysis.detectedVersion === `v${currentVersionNumber}` ||
                `v${analysis.detectedVersion}` === currentVersionNumber
              ) ? '(Auto-detected)' : '(Manual)'}
            </span>
            <button
              onClick={() => { setIsOpen(true); setActiveTab('version'); }}
              className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
              title="Edit version number"
            >
              Edit
            </button>
            <button
              onClick={handleRemoveVersion}
              disabled={isLoading}
              className="text-red-600 dark:text-red-400 hover:underline text-xs disabled:opacity-50"
              title="Remove version verification"
            >
              Remove
            </button>
          </div>
        )}
        
        {/* Show verified build */}
        {buildNumberVerified && currentBuildNumber && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
              🏗️ Build #{currentBuildNumber}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {analysis?.detectedBuild && (
                analysis.detectedBuild === currentBuildNumber ||
                analysis.detectedBuild === `#${currentBuildNumber}` ||
                `#${analysis.detectedBuild}` === currentBuildNumber
              ) ? '(Auto-detected)' : '(Manual)'}
            </span>
            <button
              onClick={() => { setIsOpen(true); setActiveTab('build'); }}
              className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
              title="Edit build number"
            >
              Edit
            </button>
            <button
              onClick={handleRemoveBuild}
              disabled={isLoading}
              className="text-red-600 dark:text-red-400 hover:underline text-xs disabled:opacity-50"
              title="Remove build verification"
            >
              Remove
            </button>
          </div>
        )}
        
        {/* Show suggestion to add the missing one */}
        {/* Always show add buttons for missing verification types */}
        {versionNumberVerified && !buildNumberVerified && (
          <button
            onClick={() => { setIsOpen(true); setActiveTab('build'); }}
            className="inline-flex items-center px-2 py-1 border border-purple-300 dark:border-purple-600 rounded text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
          >
            🔢 Add Build Number
          </button>
        )}
        {buildNumberVerified && !versionNumberVerified && (
          <button
            onClick={() => { setIsOpen(true); setActiveTab('version'); }}
            className="inline-flex items-center px-2 py-1 border border-green-300 dark:border-green-600 rounded text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
          >
            📋 Add Version Number
          </button>
        )}
        {!versionNumberVerified && !buildNumberVerified && (
          <button
            onClick={() => setIsOpen(true)}
            className="inline-flex items-center px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/20 hover:bg-gray-100 dark:hover:bg-gray-900/40 transition-colors"
          >
            🔢📋 Add Version Info
          </button>
        )}
      </div>
    );
  }

  if (!isOpen) {
    const hasAny = buildNumberVerified || versionNumberVerified;
    const buttonText = hasAny 
      ? "🔢📋 Edit Version Info" 
      : analysis?.suggestions.shouldAskForVersion 
        ? "📋 Add Version Number"
        : analysis?.suggestions.shouldAskForBuild
          ? "🔢 Add Build Number"
          : "🔢📋 Add Version Info";

    return (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
      >
        {buttonText}
      </button>
    );
  }

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
      <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
        Smart Version Tracking
      </h4>
      
      {/* Smart Analysis Message */}
      {analysis?.suggestions.message && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-xs">
          <p className="text-blue-700 dark:text-blue-300">
            <strong>💡 Smart Detection:</strong> {analysis.suggestions.message}
          </p>
          {analysis.detectedVersion && (
            <p className="text-blue-600 dark:text-blue-400 mt-1">
              Found version: <strong>{analysis.detectedVersion}</strong>
            </p>
          )}
          {analysis.detectedBuild && (
            <p className="text-blue-600 dark:text-blue-400 mt-1">
              Found build: <strong>{analysis.detectedBuild}</strong>
            </p>
          )}
        </div>
      )}

      {/* Tab Selection */}
      <div className="flex mb-4 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
        <button
          onClick={() => setActiveTab('version')}
          className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
            activeTab === 'version'
              ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          📋 Version Number
        </button>
        <button
          onClick={() => setActiveTab('build')}
          className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
            activeTab === 'build'
              ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          🔢 Build Number
        </button>
      </div>

      {/* Version Number Tab */}
      {activeTab === 'version' && (
        <div className="space-y-3">
          <div>
            <label htmlFor={`version-number-${gameId}`} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Version Number
            </label>
            <input
              id={`version-number-${gameId}`}
              name={`version-number-${gameId}`}
              type="text"
              value={versionNumber}
              onChange={(e) => setVersionNumber(e.target.value)}
              placeholder="e.g., 1.2.3, v2.0, 1.5a"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Examples: 1.2.3, v2.0, 1.5a, 2.0-beta
            </p>
          </div>

          {steamAppId && (
            <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded text-xs">
              <p className="text-green-700 dark:text-green-300">
                <strong>Tip:</strong> Visit <a 
                  href={`https://steamdb.info/app/${steamAppId}/patchnotes/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-green-800 dark:hover:text-green-200"
                >
                  steamdb.info/app/{steamAppId}/patchnotes/
                </a> to find the version and build number that matches your game.
              </p>
              {buildNumber && !versionNumber && (
                <button
                  type="button"
                  onClick={handleResolveMissing}
                  disabled={isLoading}
                  className="mt-2 px-2 py-1 bg-purple-600 text-white rounded text-xs disabled:opacity-50"
                >
                  {isLoading ? 'Resolving…' : 'Resolve Version from Build'}
                </button>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleVerifyVersion}
              disabled={isLoading || !versionNumber.trim()}
              className="px-3 py-2 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Verifying...' : 'Verify Version'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setVersionNumber(currentVersionNumber || '');
                setBuildNumber(currentBuildNumber || '');
              }}
              className="px-3 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Build Number Tab */}
      {activeTab === 'build' && (
        <div className="space-y-3">
          <div>
            <label htmlFor={`build-number-${gameId}`} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Build Number
            </label>
            <input
              id={`build-number-${gameId}`}
              name={`build-number-${gameId}`}
              type="text"
              value={buildNumber}
              onChange={(e) => setBuildNumber(e.target.value)}
              placeholder="e.g., 15832751"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Find the build number on SteamDB that matches your game version
            </p>
          </div>

          {steamAppId && (
            <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded text-xs">
              <p className="text-purple-700 dark:text-purple-300">
                <strong>Tip:</strong> Visit <a 
                  href={`https://steamdb.info/app/${steamAppId}/patchnotes/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-purple-800 dark:hover:text-purple-200"
                >
                  steamdb.info/app/{steamAppId}/patchnotes/
                </a> to find the build number that matches your game version.
              </p>
              {versionNumber && !buildNumber && (
                <button
                  type="button"
                  onClick={handleResolveMissing}
                  disabled={isLoading}
                  className="mt-2 px-2 py-1 bg-green-600 text-white rounded text-xs disabled:opacity-50"
                >
                  {isLoading ? 'Resolving…' : 'Resolve Build from Version'}
                </button>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleVerifyBuild}
              disabled={isLoading || !buildNumber.trim()}
              className="px-3 py-2 bg-purple-600 text-white text-xs font-medium rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Verifying...' : 'Verify Build'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setVersionNumber(currentVersionNumber || '');
                setBuildNumber(currentBuildNumber || '');
              }}
              className="px-3 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}