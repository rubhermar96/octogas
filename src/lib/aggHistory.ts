import "dotenv/config";
import pg from "pg";

export interface AggPoint {
    t: number;
    price: number;
}

export interface ScopeHistory {
    sp95: AggPoint[];
    diesel: AggPoint[];
}

export type AggMap = Map<string, ScopeHistory>;

/** Clave de un ámbito en el mapa (igual formato que en el backend). */
export function scopeKey(scopeType: "national" | "province" | "municipio", scopeId: string): string {
    return `${scopeType}::${scopeId}`;
}

let cache: Promise<AggMap> | null = null;

/**
 * Carga TODAS las medias diarias por ámbito (sp95/diesel) en una consulta y las
 * agrupa por ámbito. Cacheada para el build. Degrada con elegancia sin BD.
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
        const { rows } = await pool.query<{
            scope_type: "national" | "province" | "municipio";
            scope_id: string;
            fuel: string;
            avg_price: number;
            day: string | Date;
        }>(
            `select scope_type, scope_id, fuel, avg_price, day
               from daily_price_avg
              where fuel in ('sp95','diesel')
              order by scope_type, scope_id, fuel, day`
        );

        for (const r of rows) {
            const key = scopeKey(r.scope_type, r.scope_id);
            let h = map.get(key);
            if (!h) {
                h = { sp95: [], diesel: [] };
                map.set(key, h);
            }
            const point: AggPoint = { t: new Date(r.day).getTime(), price: r.avg_price };
            if (r.fuel === "sp95") h.sp95.push(point);
            else if (r.fuel === "diesel") h.diesel.push(point);
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
