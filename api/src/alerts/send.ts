/**
 * Envío de los avisos de precio tras cada refresco (deploy/refresh.sh, cuando la web
 * con los precios nuevos ya está publicada: la notificación abre Mis gasolineras).
 *
 *     npm run alerts
 *
 * Por cada aviso: precios de hoy de sus gasolineras en su combustible (current_prices,
 * recién ingeridos), qué hay que avisar (core.ts → evaluate) y una notificación por
 * navegador como mucho. Las suscripciones que ya no existen se borran.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db/client";
import { currentPrices, pushAlerts, stations, type FuelKey } from "../db/schema";
import { buildMessage, configureWebPush, evaluate, sendPush, stationLabel } from "./core";

async function main() {
    if (!configureWebPush()) {
        console.log("[avisos] Sin claves VAPID en el .env: no se envían avisos.");
        return;
    }
    const alerts = await db.select().from(pushAlerts);
    if (!alerts.length) return console.log("[avisos] No hay avisos activos.");

    // Precios de hoy por combustible, solo de las gasolineras con algún aviso.
    const priceMaps = new Map<FuelKey, Map<string, number>>();
    for (const fuel of new Set(alerts.map((a) => a.fuel))) {
        const ids = [...new Set(alerts.filter((a) => a.fuel === fuel).flatMap((a) => a.stationIds))];
        const rows = await db
            .select({ stationId: currentPrices.stationId, price: currentPrices.price })
            .from(currentPrices)
            .where(and(eq(currentPrices.fuel, fuel), inArray(currentPrices.stationId, ids)));
        priceMaps.set(fuel, new Map(rows.map((r) => [r.stationId, r.price])));
    }
    const allIds = [...new Set(alerts.flatMap((a) => a.stationIds))];
    const info = new Map(
        (await db.select({ id: stations.id, brand: stations.brand, city: stations.city }).from(stations).where(inArray(stations.id, allIds))).map(
            (s) => [s.id, s]
        )
    );

    let sent = 0;
    let gone = 0;
    for (const alert of alerts) {
        const { toNotify, notified } = evaluate(alert, priceMaps.get(alert.fuel) ?? new Map());
        let lastSentAt = alert.lastSentAt;
        if (toNotify.length) {
            const found = toNotify.map((x) => ({ label: stationLabel(info.get(x.stationId) ?? { brand: "", city: "" }), price: x.price }));
            const result = await sendPush(alert, buildMessage(alert.fuel, alert.maxPrice, found, alert.stationIds.length));
            if (result === "gone") {
                await db.delete(pushAlerts).where(eq(pushAlerts.id, alert.id));
                gone++;
                continue;
            }
            // Si falla por otra causa, no se da por avisado: se reintenta en el próximo refresco.
            if (result !== "ok") continue;
            sent++;
            lastSentAt = new Date();
        }
        await db.update(pushAlerts).set({ notified, lastSentAt }).where(eq(pushAlerts.id, alert.id));
    }
    console.log(
        `[avisos] ${alerts.length === 1 ? "1 aviso activo" : `${alerts.length} avisos activos`}: ${sent} notificaciones enviadas, ${gone} suscripciones caducadas borradas.`
    );
}

main()
    .catch((err) => {
        console.error(`[avisos] Error: ${(err as Error).message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
