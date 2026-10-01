// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// Dominio de producción. Cuando lo tengas definitivo, cámbialo aquí (una sola línea)
// y se actualizan canonical, sitemap, Open Graph y robots.txt automáticamente.
export const SITE_URL = 'https://octogas.es';

// Páginas con noindex={true} en su <Layout> (si añades otra, inclúyela aquí).
const NOINDEX_PATHS = ['/404', '/privacidad/', '/cookies/', '/aviso-legal/'];

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  integrations: [
    react(),
    sitemap({
      // Fuera del sitemap las páginas marcadas noindex (error y legales): listarlas
      // y a la vez pedir que no se indexen hace que Search Console avise de errores.
      filter: (page) => !NOINDEX_PATHS.some((p) => new URL(page).pathname.startsWith(p)),
    }),
  ],
  output: 'static',
  // Precarga las páginas enlazadas al pasar el ratón por encima: la navegación
  // entre páginas estáticas se siente instantánea sin coste en la carga inicial.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
