import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3458,
    open: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: { target: 'esnext' },
});
