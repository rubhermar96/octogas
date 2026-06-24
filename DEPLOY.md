# Despliegue en Netlify (auto-deploy desde GitHub)

El proyecto ya está configurado para Netlify (ver `netlify.toml`). El build
regenera los datos del Ministerio y luego compila:
`npm run update-data && npm run build` → publica `dist/`.

## 1. Subir el código a GitHub

Crea un repositorio vacío en https://github.com/new (por ejemplo `octogas`,
privado o público) y conéctalo:

```bash
git remote add origin https://github.com/TU_USUARIO/octogas.git
git branch -M main
git push -u origin main
```

## 2. Conectar Netlify

1. Entra en https://app.netlify.com → **Add new site → Import an existing project**.
2. Elige **GitHub** y autoriza el acceso al repo `octogas`.
3. Netlify detectará la configuración de `netlify.toml`:
   - Build command: `npm run update-data && npm run build`
   - Publish directory: `dist`
4. Pulsa **Deploy**. El primer build tarda unos minutos (descarga datos + genera
   ~3.300 páginas).

Cada `git push` a `main` desplegará automáticamente.

## 3. Ajustar el dominio (importante para SEO)

Netlify te dará una URL tipo `https://NOMBRE.netlify.app`. Para que el canonical,
el sitemap y el Open Graph sean correctos:

1. Cambia `SITE_URL` en `astro.config.mjs` por tu URL real.
2. Cambia la línea `Sitemap:` en `public/robots.txt`.
3. `git commit` + `git push` (se redepliega solo).

Cuando tengas dominio propio, configúralo en Netlify (**Domain settings**) y
repite el paso 3 con el dominio definitivo.

## 4. Activar anuncios (cuando tengas AdSense)

1. En Netlify: **Site settings → Environment variables** → añade
   `PUBLIC_ADSENSE_ID = ca-pub-XXXXXXXXXXXXXXXX`.
2. Pon los `data-ad-slot` reales en los `<AdSlot slot="..." />`.
3. Redespliega. Los anuncios solo cargan tras aceptar el banner de cookies.

## Actualización diaria de precios (opcional, recomendado)

Para refrescar los precios cada día sin tocar nada, crea un **Build Hook** en
Netlify (**Build & deploy → Build hooks**) y dispáralo con un cron gratuito
(p. ej. GitHub Actions con `schedule`, o cron-job.org). Cada disparo relanza el
build, que vuelve a ejecutar `update-data`.
