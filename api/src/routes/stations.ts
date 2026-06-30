import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "../db/client";
import { stations, currentPrices, priceObservations, fuelEnum } from "../db/schema";

const FUEL_SET = new Set<string>(fuelEnum.enumValues);

export const stationRoutes: FastifyPluginAsync = async (app) => {
    /** Ficha + precios actuales de una gasolinera. */
    app.get("/stations/:id", async (req, reply) => {
        const { id } = req.params as { id: string };
        const [station] = await db.select().from(stations).where(eq(stations.id, id)).limit(1);
        if (!station) return reply.code(404).send({ error: "Gasolinera no encontrada" });
        const prices = await db
            .select({ fuel: currentPrices.fuel, price: currentPrices.price, updatedAt: currentPrices.updatedAt })
            .from(currentPrices)
            .where(eq(currentPrices.stationId, id));
        return { station, prices };
    });

    /** Histórico de precios de una gasolinera (opcional ?fuel= y ?days=). */
    app.get("/stations/:id/history", async (req, reply) => {
        const { id } = req.params as { id: string };
        const { fuel, days } = req.query as { fuel?: string; days?: string };

        if (fuel && !FUEL_SET.has(fuel)) {
            return reply.code(400).send({ error: `Combustible no válido: ${fuel}` });
        }
        const nDays = Math.min(Math.max(Number(days) || 90, 1), 365 * 5);
        const since = new Date(Date.now() - nDays * 86_400_000);

        const conds = [
            eq(priceObservations.stationId, id),
            gte(priceObservations.observedAt, since),
        ];
        if (fuel) conds.push(eq(priceObservations.fuel, fuel as (typeof fuelEnum.enumValues)[number]));

        const points = await db
            .select({
                fuel: priceObservations.fuel,
                price: priceObservations.price,
                observedAt: priceObservations.observedAt,
            })
            .from(priceObservations)
            .where(and(...conds))
            .orderBy(asc(priceObservations.observedAt));

        return { stationId: id, days: nDays, count: points.length, points };
    });
};
