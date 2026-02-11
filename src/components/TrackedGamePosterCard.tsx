'use client';

import { useState } from 'react';
import { ImageWithFallback } from '../utils/imageProxy';
import { GameDownloadLinks } from './GameDownloadLinks';
import { ExternalLinkIcon } from './ExternalLinkIcon';
import { NotificationToggle } from './NotificationToggle';
import { BuildNumberVerification } from './BuildNumberVerification';
import GOGVerification from './GOGVerification';

interface UpdateHistoryItem {
  version: string;
  dateFound: string;
  gameLink: string;
  isLatest?: boolean;
}

interface PendingUpdate {
  _id: string;
  newTitle: string;
  detectedVersion: string;
  reason: string;
  dateFound: string;
  aiDetectionReason?: string;
}

interface TrackedGamePosterCardProps {
  gameId: string;
  appid?: number;
  gogProductId?: number;
  title: string;
  originalTitle?: string;
  description?: string;
  image: string;
  hasUpdate?: boolean;
  gameLink: string;
  lastKnownVersion?: string;
  currentBuildNumber?: string;
  currentVersionNumber?: string;
  steamVerified?: boolean;
  steamName?: string;
  gogVerified?: boolean;
  buildNumberVerified?: boolean;
  notificationsEnabled?: boolean;
  gogName?: string;
  gogVersion?: string;
  gogBuildId?: string;
  gogLastChecked?: Date;
  gogLatestVersion?: string;
  gogLatestBuildId?: string;
  gogLatestDate?: string;
  steamdbUpdate?: {
    version?: string;
    buildNumber?: string;
    date?: string;
  };
  updateHistory?: UpdateHistoryItem[];
  pendingUpdates?: PendingUpdate[];
  onUntrack: () => void;
  onCheckUpdate: () => void;
  onRefresh?: () => void;
  isCheckingUpdate?: boolean;
  className?: string;
}

