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
  integrations: [
    react(),
    sitemap({
      // La página de error no debe aparecer en el sitemap.
      filter: (page) => !page.includes('/404'),
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
