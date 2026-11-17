import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hhhThemeInit } from '@hhh/config/vite';

// Cloudflare Rocket Loader rewrites <script> tags and injects an inline loader to run
// them, which the strict CSP (script-src 'self') blocks. `data-cfasync="false"` tells it
// to leave the scripts alone. 'post': after hhhThemeInit has added its tag.
const cfAsyncFalse = {
  name: 'cf-async-false',
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      return html.replace(/<script /g, '<script data-cfasync="false" ');
    },
  },
};

export default defineConfig({
  // hhhThemeInit: applies the saved theme before first paint (no inline script).
  plugins: [react(), cfAsyncFalse, hhhThemeInit()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
      '/version': 'http://localhost:5000',
    },
  },
  build: { outDir: 'dist' },
});
