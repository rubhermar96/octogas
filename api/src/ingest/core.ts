import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { stations, currentPrices, priceObservations, dailyPriceAvg, fuelEnum, type FuelKey } from "../db/schema";
import { computeScopeAverages } from "../rollup";

const FUELS: FuelKey[] = [...fuelEnum.enumValues];

interface RawStation {
    id: string;
    name: string;
    brand: string;
    address: string;
    city: string;
    province: string;
    postalCode: string;
    idMunicipio: string;
    idProvincia: string;
    lat: number;
    lng: number;
    saleType: string;
    schedule: string;
    prices: Record<FuelKey, number | null>;
}

/** Compara precios redondeando a 3 decimales (evita falsos cambios por float). */
const milli = (n: number) => Math.round(n * 1000);

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export interface IngestResult {
    stationCount: number;
    changedCount: number;
}

/**
 * Procesa un snapshot de stations.json: upsert de estaciones, detecta cambios de
 * precio frente al último conocido en la BD e inserta el histórico + rollup
 * fechados en `asOf` (no necesariamente "ahora": permite reproducir snapshots
 * archivados con su fecha real, ver replay.ts).
 */
export async function runIngest(stationsPath: string, asOf: Date): Promise<IngestResult> {
    const raw = JSON.parse(readFileSync(stationsPath, "utf-8")) as RawStation[];
    console.log(`  Leyendo ${raw.length} estaciones de ${stationsPath}`);

    // 1) Upsert de las gasolineras (datos descriptivos).
    const stationRows = raw.map((s) => ({
        id: s.id,
        name: s.name ?? "",
        brand: s.brand ?? "",
        address: s.address ?? "",
        city: s.city ?? "",
        province: s.province ?? "",
        postalCode: s.postalCode ?? "",
        idMunicipio: s.idMunicipio ?? "",
        idProvincia: s.idProvincia ?? "",
        lat: s.lat,
        lng: s.lng,
        saleType: s.saleType ?? "",
        schedule: s.schedule ?? "",
        updatedAt: asOf,
    }));
    for (const batch of chunk(stationRows, 500)) {
        await db
            .insert(stations)
            .values(batch)
            .onConflictDoUpdate({
                target: stations.id,
                set: {
                    name: sql`excluded.name`,
                    brand: sql`excluded.brand`,
                    address: sql`excluded.address`,
                    city: sql`excluded.city`,
                    province: sql`excluded.province`,
                    postalCode: sql`excluded.postal_code`,
                    idMunicipio: sql`excluded.id_municipio`,
                    idProvincia: sql`excluded.id_provincia`,
                    lat: sql`excluded.lat`,
                    lng: sql`excluded.lng`,
                    saleType: sql`excluded.sale_type`,
                    schedule: sql`excluded.schedule`,
                    updatedAt: sql`excluded.updated_at`,
                },
            });
    }
    console.log(`  ✓ ${stationRows.length} gasolineras al día`);

    // 2) Último precio conocido (en memoria) para detectar cambios.
    const current = await db
        .select({
            stationId: currentPrices.stationId,
            fuel: currentPrices.fuel,
            price: currentPrices.price,
        })
        .from(currentPrices);
    const lastPrice = new Map<string, number>();
    for (const c of current) lastPrice.set(`${c.stationId}|${c.fuel}`, c.price);

    // 3) Diferencia: recoger observaciones nuevas y precios a actualizar.
    type Row = { stationId: string; fuel: FuelKey; price: number };
    const changed: Row[] = [];
    for (const s of raw) {
        for (const fuel of FUELS) {
            const price = s.prices?.[fuel];
            if (price == null) continue;
            const key = `${s.id}|${fuel}`;
            const prev = lastPrice.get(key);
            if (prev === undefined || milli(prev) !== milli(price)) {
                changed.push({ stationId: s.id, fuel, price });
            }
        }
    }
    console.log(`  → ${changed.length} cambios de precio detectados`);

    // Rollup: media de precio del día por ámbito (nacional/provincia/municipio).
    // Se registra siempre (haya o no cambios de precio individuales).
    const day = dayStr(asOf);
    const avgs = computeScopeAverages(raw);
    for (const batch of chunk(avgs, 1000)) {
        await db
            .insert(dailyPriceAvg)
            .values(batch.map((a) => ({ ...a, day })))
            .onConflictDoUpdate({
                target: [dailyPriceAvg.scopeType, dailyPriceAvg.scopeId, dailyPriceAvg.fuel, dailyPriceAvg.day],
                set: { avgPrice: sql`excluded.avg_price`, n: sql`excluded.n` },
            });
    }
    console.log(`  ✓ ${avgs.length} medias por ámbito (rollup) del ${day}`);

    if (changed.length === 0) {
        console.log("  (sin cambios de precio individuales)");
        return { stationCount: raw.length, changedCount: 0 };
    }

    // 4a) Insertar en el histórico (solo los cambios), fechado en asOf.
    for (const batch of chunk(changed, 2000)) {
        await db.insert(priceObservations).values(batch.map((r) => ({ ...r, observedAt: asOf })));
    }

    // 4b) Upsert del último precio conocido.
    for (const batch of chunk(changed, 2000)) {
        await db
            .insert(currentPrices)
            .values(batch.map((r) => ({ ...r, updatedAt: asOf })))
            .onConflictDoUpdate({
                target: [currentPrices.stationId, currentPrices.fuel],
                set: { price: sql`excluded.price`, updatedAt: sql`excluded.updated_at` },
            });
    }

    console.log(`  ✓ ${changed.length} observaciones añadidas (${day})`);
    return { stationCount: raw.length, changedCount: changed.length };
}
