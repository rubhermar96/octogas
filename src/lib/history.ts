import "dotenv/config";
import pg from "pg";

export interface PricePoint {
    t: number; // timestamp (ms)
    price: number;
}

/** Histórico por combustible de una gasolinera (solo los que graficamos). */
export interface StationHistory {
    sp95: PricePoint[];
    diesel: PricePoint[];
}

export type HistoryMap = Map<string, StationHistory>;

/** Combustibles que se grafican en la ficha (los más relevantes). */
const CHART_FUELS = ["sp95", "diesel"] as const;

let cache: Promise<HistoryMap> | null = null;

/**
 * Carga el histórico reciente de TODAS las gasolineras en UNA sola consulta y lo
 * agrupa por estación. Se cachea para que el build lo lea una vez.
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
            fuel: string;
            price: number;
            observed_at: Date;
        }>(
            `select station_id, fuel, price, observed_at
               from price_observations
              where observed_at >= $1
                and fuel = any($2)
              order by station_id, fuel, observed_at`,
            [since, CHART_FUELS as unknown as string[]]
        );

        for (const r of rows) {
            let h = map.get(r.station_id);
            if (!h) {
                h = { sp95: [], diesel: [] };
                map.set(r.station_id, h);
            }
            const point: PricePoint = { t: new Date(r.observed_at).getTime(), price: r.price };
            if (r.fuel === "sp95") h.sp95.push(point);
            else if (r.fuel === "diesel") h.diesel.push(point);
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
