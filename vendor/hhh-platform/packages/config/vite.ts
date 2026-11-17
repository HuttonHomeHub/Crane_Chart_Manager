// Vite plugin for every app: loads @hhh/ui's theme-init.js before first paint. The
// script must be a plain same-origin file (the CSP allows no inline script), so the
// plugin serves it at /theme-init.js in dev, emits it beside index.html in the build,
// and adds the <script> tag to the top of <head>.
//
//   import { hhhThemeInit } from '@hhh/config/vite';
//   export default defineConfig({ plugins: [react(), hhhThemeInit()] });
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export const THEME_INIT_URL = '/theme-init.js';

/** theme-init.js as the app installed it (resolved from the app's own root). */
export function themeInitPath(root = process.cwd()): string {
  return createRequire(join(root, 'package.json')).resolve('@hhh/ui/theme-init.js');
}

export function hhhThemeInit(options: { path?: string } = {}): Plugin {
  const read = () => readFileSync(options.path ?? themeInitPath(), 'utf8');
  return {
    name: 'hhh-theme-init',
    configureServer(server) {
      server.middlewares.use(THEME_INIT_URL, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(read());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'theme-init.js', source: read() });
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: THEME_INIT_URL }, injectTo: 'head-prepend' }];
    },
  };
}
