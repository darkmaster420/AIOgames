import { useState } from 'react';

/**
 * Utility function to proxy images through our backend to handle CORS
 * @param imageUrl - The original image URL
 * @returns Proxied image URL or fallback
 */
export function getProxiedImageUrl(imageUrl: string | undefined): string {
  if (!imageUrl) {
    return 'https://via.placeholder.com/300x400?text=No+Image';
  }

  // If it's already a data URL or our proxy URL, return as-is
  if (imageUrl.startsWith('data:') || imageUrl.includes('/api/proxy-image')) {
    return imageUrl;
  }

  // For placeholder images, return directly
  if (imageUrl.includes('via.placeholder.com')) {
    return imageUrl;
  }

  // Proxy all other images
  try {
    const encodedUrl = encodeURIComponent(imageUrl);
    return `/api/proxy-image?url=${encodedUrl}`;
  } catch (error) {
    console.warn('Failed to encode image URL:', error);
    return 'https://via.placeholder.com/300x400?text=Image+Error';
  }
}

/**
 * Optimized image component with lazy loading and error handling
 */
export const ImageWithFallback = ({ 
  src, 
  alt, 
  width = 300, 
  height = 400, 
  className = '',
  ...props 
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
} & Record<string, unknown>) => {
  const [imageSrc, setImageSrc] = useState(getProxiedImageUrl(src));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const handleLoad = () => {
    setIsLoading(false);
    setError(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setError(true);
    setImageSrc('https://via.placeholder.com/300x400?text=Image+Error');
  };

  return (
    <div className={`relative ${className}`} style={{ width, height }}>
      {isLoading && (
        <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
      )}
      <img
        src={imageSrc}
        alt={alt}
        width={width}
        height={height}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        className={`${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300 rounded`}
        {...props}
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm rounded">
          Image Error
        </div>
      )}
    </div>
  );
};

export default ImageWithFallback;