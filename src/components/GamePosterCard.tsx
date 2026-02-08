'use client';

import { ImageWithFallback } from '../utils/imageProxy';
import { GameDownloadLinks } from './GameDownloadLinks';

interface GamePosterCardProps {
  postId?: string;
  siteType?: string;
  title: string;
  image: string;
  year?: string;
  badge?: string;
  badgeColor?: 'blue' | 'green' | 'red' | 'yellow';
  hasUpdate?: boolean;
  isTracked?: boolean;
  onTrack?: () => void;
  onUntrack?: () => void;
  className?: string;
}

export function GamePosterCard({
  postId,
  siteType,
  title,
  image,
  year,
  badge,
  badgeColor = 'blue',
  hasUpdate = false,
  isTracked = false,
  onTrack,
  onUntrack,
  className = '',
}: GamePosterCardProps) {
  const badgeColors = {
    blue: 'bg-blue-600',
    green: 'bg-green-600',
    red: 'bg-red-600',
    yellow: 'bg-yellow-600',
  };

  return (
    <div className={`relative group ${className}`}>
      {/* Poster Image Container */}
      <div 
        className="relative rounded-lg overflow-hidden bg-gray-800 shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:scale-105 max-h-[400px] flex items-center"
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
        
        {/* Top Badges */}
        <div className="absolute top-2 left-2 right-2 flex justify-between items-start z-10">
          {badge && (
            <span className={`${badgeColors[badgeColor]} text-white text-xs font-bold px-2 py-1 rounded`}>
              {badge}
            </span>
          )}
          {hasUpdate && (
            <span className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded animate-pulse">
              NEW
            </span>
          )}
        </div>

        {/* Title Overlay - Always visible at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-3 z-10 bg-gradient-to-t from-black/90 to-transparent">
          <h3 className="text-white font-bold text-sm mb-1 line-clamp-2">
            {title}
          </h3>
          {year && (
            <p className="text-gray-300 text-xs">{year}</p>
          )}
        </div>

        {/* Hover Overlay with Quick Actions - Positioned at bottom */}
        <div className="absolute inset-0 bg-black/95 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 z-20">
          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-white font-bold text-base mb-3 line-clamp-3">{title}</h4>
            
            {postId && siteType && (
              <div onClick={(e) => e.stopPropagation()}>
                <GameDownloadLinks 
                  postId={postId}
                  siteType={siteType}
                  gameTitle={title}
                  className="w-full"
                />
              </div>
            )}
            
            {/* Track/Untrack Button */}
            {(onTrack || onUntrack) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isTracked && onUntrack) {
                    onUntrack();
                  } else if (!isTracked && onTrack) {
                    onTrack();
                  }
                }}
                className={`block w-full px-4 py-2.5 ${
                  isTracked 
                    ? 'bg-red-600 hover:bg-red-700' 
                    : 'bg-green-600 hover:bg-green-700'
                } text-white rounded-lg transition-colors text-sm font-medium`}
              >
                {isTracked ? '🗑️ Stop Tracking' : '➕ Track Game'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
