import "dotenv/config";
import { readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pool } from "../db/client";
import { runIngest } from "./core";

/**
 * Reproduce en la BD (apuntada por DATABASE_URL) todos los snapshots diarios
 * archivados en /data-archive, en orden cronológico, cada uno con su fecha real
 * (no "ahora"). Pensado para cargar el histórico acumulado en local sobre la BD
 * de producción al desplegar.
 *
 * Antes de ejecutar: apunta DATABASE_URL (en api/.env) a la BD de destino.
 * Uso: npm run replay
 */
const ARCHIVE_DIR = process.env.ARCHIVE_DIR ?? resolve(process.cwd(), "../data-archive");
const FILE_RE = /^stations-(\d{4}-\d{2}-\d{2})\.json$/;

async function main() {
    const files = readdirSync(ARCHIVE_DIR)
        .map((f) => {
            const m = f.match(FILE_RE);
            return m ? { file: f, date: m[1] } : null;
        })
        .filter((x): x is { file: string; date: string } => x !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

    if (files.length === 0) {
        console.warn(
            `No se encontraron snapshots en ${ARCHIVE_DIR} (formato esperado: stations-YYYY-MM-DD.json).`
        );
        await pool.end();
        return;
    }

    console.log(`Replay: ${files.length} snapshots encontrados en ${ARCHIVE_DIR}\n`);
    let totalChanged = 0;
    for (const { file, date } of files) {
        // Mediodía UTC: una marca de tiempo estable por día, evita líos de zona horaria.
        const asOf = new Date(`${date}T12:00:00Z`);
        console.log(`→ ${date} (${file})`);
        const res = await runIngest(join(ARCHIVE_DIR, file), asOf);
        totalChanged += res.changedCount;
        console.log("");
    }

    console.log(`Replay completado: ${files.length} días, ${totalChanged} observaciones en total.`);
    await pool.end();
}

main().catch((err) => {
    console.error("Error en el replay:", err);
    process.exit(1);
});
