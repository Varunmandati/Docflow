import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
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
