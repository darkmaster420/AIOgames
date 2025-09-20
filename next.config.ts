import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  
  // Optimize images for production
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'via.placeholder.com',
      },
      {
        protocol: 'https',
        hostname: 'gameapi.a7a8524.workers.dev',
      },
      {
        protocol: 'https',
        hostname: '*.steamstatic.com',
      },
      {
        protocol: 'https',
        hostname: '*.akamaihd.net',
      },
      {
        protocol: 'https',
        hostname: '*.cloudflare.com',
      },
      // Allow any HTTPS domain for debugging
      {
        protocol: 'https',
        hostname: '**',
      }
    ],
    unoptimized: true, // Use our custom implementation
  },
  
  // Environment variable configuration
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
};

export default nextConfig;
