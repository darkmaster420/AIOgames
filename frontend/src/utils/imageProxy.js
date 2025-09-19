import React from 'react';

// Image proxy utility to bypass CORS restrictions
export function getProxiedImageUrl(originalUrl) {
  if (!originalUrl) return null;
  
  // If it's already a data URL or relative path, don't proxy it
  if (originalUrl.startsWith('data:') || originalUrl.startsWith('/')) {
    return originalUrl;
  }
  
  // For external images, use the worker's image proxy
  const encodedUrl = encodeURIComponent(originalUrl);
  return `/proxy-image?url=${encodedUrl}`;
}

// React component for proxied images
export function ProxiedImage({ src, alt, className, ...props }) {
  const proxiedSrc = getProxiedImageUrl(src);
  
  if (!proxiedSrc) {
    return null;
  }
  
  return (
    <img 
      src={proxiedSrc} 
      alt={alt || 'Game image'} 
      className={className}
      onError={(e) => {
        // Fallback to original URL if proxy fails
        if (e.target.src !== src) {
          e.target.src = src;
        } else {
          // Hide image if both proxy and original fail
          e.target.style.display = 'none';
        }
      }}
      {...props}
    />
  );
}