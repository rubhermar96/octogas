import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { currentPrices, fuelEnum, pushAlerts, stations, type FuelKey } from "../db/schema";
import {
    MAX_STATIONS,
    configureWebPush,
    evaluate,
    isKey,
    isPushEndpoint,
    sendPush,
    vapidPublicKey,
} from "../alerts/core";

const FUEL_SET = new Set<string>(fuelEnum.enumValues);

interface AlertBody {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    endpoint?: unknown;
    fuel?: unknown;
    maxPrice?: unknown;
    stationIds?: unknown;
}

/** Precios de hoy de un combustible en esas gasolineras. */
async function pricesOf(fuel: FuelKey, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await db
        .select({ stationId: currentPrices.stationId, price: currentPrices.price })
        .from(currentPrices)
        .where(and(eq(currentPrices.fuel, fuel), inArray(currentPrices.stationId, ids)));
    return new Map(rows.map((r) => [r.stationId, r.price]));
}

/**
 * Avisos de precio de "Mis gasolineras" (ver alerts/core.ts). Sin cuentas: cada
 * navegador se identifica por su suscripción push.
 *   GET    /api/alerts/key   clave pública VAPID para suscribirse.
 *   PUT    /api/alerts       crea o actualiza el aviso de una suscripción.
 *   DELETE /api/alerts       lo borra ({ endpoint }).
 *   POST   /api/alerts/test  envía una notificación de prueba ({ endpoint }).
 */
export const alertRoutes: FastifyPluginAsync = async (app) => {
    app.get("/alerts/key", async (_req, reply) => {
        const key = vapidPublicKey();
        if (!key) return reply.code(503).send({ error: "Avisos no configurados" });
        return { publicKey: key };
    });

    app.put("/alerts", async (req, reply) => {
        const body = (req.body as AlertBody) ?? {};
        const endpoint = body.subscription?.endpoint;
        const p256dh = body.subscription?.keys?.p256dh;
        const auth = body.subscription?.keys?.auth;
        const { fuel, maxPrice, stationIds } = body;
        if (
            !isPushEndpoint(endpoint) ||
            !isKey(p256dh, 80, 100) ||
            !isKey(auth, 16, 30) ||
            typeof fuel !== "string" ||
            !FUEL_SET.has(fuel) ||
            typeof maxPrice !== "number" ||
            !(maxPrice >= 0.3 && maxPrice <= 30) ||
            !Array.isArray(stationIds) ||
            stationIds.length < 1 ||
            stationIds.length > MAX_STATIONS ||
            !stationIds.every((id) => typeof id === "string" && /^\d{1,8}$/.test(id))
        ) {
            return reply.code(400).send({ error: "Aviso no válido" });
        }

        // Solo gasolineras que existen.
        const ids = [...new Set(stationIds as string[])];
        const known = await db.select({ id: stations.id }).from(stations).where(inArray(stations.id, ids));
        const valid = known.map((s) => s.id);
        if (!valid.length) return reply.code(400).send({ error: "Ninguna gasolinera válida" });

        // Las que ya están por debajo se dan por avisadas (se le enseñan en la página): el
        // primer aviso llega cuando una baje del máximo o otro céntimo.
        const prices = await pricesOf(fuel as FuelKey, valid);
        const now = evaluate({ maxPrice, stationIds: valid, notified: {} }, prices);
        const values = {
            endpoint,
            p256dh,
            auth,
            fuel: fuel as FuelKey,
            maxPrice,
            stationIds: valid,
            notified: now.notified,
            updatedAt: new Date(),
        };
        await db
            .insert(pushAlerts)
            .values(values)
            .onConflictDoUpdate({ target: pushAlerts.endpoint, set: values });
        return { ok: true, below: now.toNotify };
    });

    app.delete("/alerts", async (req, reply) => {
        const { endpoint } = (req.body as AlertBody) ?? {};
        if (!isPushEndpoint(endpoint)) return reply.code(400).send({ error: "Suscripción no válida" });
        await db.delete(pushAlerts).where(eq(pushAlerts.endpoint, endpoint));
        return { ok: true };
    });

    app.post("/alerts/test", async (req, reply) => {
        const { endpoint } = (req.body as AlertBody) ?? {};
        if (!isPushEndpoint(endpoint)) return reply.code(400).send({ error: "Suscripción no válida" });
        if (!configureWebPush()) return reply.code(503).send({ error: "Avisos no configurados" });
        const [alert] = await db.select().from(pushAlerts).where(eq(pushAlerts.endpoint, endpoint)).limit(1);
        if (!alert) return reply.code(404).send({ error: "Sin aviso activo" });
        const result = await sendPush(alert, {
            title: "Avisos de OCTO activados",
            body: "Así te llegarán los avisos cuando tus gasolineras bajen de precio.",
            url: "/mis-gasolineras/",
            tag: "octo-prueba",
        });
        if (result === "gone") {
            await db.delete(pushAlerts).where(eq(pushAlerts.id, alert.id));
            return reply.code(410).send({ error: "La suscripción ya no existe" });
        }
        return result === "ok" ? { ok: true } : reply.code(502).send({ error: "No se pudo enviar" });
    });
};
