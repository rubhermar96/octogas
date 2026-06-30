import "dotenv/config";
import { lt, sql } from "drizzle-orm";
import { db, pool } from "./db/client";
import { currentPrices, priceObservations, type FuelKey } from "./db/schema";

/**
 * Genera histórico SIMULADO (solo desarrollo) para poder ver la gráfica de la
 * ficha con datos. Crea ~17 puntos semanales (últimos ~120 días) por estación
 * para SP95 y diésel, con un paseo aleatorio alrededor del precio actual.
 *
 * Idempotente: borra primero las observaciones de días anteriores a hoy (deja la
 * del día actual, que es la real de la ingesta). Para limpiar del todo:
 *   TRUNCATE price_observations;  y vuelve a ejecutar `npm run ingest`.
 *
 * NO usar en producción.
 */
const DAY = 86_400_000;
const SEED_FUELS: FuelKey[] = ["sp95", "diesel"];
const WEEKS = 17;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function main() {
    console.log("Seed de histórico SIMULADO (solo desarrollo)…");

    // Borra histórico de días anteriores (deja el de hoy: la ingesta real).
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    await db.delete(priceObservations).where(lt(priceObservations.observedAt, startOfToday));

    const base = await db
        .select({ stationId: currentPrices.stationId, fuel: currentPrices.fuel, price: currentPrices.price })
        .from(currentPrices);

    const targets = base.filter((b) => SEED_FUELS.includes(b.fuel));
    console.log(`  Generando histórico para ${targets.length} estación-combustible…`);

    type Row = { stationId: string; fuel: FuelKey; price: number; observedAt: Date };
    const rows: Row[] = [];
    for (const t of targets) {
        const current = t.price;
        // Paseo aleatorio hacia el pasado partiendo del precio actual: así el punto
        // más reciente queda cerca del actual y enlaza de forma natural con "hoy".
        let price = current;
        for (let w = 1; w <= WEEKS; w++) {
            price = clamp(price + (Math.random() - 0.5) * 0.03, current * 0.85, current * 1.15);
            rows.push({
                stationId: t.stationId,
                fuel: t.fuel,
                price: round3(price),
                observedAt: new Date(Date.now() - w * 7 * DAY),
            });
        }
    }

    console.log(`  Insertando ${rows.length} observaciones…`);
    for (const batch of chunk(rows, 1000)) {
        await db.insert(priceObservations).values(batch);
    }

    const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(priceObservations);
    console.log(`Seed completado. Total de observaciones en la BD: ${count}`);
    await pool.end();
}

main().catch((err) => {
    console.error("Error en el seed:", err);
    process.exit(1);
});
