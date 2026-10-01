import type { FastifyPluginAsync } from "fastify";
import { randomBytes } from "node:crypto";
import { db } from "../db/client";
import { shortLinks } from "../db/schema";

function generateCode(): string {
    return randomBytes(6).toString("base64url");
}

// Destinos que se pueden acortar: la propia web (SITE_HOSTS) y Google Maps. Sin esta
// lista, cualquiera podría usar octogas.es/r/... para disfrazar enlaces de phishing.
const SITE_HOSTS = new Set(
    (process.env.SITE_HOSTS ?? "octogas.es,www.octogas.es,localhost,127.0.0.1")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
);
const GOOGLE_MAPS_HOSTS = new Set(["www.google.com", "google.com", "maps.google.com"]);

/** ¿Es una URL que aceptamos acortar (y redirigir)? */
export function isAllowedTarget(raw: string): boolean {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    if (SITE_HOSTS.has(url.hostname)) return true;
    return url.protocol === "https:" && GOOGLE_MAPS_HOSTS.has(url.hostname) && url.pathname.startsWith("/maps");
}

/** POST /api/shorten: crea un enlace corto para una ruta de OCTO o su enlace de Google Maps. */
export const shortLinkRoutes: FastifyPluginAsync = async (app) => {
    app.post("/shorten", async (req, reply) => {
        const { url } = (req.body as { url?: string }) ?? {};
        if (!url || typeof url !== "string" || url.length > 4000 || !isAllowedTarget(url)) {
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
