import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { stationRoutes } from "./routes/stations";

const app = Fastify({ logger: true });

// CORS abierto (web + futura app móvil). Restringir orígenes en producción.
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true, service: "octogas-api" }));

await app.register(stationRoutes, { prefix: "/api" });

const port = Number(process.env.PORT ?? 3001);
app
    .listen({ port, host: "0.0.0.0" })
    .then((addr) => app.log.info(`Octogas API en ${addr}`))
    .catch((err) => {
        app.log.error(err);
        process.exit(1);
    });
