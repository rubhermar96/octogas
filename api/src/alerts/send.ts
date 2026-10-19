/**
 * Envío de los avisos de "Mis gasolineras" tras cada refresco (deploy/refresh.sh, cuando
 * la web con los precios nuevos ya está publicada: la notificación abre la página).
 *
 *     npm run alerts
 *
 * Por cada navegador suscrito, con los precios de hoy (current_prices, recién ingeridos)
 * y el historial de cambios (price_observations):
 *   - bajadas de precio, automático (core.ts → evaluateAuto, como mucho uno cada 3 días);
 *   - resumen de la más barata, diario o semanal (core.ts → digestDue).
 * Las suscripciones que ya no existen se borran.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, pool } from "../db/client";
import { currentPrices, priceObservations, pushAlerts, stations, type FuelKey } from "../db/schema";
import {
    AUTO_COOLDOWN_MS,
    buildAutoMessage,
    buildDigestMessage,
    configureWebPush,
    digestDue,
    evaluateAuto,
    priceAt,
    sendPush,
    stationLabel,
    type History,
    type PushMessage,
} from "./core";

const DAY = 86_400_000;

async function main() {
    if (!configureWebPush()) {
        console.log("[avisos] Sin claves VAPID en el .env: no se envían avisos.");
        return;
    }
    const alerts = await db.select().from(pushAlerts);
    if (!alerts.length) return console.log("[avisos] No hay avisos activos.");
    const now = Date.now();

    // Precios de hoy e historial (45 días, para comparar con el último mes y con hace una
    // semana) por combustible, solo de las gasolineras con algún aviso.
    const priceMaps = new Map<FuelKey, Map<string, number>>();
    const histories = new Map<FuelKey, Map<string, History>>();
    for (const fuel of new Set(alerts.map((a) => a.fuel))) {
        const ids = [...new Set(alerts.filter((a) => a.fuel === fuel).flatMap((a) => a.stationIds))];
        const rows = await db
            .select({ stationId: currentPrices.stationId, price: currentPrices.price })
            .from(currentPrices)
            .where(and(eq(currentPrices.fuel, fuel), inArray(currentPrices.stationId, ids)));
        priceMaps.set(fuel, new Map(rows.map((r) => [r.stationId, r.price])));
        const obs = await db
            .select({ stationId: priceObservations.stationId, price: priceObservations.price, observedAt: priceObservations.observedAt })
            .from(priceObservations)
            .where(
                and(
                    eq(priceObservations.fuel, fuel),
                    inArray(priceObservations.stationId, ids),
                    gte(priceObservations.observedAt, new Date(now - 75 * DAY))
                )
            )
            .orderBy(priceObservations.observedAt);
        const byStation = new Map<string, History>();
        for (const o of obs) (byStation.get(o.stationId) ?? byStation.set(o.stationId, []).get(o.stationId)!).push({ t: o.observedAt.getTime(), price: o.price });
        histories.set(fuel, byStation);
    }
    const allIds = [...new Set(alerts.flatMap((a) => a.stationIds))];
    const info = new Map(
        (await db.select({ id: stations.id, brand: stations.brand, city: stations.city }).from(stations).where(inArray(stations.id, allIds))).map(
            (s) => [s.id, s]
        )
    );
    const label = (id: string) => stationLabel(info.get(id) ?? { brand: "", city: "" });

    let drops = 0;
    let digests = 0;
    let gone = 0;
    for (const alert of alerts) {
        const prices = priceMaps.get(alert.fuel) ?? new Map<string, number>();
        const history = histories.get(alert.fuel) ?? new Map<string, History>();
        const cheapestId = [...alert.stationIds].filter((id) => prices.has(id)).sort((a, b) => prices.get(a)! - prices.get(b)!)[0];

        // 1. Bajadas de precio.
        let notified = alert.notified;
        let dropMessage: PushMessage | undefined;
        let markNotified: Record<string, number> = {};
        // Los guardados con aviso por precio máximo (ya no existe) van en automático.
        if (alert.mode !== "none") {
            const r = evaluateAuto(alert, prices, history, now);
            notified = r.notified;
            const best = r.candidates[0];
            const resting = alert.lastSentAt && now - alert.lastSentAt.getTime() < AUTO_COOLDOWN_MS;
            if (best && !resting) {
                dropMessage = buildAutoMessage(alert.fuel, best, label(best.stationId), best.stationId === cheapestId);
                markNotified = { [best.stationId]: best.price };
            }
        }

        // 2. Resumen de la más barata.
        let digestMessage: PushMessage | undefined;
        const digestNow = digestDue(alert, now);
        if (digestNow && cheapestId && (alert.digest === "daily" || alert.digest === "weekly")) {
            const back = alert.digest === "daily" ? DAY : 7 * DAY;
            const rows = alert.stationIds
                .filter((id) => prices.has(id))
                .map((id) => ({ label: label(id), price: prices.get(id)!, before: priceAt(history.get(id) ?? [], now - back) }))
                .sort((a, b) => a.price - b.price);
            digestMessage = buildDigestMessage(alert.fuel, alert.digest, rows);
        }

        // 3. Envío (como mucho una bajada y un resumen).
        let dropSent = false;
        let digestSent = false;
        let isGone = false;
        for (const [msg, kind] of [
            [dropMessage, "drop"],
            [digestMessage, "digest"],
        ] as const) {
            if (!msg || isGone) continue;
            const result = await sendPush(alert, msg);
            if (result === "gone") isGone = true;
            else if (result === "ok") {
                if (kind === "drop") dropSent = true;
                else digestSent = true;
            }
        }
        if (isGone) {
            await db.delete(pushAlerts).where(eq(pushAlerts.id, alert.id));
            gone++;
            continue;
        }
        // Lo que no se pudo enviar por otra causa no se da por avisado: se reintenta en el
        // próximo refresco.
        if (dropSent) notified = { ...notified, ...markNotified };
        if (dropSent) drops++;
        if (digestSent) digests++;
        await db
            .update(pushAlerts)
            .set({
                notified,
                lastSentAt: dropSent ? new Date(now) : alert.lastSentAt,
                // Sin gasolineras con precio hoy no hay resumen: se da por hecho igualmente.
                lastDigestAt: digestSent || (digestNow && !cheapestId) ? new Date(now) : alert.lastDigestAt,
            })
            .where(eq(pushAlerts.id, alert.id));
    }
    const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
    console.log(
        `[avisos] ${n(alerts.length, "navegador suscrito", "navegadores suscritos")}: ${n(drops, "aviso de bajada", "avisos de bajada")} y ${n(digests, "resumen", "resúmenes")} enviados, ${n(gone, "suscripción caducada borrada", "suscripciones caducadas borradas")}.`
    );
}

main()
    .catch((err) => {
        console.error(`[avisos] Error: ${(err as Error).message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
