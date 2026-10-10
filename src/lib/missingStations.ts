/**
 * Gasolineras que hoy no vienen en los datos del Ministerio pero sí en algún día de los
 * últimos MISSING_GRACE_DAYS. Pasa cuando una gasolinera deja de publicar precios unos
 * días (obras, cambio de titular, un fallo al enviarlos): sin esto, su ficha y, si era
 * la única del pueblo, la página del municipio daban 404 de un día para otro y Google
 * acababa sacándolas del índice. Se mantienen con un aviso de "sin precios hoy" y sus
 * últimos precios con fecha; si pasan MISSING_GRACE_DAYS sin aparecer, se da por cerrada.
 *
 * Sale de los snapshots diarios de data-archive/ (los guarda `npm run refresh`). En la
 * integración continua no hay snapshots: la lista queda vacía y el build es el de hoy.
 */
import fs from "node:fs";
import path from "node:path";
import type { GasStation } from "../types/gasolinera";

export const MISSING_GRACE_DAYS = 30;

export interface MissingStation extends GasStation {
    /** Último día (AAAA-MM-DD) en que vino en los datos, con los precios de ese día. */
    lastSeen: string;
}

let cache: MissingStation[] | null = null;

export function loadMissingStations(today: GasStation[]): MissingStation[] {
    if (cache) return cache;
    const dir = path.resolve("data-archive");
    if (!fs.existsSync(dir)) return (cache = []);

    const cutoff = Date.now() - MISSING_GRACE_DAYS * 86_400_000;
    const active = new Set(today.map((s) => s.id));
    const found = new Map<string, MissingStation>();
    const snapshots = fs
        .readdirSync(dir)
        .filter((f) => /^stations-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .reverse(); // del más reciente al más antiguo: se queda el último registro de cada una

    for (const file of snapshots) {
        const day = file.slice(9, 19);
        if (Date.parse(day) < cutoff) break;
        let list: GasStation[];
        try {
            list = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        } catch {
            continue; // un snapshot dañado no debe tumbar el build
        }
        for (const s of list) {
            if (active.has(s.id) || found.has(s.id)) continue;
            if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || !s.province || !s.city) continue;
            found.set(s.id, { ...s, lastSeen: day });
        }
    }
    if (found.size) console.log(`[missing] ${found.size} gasolineras sin precios hoy mantienen su página (vistas en los últimos ${MISSING_GRACE_DAYS} días).`);
    return (cache = [...found.values()]);
}

/** "6 de octubre" (o "6 de octubre de 2026" si no es de este año). */
export function lastSeenLabel(day: string): string {
    const d = new Date(`${day}T12:00:00Z`);
    const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}
