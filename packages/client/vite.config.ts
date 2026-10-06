import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // 本番では同じコンテナがこの画面とAPIの両方を返すので、起点は常に '/'。
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      // @ec-ai/shared は本番のNode向けに dist を指しているが、
      // 画面の開発ではソースを直接読ませる（sharedを直したら即反映される）。
      '@ec-ai/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 手元の開発では、画面は5173番・サーバーは8080番で別々に動く。
      // '/api' と '/auth' をサーバーへ中継して、本番と同じ見え方にする
      // （別オリジンになるとCookieの扱いが変わり、本番と違う挙動になってしまう）。
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/auth': { target: 'http://localhost:8080', changeOrigin: true },
      '/logged-out': { target: 'http://localhost:8080', changeOrigin: true },
      '/healthz': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
