import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env file from current directory
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      // Make env variables available in frontend code
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || 'http://localhost:4000'),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:4000',
          ws: true,
        },
        '/proxy-image': {
          target: 'http://localhost:4000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/proxy-image/, '/api/proxy-image')
        },
      },
    },
  };
});