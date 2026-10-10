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
  // Una sola versión de cada URL: con barra final, como el canonical y el sitemap.
  // Los enlaces internos se escriben así (scripts/check-site.mjs lo comprueba) y Nginx
  // redirige con 301 la versión sin barra.
  trailingSlash: 'always',
  // Astro 7 cambió el valor por defecto a 'jsx' (reglas de espacios de React): un
  // enlace escrito en una línea nueva se pegaría a la palabra anterior ("y en
  // laPolítica de cookies"). true mantiene el comportamiento con el que se
  // escribieron todas las páginas: compacta sin perder los espacios necesarios.
  compressHTML: true,
  vite: {
    // Caché de Vite separada para el build: si comparte node_modules/.vite con un
    // `astro dev` en marcha, el build la regenera y el servidor de desarrollo se queda
    // sirviendo dependencias obsoletas (504 "Outdated Optimize Dep": las islas de
    // React, como los mapas, dejan de cargar).
    cacheDir: process.argv.includes('build') ? 'node_modules/.vite-build' : 'node_modules/.vite',
  },
  // Precarga las páginas enlazadas al pasar el ratón por encima: la navegación
  // entre páginas estáticas se siente instantánea sin coste en la carga inicial.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
