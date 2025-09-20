import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  
  // Optimize images for production
  images: {
    domains: [
      'via.placeholder.com', 
      'gameapi.a7a8524.workers.dev',
      'cdn.cloudflare.steamstatic.com',
      'steamcdn-a.akamaihd.net',
      'shared.cloudflare.steamstatic.com'
    ],
    unoptimized: true, // Use our custom proxy instead
  },
  
  // Environment variable configuration
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
};

export default nextConfig;
