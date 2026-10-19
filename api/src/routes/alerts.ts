import type { FastifyPluginAsync } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { fuelEnum, pushAlerts, stations, type FuelKey } from "../db/schema";
import { MAX_STATIONS, isKey, isPushEndpoint, vapidPublicKey } from "../alerts/core";

const FUEL_SET = new Set<string>(fuelEnum.enumValues);

interface AlertBody {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    endpoint?: unknown;
    fuel?: unknown;
    mode?: unknown;
    digest?: unknown;
    digestDay?: unknown;
    stationIds?: unknown;
}

const DIGESTS = new Set(["none", "daily", "weekly"]);

/**
 * Avisos de "Mis gasolineras" (ver alerts/core.ts). Sin cuentas: cada
 * navegador se identifica por su suscripción push.
 *   GET    /api/alerts/key   clave pública VAPID para suscribirse.
 *   PUT    /api/alerts       crea o actualiza los avisos de una suscripción: bajadas de
 *                             precio (automático) y resumen diario o semanal.
 *   DELETE /api/alerts       lo borra ({ endpoint }).
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
        const { fuel, stationIds } = body;
        // Bajadas: automático salvo que se pidan expresamente sin ellas ("none"). Lo que
        // llegue de versiones anteriores de la página (por precio máximo) va en automático.
        const mode: "auto" | "none" = body.mode === "none" ? "none" : "auto";
        const digest = (body.digest ?? "none") as "none" | "daily" | "weekly";
        const digestDay = digest === "weekly" ? body.digestDay : null;
        if (
            !isPushEndpoint(endpoint) ||
            !isKey(p256dh, 80, 100) ||
            !isKey(auth, 16, 30) ||
            typeof fuel !== "string" ||
            !FUEL_SET.has(fuel) ||
            !DIGESTS.has(digest) ||
            (mode === "none" && digest === "none") ||
            (digest === "weekly" && !(typeof digestDay === "number" && Number.isInteger(digestDay) && digestDay >= 0 && digestDay <= 6)) ||
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

        // Se conserva lo ya avisado si no cambia el combustible (al guardar o quitar una
        // gasolinera no se repiten avisos).
        let notified: Record<string, number> = {};
        if (mode === "auto") {
            const [prev] = await db.select().from(pushAlerts).where(eq(pushAlerts.endpoint, endpoint)).limit(1);
            if (prev && prev.mode !== "none" && prev.fuel === fuel)
                notified = Object.fromEntries(Object.entries(prev.notified).filter(([id]) => valid.includes(id)));
        }
        const values = {
            endpoint,
            p256dh,
            auth,
            fuel: fuel as FuelKey,
            mode,
            maxPrice: null,
            digest,
            digestDay: digest === "weekly" ? (digestDay as number) : null,
            stationIds: valid,
            notified,
            updatedAt: new Date(),
        };
        await db
            .insert(pushAlerts)
            .values(values)
            .onConflictDoUpdate({ target: pushAlerts.endpoint, set: values });
        return { ok: true };
    });

    app.delete("/alerts", async (req, reply) => {
        const { endpoint } = (req.body as AlertBody) ?? {};
        if (!isPushEndpoint(endpoint)) return reply.code(400).send({ error: "Suscripción no válida" });
        await db.delete(pushAlerts).where(eq(pushAlerts.endpoint, endpoint));
        return { ok: true };
    });
};
