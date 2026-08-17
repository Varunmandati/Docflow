import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
    // Server-side only: the internal stream-service token is read here so the Vite
    // dev proxy can forward it to the upload server. It is never exposed to
    // the client bundle (no VITE_ prefix, not injected via define).
    const env = loadEnv(mode, '.', '');
    const stream-serviceToken = env.STREAM_INTERNAL_TOKEN || '';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
        hmr: {
          clientPort: 443
        },
        proxy: {
          '/v1': {
            target: 'http://127.0.0.1:8080',
            changeOrigin: true,
            rewrite: (path) => path
          },
          '/api/uploads': {
            target: 'http://127.0.0.1:3002',
            changeOrigin: true,
            rewrite: (path) => path,
            configure: (proxy) => {
              proxy.on('proxyReq', (proxyReq) => {
                if (stream-serviceToken) {
                  proxyReq.setHeader('X-Internal-Token', stream-serviceToken);
                }
              });
            }
          }
        }
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
