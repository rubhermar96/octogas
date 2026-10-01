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

## Al desplegar

Esta carpeta ES el histórico real de precios: copia su contenido al VPS
(`scp -r data-archive octo@IP:/srv/octogas/`) y `deploy/setup.sh` la reproduce con
`npm run replay` en orden cronológico, cada snapshot con su fecha real. Ver el paso 4
de [DEPLOY.md](../DEPLOY.md).

No uses un volcado de la BD local en su lugar: tiene precios simulados anteriores
al 30 de junio de 2026 (`api/src/seed-history.ts`).

En el servidor, el temporizador `octogas-refresh` sigue archivando aquí un snapshot
por día.
