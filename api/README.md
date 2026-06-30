# Octogas API

Backend de Octogas: **Fastify + Postgres + Drizzle**. Guarda el **histórico de
precios** (solo cambios) y expone una **API REST** para la web y la futura app móvil.

## Arquitectura

- **Postgres** con 3 tablas (ver `src/db/schema.ts`):
  - `stations` — espejo de las gasolineras (se upserta en cada ingesta).
  - `current_prices` — último precio conocido por estación+combustible.
  - `price_observations` — histórico; se inserta **solo cuando el precio cambia**.
- **Ingesta** (`src/ingest`): lee el `stations.json` que genera la web, lo compara
  con `current_prices` e inserta únicamente los cambios. Pensado para correr a
  diario después de `npm run update-data` de la web.
- **API** (`src/server.ts`): Fastify con CORS. La web la usa en build (hornear la
  gráfica de la ficha) y la app móvil en runtime.

## Desarrollo local

Requiere Docker (para Postgres) y Node 20+.

```bash
# 1) Postgres local (desde la raíz del repo)
docker compose up -d db

# 2) Dependencias y entorno (desde /api)
cd api
npm install
cp .env.example .env

# 3) Crear el esquema en la BD
npm run db:push

# 4) Ingesta inicial (necesita ../public/data/stations.json -> `npm run update-data` en la web)
npm run ingest

# 5) Arrancar la API
npm run dev
# http://localhost:3001/health
```

## Endpoints

- `GET /health`
- `GET /api/stations/:id` — ficha + precios actuales.
- `GET /api/stations/:id/history?fuel=sp95&days=90` — histórico de precios.

## Producción (VPS)

1. Postgres en el VPS (o gestionado), con `DATABASE_URL` en el `.env`.
2. `npm run db:migrate` (genera con `npm run db:generate` y versiona la carpeta `drizzle/`).
3. Servir con `npm run start` detrás de un reverse proxy (Nginx/Caddy) + systemd/PM2.
4. La GitHub Action diaria: tras generar `stations.json`, ejecutar `npm run ingest`
   contra la BD de producción (con `DATABASE_URL` en los secrets).
