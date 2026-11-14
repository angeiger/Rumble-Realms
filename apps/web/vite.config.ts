import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const THEME_COLOR = '#1d3f9c';

/** Short commit id: Vercel env first, then local git; empty string if neither is available. */
function buildId(): string {
  const fromEnv = process.env['VERCEL_GIT_COMMIT_SHA'];
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/**
 * Dev and preview share one origin (localhost:5173). A service worker installed by a
 * preview build would otherwise keep serving its cached app shell to the dev server.
 * In dev we therefore answer /sw.js with a worker that unregisters itself, clears the
 * caches and reloads open pages (D-015).
 */
const SELF_DESTROYING_SW = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
      for (const client of await self.clients.matchAll({ type: 'window' })) {
        client.navigate(client.url);
      }
    })(),
  );
});
`;

function removeStaleServiceWorkerInDev(): Plugin {
  return {
    name: 'rumble-realms:remove-stale-sw-in-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(SELF_DESTROYING_SW);
      });
    },
  };
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  // Bound to IPv4 loopback only; reached from outside the VM through an SSH tunnel.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  // Hashed build output goes to /static so that /assets stays free for sprites (D-014).
  build: { assetsDir: 'static' },
  plugins: [
    react(),
    removeStaleServiceWorkerInDev(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Rumble Realms',
        short_name: 'Rumble Realms',
        description: 'Ein Karten-Kampfspiel im Comic-Fantasy-Stil.',
        lang: 'de',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        theme_color: THEME_COLOR,
        background_color: THEME_COLOR,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
});
