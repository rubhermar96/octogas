import "dotenv/config";
import pg from "pg";
import type { FuelType } from "../types/gasolinera";

export interface PricePoint {
    t: number; // timestamp (ms)
    price: number;
}

/** Histórico por combustible de una gasolinera (solo los que tienen datos). */
export type StationHistory = Partial<Record<FuelType, PricePoint[]>>;

export type HistoryMap = Map<string, StationHistory>;

let cache: Promise<HistoryMap> | null = null;

/**
 * Carga el histórico reciente de TODOS los combustibles de TODAS las
 * gasolineras en UNA sola consulta y lo agrupa por estación. Se cachea para
 * que el build lo lea una vez.
 *
 * Degrada con elegancia: si no hay DATABASE_URL o la BD no responde, devuelve un
 * mapa vacío y el build sigue (fichas sin gráfica) sin romperse.
 */
export function loadPriceHistory(days = 1460): Promise<HistoryMap> {
    if (!cache) cache = doLoad(days);
    return cache;
}

async function doLoad(days: number): Promise<HistoryMap> {
    const url = process.env.DATABASE_URL;
    const map: HistoryMap = new Map();
    if (!url) {
        console.warn("[history] Sin DATABASE_URL: las fichas se generan sin gráfica de histórico.");
        return map;
    }

    const pool = new pg.Pool({ connectionString: url, max: 4 });
    try {
        const since = new Date(Date.now() - days * 86_400_000);
        const { rows } = await pool.query<{
            station_id: string;
            fuel: FuelType;
            price: number;
            observed_at: Date;
        }>(
            `select station_id, fuel, price, observed_at
               from price_observations
              where observed_at >= $1
              order by station_id, fuel, observed_at`,
            [since]
        );

        for (const r of rows) {
            let h = map.get(r.station_id);
            if (!h) {
                h = {};
                map.set(r.station_id, h);
            }
            (h[r.fuel] ??= []).push({ t: new Date(r.observed_at).getTime(), price: r.price });
        }

        console.log(`[history] ${rows.length} observaciones cargadas para ${map.size} gasolineras.`);
        return map;
    } catch (err) {
        console.warn(`[history] No se pudo leer el histórico (${(err as Error).message}). Fichas sin gráfica.`);
        return map;
    } finally {
        await pool.end();
    }
}
