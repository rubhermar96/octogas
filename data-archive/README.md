# Archivo de snapshots diarios

Cada vez que se ejecuta `npm run refresh` (raíz del proyecto), además de
actualizar `public/data/stations.json` y de ingestar en la BD local
(preproducción), se guarda aquí una copia fechada:

```
stations-2026-06-30.json
stations-2026-07-01.json
...
```

Los `.json` están en `.gitignore` (pesan varios MB cada uno) — este README sí
se versiona para que la carpeta no se pierda y quede documentado el flujo.

## Al desplegar (BD de producción limpia)

1. Copia esta carpeta (`data-archive/`) al VPS, o asegúrate de que el repo
   clonado allí la tiene con todos los snapshots acumulados.
2. En `api/.env`, apunta `DATABASE_URL` a la base de datos de **producción**.
3. Ejecuta:
   ```bash
   cd api
   npm run replay
   ```
   Esto reproduce todos los snapshots **en orden cronológico**, cada uno con su
   fecha real (no la fecha de cuando se ejecuta el replay), reconstruyendo el
   histórico de precios y las medias diarias por ámbito tal como ocurrieron.
4. A partir de ahí, sigue con la ingesta normal de cada día (`npm run ingest`,
   vía el cron/Action de producción) para seguir acumulando histórico real.

`npm run replay` es seguro de repetir (usa upserts), pero está pensado para
ejecutarse **una vez** sobre una BD recién creada.
