import "dotenv/config";
import pg from "pg";
import type { FuelType } from "../types/gasolinera";

export interface AggPoint {
    t: number;
    price: number;
}

/** Medias diarias por combustible de un ámbito (solo los que tienen datos). */
export type ScopeHistory = Partial<Record<FuelType, AggPoint[]>>;

export type AggMap = Map<string, ScopeHistory>;

/** Clave de un ámbito en el mapa (igual formato que en el backend). */
export function scopeKey(scopeType: "national" | "province" | "municipio", scopeId: string): string {
    return `${scopeType}::${scopeId}`;
}

let cache: Promise<AggMap> | null = null;

/**
 * Carga TODAS las medias diarias (todos los combustibles) por ámbito en una
 * consulta y las agrupa por ámbito. Cacheada para el build. Degrada con
 * elegancia sin BD.
 */
export function loadAggHistory(): Promise<AggMap> {
    if (!cache) cache = doLoad();
    return cache;
}

async function doLoad(): Promise<AggMap> {
    const url = process.env.DATABASE_URL;
    const map: AggMap = new Map();
    if (!url) {
        console.warn("[agg] Sin DATABASE_URL: páginas sin gráfica de medias.");
        return map;
    }

    const pool = new pg.Pool({ connectionString: url, max: 4 });
    try {
        // day::text evita el parseo de fecha de `pg` (que interpreta DATE en la
        // zona horaria local del proceso); con el texto YYYY-MM-DD, `new Date(...)`
        // lo interpreta como medianoche UTC de forma consistente para cualquiera.
        const { rows } = await pool.query<{
            scope_type: "national" | "province" | "municipio";
            scope_id: string;
            fuel: FuelType;
            avg_price: number;
            day: string;
        }>(
            `select scope_type, scope_id, fuel, avg_price, day::text as day
               from daily_price_avg
              order by scope_type, scope_id, fuel, day`
        );

        for (const r of rows) {
            const key = scopeKey(r.scope_type, r.scope_id);
            let h = map.get(key);
            if (!h) {
                h = {};
                map.set(key, h);
            }
            (h[r.fuel] ??= []).push({ t: new Date(r.day).getTime(), price: r.avg_price });
        }

        console.log(`[agg] ${rows.length} medias diarias cargadas para ${map.size} ámbitos.`);
        return map;
    } catch (err) {
        console.warn(`[agg] No se pudo leer las medias (${(err as Error).message}).`);
        return map;
    } finally {
        await pool.end();
    }
}
