"use client";
import { useState } from 'react';
import Image from 'next/image';

/**
 * Robust image component with fallback and proxy support
 */
export const ImageWithFallback = ({ 
  src, 
  alt, 
  width = 300, 
  height = 400, 
  className = '',
  ...props 
}: {
  src: string | undefined;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
} & React.ImgHTMLAttributes<HTMLImageElement>) => {
  const [imageSrc, setImageSrc] = useState<string>(
    getProxiedImageUrl(src)
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
    
    // Try different fallback strategies
    if (retryCount === 0 && src && !src.includes('via.placeholder.com') && !src.includes('gameapi.a7a8524.workers.dev/proxy-image')) {
      // First retry: try our proxy (but only if not already proxied by external API)
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(src)}`;
      setImageSrc(proxyUrl);
      setRetryCount(1);
      setIsLoading(true);
      setHasError(false);
    } else if (retryCount === 1 || src?.includes('gameapi.a7a8524.workers.dev/proxy-image')) {
      // Second retry or if already externally proxied: use placeholder
      setImageSrc('https://via.placeholder.com/300x400/3B82F6/FFFFFF?text=Game+Image');
      setRetryCount(2);
      setIsLoading(true);
      setHasError(false);
    }
    // After second retry, show error state
  };

  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`} style={{ width, height }}>
      {isLoading && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 animate-pulse flex items-center justify-center">
          <div className="text-gray-500 dark:text-gray-400 text-sm">Loading...</div>
        </div>
      )}
      <Image
        {...props}
        src={imageSrc}
        alt={alt}
        width={width}
        height={height}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoading ? 'opacity-0' : 'opacity-100'
        }`}
      />
      {hasError && retryCount >= 2 && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 text-gray-500 dark:text-gray-400 text-xs text-center p-2">
          <div className="flex flex-col items-center">
            <div className="text-2xl mb-2">🎮</div>
            <div>Image not available</div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Get proxied image URL with fallback strategy
 */
export function getProxiedImageUrl(imageUrl: string | undefined): string {
  if (!imageUrl) {
    return 'https://via.placeholder.com/300x400/3B82F6/FFFFFF?text=No+Image';
  }
  
  // If it's already a placeholder or our internal proxy, return as-is
  if (imageUrl.includes('via.placeholder.com') || imageUrl.includes('/api/proxy-image')) {
    return imageUrl;
  }
  
  // IMPROVED: If it's already proxied by the external gameapi (SkidrowReloaded, etc.), use directly
  if (imageUrl.includes('gameapi.a7a8524.workers.dev/proxy-image') || 
      imageUrl.includes('gameapi.a7a8524.workers.dev')) {
    return imageUrl;
  }
  
  // For other external images that might have CORS issues, proxy them
  if (imageUrl.startsWith('https://') && !imageUrl.includes('localhost')) {
    return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  }
  
  // For local development, try direct first
  return imageUrl;
}

export default ImageWithFallback;