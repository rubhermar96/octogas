import fs from "node:fs";
import path from "node:path";

/**
 * Archiva una copia fechada de public/data/stations.json en /data-archive.
 * Forma parte de `npm run refresh`: cada vez que se actualizan los precios, se
 * guarda un snapshot del día para poder reproducirlo (api/src/ingest/replay.ts)
 * sobre la BD de producción en el despliegue, sin esperar a tenerla ya montada.
 */
const SRC = path.resolve("public/data/stations.json");
const DIR = path.resolve("data-archive");
const today = new Date().toISOString().slice(0, 10);
const dest = path.join(DIR, `stations-${today}.json`);

fs.mkdirSync(DIR, { recursive: true });
fs.copyFileSync(SRC, dest);
console.log(`OCTO Data: snapshot archivado en ${dest}`);
