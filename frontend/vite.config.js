import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env file from root directory
  const env = loadEnv(mode, path.resolve(process.cwd(), '..'), '');

  return {
    plugins: [react()],
    define: {
      // Make env variables available in frontend code
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.VITE_API_URL': JSON.stringify(env.API_URL || 'http://localhost:2000'),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:2000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:2000',
          ws: true,
        },
      },
    },
  };
});