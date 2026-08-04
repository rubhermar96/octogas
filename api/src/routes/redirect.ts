import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { shortLinks } from "../db/schema";

/** GET /r/:code: redirige a la URL original de un enlace corto (fuera de /api para que la URL quede corta). */
export const redirectRoutes: FastifyPluginAsync = async (app) => {
    app.get("/r/:code", async (req, reply) => {
        const { code } = req.params as { code: string };
        const [row] = await db.select().from(shortLinks).where(eq(shortLinks.code, code)).limit(1);
        if (!row) return reply.code(404).send("Enlace no encontrado o caducado.");
        return reply.redirect(row.url, 302);
    });
};
