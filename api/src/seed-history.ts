import "dotenv/config";
import { lt, sql } from "drizzle-orm";
import { db, pool } from "./db/client";
import { currentPrices, priceObservations, dailyPriceAvg, fuelEnum, type FuelKey } from "./db/schema";

/**
 * Genera histórico SIMULADO (solo desarrollo) para poder ver la gráfica de la
 * ficha con datos. Crea ~17 puntos semanales (últimos ~120 días) por estación
 * y combustible (todos, no solo SP95/diésel), con un paseo aleatorio alrededor
 * del precio actual.
 *
 * Idempotente: borra primero las observaciones de días anteriores a hoy (deja la
 * del día actual, que es la real de la ingesta). Para limpiar del todo:
 *   TRUNCATE price_observations;  y vuelve a ejecutar `npm run ingest`.
 *
 * NO usar en producción.
 */
const DAY = 86_400_000;
const SEED_FUELS: FuelKey[] = [...fuelEnum.enumValues];
const WEEKS = 17;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function main() {
    // Este script BORRA el histórico real anterior a hoy y lo sustituye por precios
    // inventados: nunca en producción (setup.sh pone NODE_ENV=production en api/.env)
    // y, en desarrollo, solo pidiéndolo explícitamente.
    if (process.env.NODE_ENV === "production") {
        console.error("Seed simulado bloqueado: NODE_ENV=production. Borraría el histórico real.");
        process.exit(1);
    }
    if (!process.argv.includes("--simulado")) {
        console.error(
            "Este script BORRA el histórico anterior a hoy y lo sustituye por precios inventados.\n" +
                "Si es lo que quieres (solo en una BD de desarrollo), ejecuta: npm run seed -- --simulado"
        );
        process.exit(1);
    }
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

    // --- Histórico simulado de medias por ámbito (daily_price_avg) ---
    const todayStr = new Date().toISOString().slice(0, 10);
    await db.delete(dailyPriceAvg).where(lt(dailyPriceAvg.day, todayStr));
    const anchors = await db
        .select({
            scopeType: dailyPriceAvg.scopeType,
            scopeId: dailyPriceAvg.scopeId,
            fuel: dailyPriceAvg.fuel,
            avgPrice: dailyPriceAvg.avgPrice,
            n: dailyPriceAvg.n,
        })
        .from(dailyPriceAvg);

    if (anchors.length === 0) {
        console.warn("  (Sin medias de hoy: ejecuta antes `npm run ingest` para el rollup. Salto el histórico de medias.)");
    } else {
        const aggRows: (typeof dailyPriceAvg.$inferInsert)[] = [];
        for (const a of anchors) {
            let price = a.avgPrice;
            for (let w = 1; w <= WEEKS; w++) {
                price = clamp(price + (Math.random() - 0.5) * 0.02, a.avgPrice * 0.9, a.avgPrice * 1.1);
                aggRows.push({
                    scopeType: a.scopeType,
                    scopeId: a.scopeId,
                    fuel: a.fuel,
                    avgPrice: round3(price),
                    n: a.n,
                    day: new Date(Date.now() - w * 7 * DAY).toISOString().slice(0, 10),
                });
            }
        }
        console.log(`  Insertando ${aggRows.length} medias históricas por ámbito…`);
        for (const batch of chunk(aggRows, 1000)) {
            await db.insert(dailyPriceAvg).values(batch);
        }
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
