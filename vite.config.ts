/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/viva-la-cresta/',
  plugins: [
    VitePWA({
      // Updates install when the app says so: never in the middle of a ride (see main.ts).
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'smtc-logo.svg'],
      manifest: {
        name: 'Viva la Cresta',
        short_name: 'Cresta',
        description: 'Ride the Cresta Run, from Beginner Day to the Grand National.',
        theme_color: '#930303',
        background_color: '#eef3f8',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,jpg}'],
        // The club's typefaces (Outfit, Habibi) from Google Fonts, kept for offline play.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 } },
          },
          {
            // The Blender models: too big to precache. Fetched fresh whenever there's a connection (so
            // a changed model shows at once), the cached copy when offline or the network is slow.
            urlPattern: /\/models\/.*\.glb$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'models', networkTimeoutSeconds: 8, expiration: { maxEntries: 30 } },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
