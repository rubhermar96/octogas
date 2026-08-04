import type { FastifyPluginAsync } from "fastify";
import { randomBytes } from "node:crypto";
import { db } from "../db/client";
import { shortLinks } from "../db/schema";

function generateCode(): string {
    return randomBytes(6).toString("base64url");
}

/** POST /api/shorten: crea un enlace corto para una URL (rutas compartidas, Google Maps, etc.). */
export const shortLinkRoutes: FastifyPluginAsync = async (app) => {
    app.post("/shorten", async (req, reply) => {
        const { url } = (req.body as { url?: string }) ?? {};
        if (!url || typeof url !== "string" || url.length > 4000) {
            return reply.code(400).send({ error: "URL inválida" });
        }
        try {
            const protocol = new URL(url).protocol;
            if (protocol !== "https:" && protocol !== "http:") throw new Error("protocolo no permitido");
        } catch {
            return reply.code(400).send({ error: "URL inválida" });
        }

        // Reintenta si hay colisión de código (muy improbable con 6 bytes de aleatoriedad).
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = generateCode();
            try {
                await db.insert(shortLinks).values({ code, url });
                return { code };
            } catch {
                continue;
            }
        }
        return reply.code(500).send({ error: "No se pudo generar el enlace corto" });
    });
};
