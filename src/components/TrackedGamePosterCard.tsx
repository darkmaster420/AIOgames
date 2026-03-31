'use client';

import { useRouter } from 'next/navigation';
import { ImageWithFallback } from '../utils/imageProxy';
import { GameDownloadLinks } from './GameDownloadLinks';
import { ExternalLinkIcon } from './ExternalLinkIcon';

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

export function TrackedGamePosterCard(props: TrackedGamePosterCardProps) {
  const {
    gameId,
    appid,
    title,
    image,
    hasUpdate = false,
    gameLink,
    steamVerified,
    steamName,
    onUntrack,
    onCheckUpdate,
    isCheckingUpdate = false,
    className = '',
  } = props;
  const router = useRouter();

  const handleOpenDetails = () => {
    if (appid) {
      router.push(`/appid/${appid}`);
      return;
    }

    router.push(`/unverified/${gameId}`);
  };

  // Collapsed view (poster card)
  return (
    <div className={`relative group self-start ${className}`}>
      {/* Poster Image Container */}
      <div 
        className="relative rounded-lg overflow-hidden bg-gray-800 shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:scale-105 max-h-[400px] flex items-center cursor-pointer"
        onClick={handleOpenDetails}
      >
        {/* Image */}
        <ImageWithFallback
          src={image}
          alt={title}
          width={460}
          height={690}
          responsive
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
          {!appid && (
            <span className="bg-yellow-500 text-black text-xs font-bold px-2 py-1 rounded ml-2">
              NO APPID
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
