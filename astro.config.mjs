// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// After the build: fill in the service worker's version (hash of every file) and its precache list (dist/sw.js).
// Same content → same version → no needless reinstall on the players' devices. See public/sw.js.
function serviceWorker() {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  return {
    name: 'wyrfl-service-worker',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const files = walk(root)
          .map(f => relative(root, f).split(sep).join('/'))
          .filter(f => f !== 'sw.js' && !f.endsWith('.map') && !f.endsWith('.txt') && !f.startsWith('.'))
          .sort();
        // no HTML comments in the published pages – write comments in .astro templates as {/* … */}
        const commented = files.filter(f => f.endsWith('.html') && readFileSync(join(root, f), 'utf8').includes('<!--'));
        if (commented.length) throw new Error(`HTML comments in the build (use {/* … */} in .astro): ${commented.slice(0, 5).join(', ')}`);
        const hash = createHash('sha256');
        for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
        const build = hash.digest('hex').slice(0, 16);
        const urls = files.map(f => `./${f.replace(/(^|\/)index\.html$/, '$1')}`);
        const sw = join(root, 'sw.js');
        const source = readFileSync(sw, 'utf8');
        if (!source.includes('__WYRFL_BUILD__') || !source.includes('[] /*__WYRFL_PRECACHE__*/')) {
          throw new Error('dist/sw.js: placeholders missing – public/sw.js must keep __WYRFL_BUILD__ and [] /*__WYRFL_PRECACHE__*/');
        }
        writeFileSync(sw, source.replace("'__WYRFL_BUILD__'", JSON.stringify(build)).replace('[] /*__WYRFL_PRECACHE__*/', JSON.stringify(urls)));
        logger.info(`service worker: build ${build}, ${urls.length} files precached`);
      },
    },
  };
}

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
  integrations: [serviceWorker()],
  i18n: {
    locales: ['de', 'en', 'fr', 'es', 'hr', 'pl', 'cs'],
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
    // flags always as their own files (not inlined as data URI): loaded only when shown, cached like every file
    build: { assetsInlineLimit: file => (file.includes('flag-icons') ? false : undefined) },
  },
});
