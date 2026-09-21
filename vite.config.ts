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
    // When the dev server is reached through an HTTPS reverse proxy, point HMR
    // at the public port (e.g. VITE_HMR_CLIENT_PORT=443). Locally we let the
    // client use the page origin (port 3000) so HMR works without a tunnel.
    const hmrClientPort = env.VITE_HMR_CLIENT_PORT ? Number(env.VITE_HMR_CLIENT_PORT) : undefined;
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
        hmr: hmrClientPort ? { clientPort: hmrClientPort } : undefined,
        proxy: {
          '/v1': {
            target: 'http://127.0.0.1:8090',
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
