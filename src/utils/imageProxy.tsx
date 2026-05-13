"use client";
import { useState, useEffect, useRef } from 'react';
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
  responsive = false,
  deferUntilVisible = false,
  ...props 
}: {
  src: string | undefined;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  responsive?: boolean;
  /** When true, the image request only starts after the card nears the viewport. */
  deferUntilVisible?: boolean;
} & React.ImgHTMLAttributes<HTMLImageElement>) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(!deferUntilVisible);
  const [imageSrc, setImageSrc] = useState<string>(() =>
    deferUntilVisible ? '' : getProxiedImageUrl(src)
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!deferUntilVisible) {
      setImageSrc(getProxiedImageUrl(src));
      setIsLoading(true);
      setHasError(false);
      setRetryCount(0);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { root: null, rootMargin: '320px 0px', threshold: 0.01 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [deferUntilVisible, src]);

  useEffect(() => {
    if (!deferUntilVisible || !inView) return;
    setImageSrc(getProxiedImageUrl(src));
    setIsLoading(true);
    setHasError(false);
    setRetryCount(0);
  }, [deferUntilVisible, inView, src]);

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
    
    // Try different fallback strategies
    if (retryCount === 0 && src && !src.includes('via.placeholder.com')) {
      // First retry: try our proxy
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(src)}`;
      setImageSrc(proxyUrl);
      setRetryCount(1);
      setIsLoading(true);
      setHasError(false);
    } else if (retryCount === 1) {
      // Second retry: use placeholder
      setImageSrc('https://via.placeholder.com/300x400/3B82F6/FFFFFF?text=Game+Image');
      setRetryCount(2);
      setIsLoading(true);
      setHasError(false);
    }
    // After second retry, show error state
  };

  const showImage = !deferUntilVisible || inView;

  return (
    <div
      ref={rootRef}
      className={`relative overflow-hidden rounded-lg ${className}`}
      style={responsive ? { width: '100%', aspectRatio: `${width} / ${height}` } : { width, height }}
    >
      {(!showImage || isLoading) && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 animate-pulse flex items-center justify-center">
          <div className="text-gray-500 dark:text-gray-400 text-sm">
            {showImage ? 'Loading...' : ''}
          </div>
        </div>
      )}
      {showImage && imageSrc && (
        <Image
          {...props}
          src={imageSrc}
          alt={alt}
          width={width}
          height={height}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
          fetchPriority="low"
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            isLoading ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
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
  
  // For external images that might have CORS issues, proxy them
  if (imageUrl.startsWith('https://') && !imageUrl.includes('localhost')) {
    return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  }
  
  // For local development, try direct first
  return imageUrl;
}

export default ImageWithFallback;