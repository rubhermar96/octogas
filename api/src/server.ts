import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { stationRoutes } from "./routes/stations";
import { shortLinkRoutes } from "./routes/shortLinks";
import { redirectRoutes } from "./routes/redirect";

// Registros sin IP: la política de privacidad solo contempla las de Nginx (anonimizadas).
// trustProxy: en producción la API va detrás de Nginx (cabeceras X-Forwarded-*).
// bodyLimit: la única petición con cuerpo es /api/shorten (una URL de hasta 4000 caracteres).
const app = Fastify({
    logger: { serializers: { req: (req) => ({ method: req.method, url: req.url }) } },
    trustProxy: true,
    bodyLimit: 16 * 1024,
});

// CORS: CORS_ORIGINS (separados por comas) limita los orígenes permitidos. Sin la
// variable (desarrollo local, web en :4321 y API en :3001) se permite cualquiera.
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
await app.register(cors, { origin: corsOrigins.length > 0 ? corsOrigins : true });

app.get("/health", async () => ({ ok: true, service: "octogas-api" }));

await app.register(stationRoutes, { prefix: "/api" });
await app.register(shortLinkRoutes, { prefix: "/api" });
await app.register(redirectRoutes);

// HOST: por defecto solo local; en el VPS Nginx es quien la expone hacia fuera.
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
app
    .listen({ port, host })
    .then((addr) => app.log.info(`Octogas API en ${addr}`))
    .catch((err) => {
        app.log.error(err);
        process.exit(1);
    });
