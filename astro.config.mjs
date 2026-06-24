// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// Dominio de producción. Cuando lo tengas definitivo, cámbialo aquí (una sola línea)
// y se actualizan canonical, sitemap, Open Graph y robots.txt automáticamente.
export const SITE_URL = 'https://octogas.es';

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  integrations: [react(), sitemap()],
  output: 'static',
});
