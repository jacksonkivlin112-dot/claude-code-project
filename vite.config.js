import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // ESPN blocks cross-origin browser requests; proxy it in development.
    proxy: {
      '/espn-api': {
        target: 'https://site.api.espn.com/apis',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/espn-api/, ''),
      },
    },
  },
});