export function TrackedGamePosterCard({
  gameId,
  appid,
  gogProductId,
  title,
  originalTitle,
  description,
  image,
  hasUpdate = false,
  gameLink,
  lastKnownVersion,
  currentBuildNumber,
  currentVersionNumber,
  steamVerified,
  steamName,
  gogVerified,
  buildNumberVerified = false,
  notificationsEnabled,
  gogName,
  gogVersion,
  gogBuildId,
  gogLastChecked,
  gogLatestVersion: gogLatestVersionProp,
  gogLatestBuildId: gogLatestBuildIdProp,
  gogLatestDate: gogLatestDateProp,
  steamdbUpdate,
  updateHistory = [],
  pendingUpdates = [],
  onUntrack,
  onCheckUpdate,
  onRefresh,
  isCheckingUpdate = false,
  className = '',
}: TrackedGamePosterCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (isExpanded) {
    return (
      <div className={`col-span-full bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden ${className}`}>
        {/* Header with image */}
        <div className="relative h-48 bg-gray-900">
          <ImageWithFallback
            src={image}
            alt={title}
            width={800}
            height={200}
            className="object-cover w-full h-full opacity-50"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
          
          {/* Title and close button */}
          <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-between items-end">
            <div className="flex-1">
              <h3 className="text-white font-bold text-xl mb-1">{title}</h3>
              {originalTitle && originalTitle !== title && (
                <p className="text-gray-300 text-sm">Original: {originalTitle}</p>
              )}
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="bg-gray-800/90 hover:bg-gray-700 text-white p-2 rounded-lg transition-colors"
              title="Collapse"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Status Row */}
          <div className="flex flex-wrap gap-2">
            {hasUpdate && (
              <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full animate-pulse">
                NEW UPDATE
              </span>
            )}
            {notificationsEnabled && (
              <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                🔔 Notifications ON
              </span>
            )}
            {steamVerified && (
              <span className="bg-purple-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                Steam Verified
              </span>
            )}
            {gogVerified && (
              <span className="bg-pink-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                GOG Verified
              </span>
            )}
          </div>

          {/* Notifications Toggle */}
          <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
            <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">Notification Settings</h4>
            <NotificationToggle 
              gameId={gameId}
              currentEnabled={notificationsEnabled || false}
              onToggleChanged={onRefresh}
            />
          </div>

          {/* Verification Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 pb-2">
              Game Verification
            </h4>
            
            {/* Steam Build Number Verification */}
            {appid && (
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"/>
                  </svg>
                  <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Steam Verification</h5>
                </div>
                <BuildNumberVerification
                  gameId={gameId}
                  gameTitle={title}
                  steamAppId={appid}
                  currentBuildNumber={currentBuildNumber}
                  latestBuildNumber={steamdbUpdate?.buildNumber}
                  latestVersion={steamdbUpdate?.version}
                  buildNumberVerified={buildNumberVerified}
                  onVerified={() => onRefresh?.()}
                />
              </div>
            )}

            {/* GOG Verification */}
            <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-300">GOG Verification</h5>
              </div>
              <GOGVerification
                gameId={gameId}
                gameTitle={title}
                currentGogId={gogProductId}
                currentGogName={gogName}
                isVerified={gogVerified}
                gogLatestVersion={gogLatestVersionProp || gogVersion}
                gogLatestBuildId={gogLatestBuildIdProp || gogBuildId}
                gogLatestDate={gogLatestDateProp || (gogLastChecked ? new Date(gogLastChecked).toISOString() : undefined)}
                trackedVersion={currentVersionNumber}
                trackedBuildId={currentBuildNumber}
                onVerificationComplete={() => onRefresh?.()}
              />
            </div>
          </div>

          {/* Version Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
              <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Current Version</h4>
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {lastKnownVersion || 'Unknown'}
              </p>
              {currentVersionNumber && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Version: {currentVersionNumber}
                </p>
              )}
              {currentBuildNumber && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Build: {currentBuildNumber}
                </p>
              )}
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
              <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Links</h4>
              <div className="space-y-2">
                {appid && (
                  <a
                    href={`https://store.steampowered.com/app/${appid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <ExternalLinkIcon className="w-3 h-3" /> Steam Store
                  </a>
                )}
                {gogProductId && (
                  <a
                    href={`https://www.gog.com/game/${gogProductId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    <ExternalLinkIcon className="w-3 h-3" /> GOG Store
                  </a>
                )}
                <a
                  href={gameLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 hover:underline"
                >
                  <ExternalLinkIcon className="w-3 h-3" /> Source Page
                </a>
              </div>
            </div>
          </div>

          {/* Description */}
          {description && (
            <div>
              <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Description</h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">{description}</p>
            </div>
          )}

          {/* Pending Updates */}
          {pendingUpdates && pendingUpdates.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
                Pending Updates ({pendingUpdates.length})
              </h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {pendingUpdates.map((update) => (
                  <div key={update._id} className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded border border-yellow-200 dark:border-yellow-800">
                    <div className="font-medium text-sm text-gray-900 dark:text-white">{update.newTitle}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {update.reason} • {formatDate(update.dateFound)}
                      {update.aiDetectionReason && (
                        <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                          🤖 AI: {update.aiDetectionReason}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Update History */}
          {updateHistory && updateHistory.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
                Recent Updates ({updateHistory.length})
              </h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {updateHistory.slice(0, 5).map((update, idx) => (
                  <div key={idx} className="bg-gray-50 dark:bg-gray-900 p-3 rounded border border-gray-200 dark:border-gray-700">
                    <div className="font-medium text-sm text-gray-900 dark:text-white">{update.version}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {formatDate(update.dateFound)}
                      {update.isLatest && <span className="ml-2 text-green-600 dark:text-green-400">• Latest</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCheckUpdate();
              }}
              disabled={isCheckingUpdate}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
            >
              {isCheckingUpdate ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  Checking...
                </div>
              ) : (
                '🔄 Check for Updates'
              )}
            </button>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUntrack();
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              🗑️ Stop Tracking
            </button>
          </div>

          {/* Download Links */}
          <div>
            <GameDownloadLinks 
              gameId={gameId}
              gameTitle={title}
              className="w-full"
            />
          </div>
        </div>
      </div>
    );
  }

  // Collapsed view (poster card)
  return (
    <div className={`relative group ${className}`}>
      {/* Poster Image Container */}
      <div 
        className="relative rounded-lg overflow-hidden bg-gray-800 shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:scale-105 cursor-pointer max-h-[400px] flex items-center"
        onClick={() => setIsExpanded(true)}
      >
        {/* Image */}
        <ImageWithFallback
          src={image}
          alt={title}
          width={460}
          height={690}
          className="w-full h-auto max-h-[400px] object-contain"
        />
        
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
        
        {/* Top Action Buttons */}
        <div className="absolute top-2 left-2 right-2 flex justify-between items-start z-30">
          {/* Untrack Button - Top Left */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUntrack();
            }}
            className="bg-red-600/90 hover:bg-red-700 text-white p-1.5 rounded shadow-lg transition-all duration-200 hover:scale-110"
            title="Stop tracking this game"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          
          {/* Check Update Button - Top Right */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCheckUpdate();
            }}
            disabled={isCheckingUpdate}
            className="bg-blue-600/90 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white p-1.5 rounded shadow-lg transition-all duration-200 hover:scale-110"
            title="Check for updates"
          >
            {isCheckingUpdate ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </button>
        </div>
        
        {/* Status Badges */}
        <div className="absolute top-12 left-2 right-2 flex justify-end items-start z-30">
          {hasUpdate && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded animate-pulse">
              UPDATE
            </span>
          )}
        </div>

        {/* Title Overlay - Always visible at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-3 z-10 bg-gradient-to-t from-black/90 to-transparent">
          <h3 className="text-white font-bold text-sm mb-1 line-clamp-2">
            {steamVerified && steamName ? steamName : title}
          </h3>
        </div>

        {/* Hover Overlay with Quick Actions */}
        <div className="absolute inset-0 bg-black/95 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 z-20">
          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-white font-bold text-base mb-3 line-clamp-3">{steamVerified && steamName ? steamName : title}</h4>
            
            <button
              onClick={() => setIsExpanded(true)}
              className="block w-full px-4 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              📋 Expand Details
            </button>
            
            <a
              href={gameLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="block w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-1"
              title="Open game page"
            >
              <ExternalLinkIcon className="w-3 h-3" /> Open Source Page
            </a>
            
            <div onClick={(e) => e.stopPropagation()}>
              <GameDownloadLinks 
                gameId={gameId}
                gameTitle={title}
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
