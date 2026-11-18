// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// DDEV sets IS_DDEV_PROJECT in the web container: the dev server is reached through the ddev router
// (https://wyrfl.dev.dasachtegebot.local:4321/), so HMR has to connect via wss on that port.
const inDdev = process.env.IS_DDEV_PROJECT === 'true';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  outDir: './dist',
  // GitHub Pages serves the project under /wyrfl/ – the deploy workflow passes BASE_PATH (and SITE_URL)
  base: process.env.BASE_PATH || '/',
  ...(process.env.SITE_URL ? { site: process.env.SITE_URL } : {}),
  i18n: {
    locales: ['de', 'en'],
    defaultLocale: 'de',
    routing: { prefixDefaultLocale: false },
  },
  server: {
    host: '0.0.0.0',
    port: 4321,
    allowedHosts: true,
  },
  vite: {
    plugins: [tailwindcss()],
    server: inDdev ? { hmr: { protocol: 'wss', clientPort: 4321 } } : {},
  },
});
