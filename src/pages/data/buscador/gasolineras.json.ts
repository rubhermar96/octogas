import type { APIRoute } from "astro";
import { buildSearchIndex } from "../../../lib/searchIndex";

/** Índice completo del buscador de la cabecera, con las gasolineras (ver lib/searchIndex.ts). */
export const GET: APIRoute = () =>
    new Response(JSON.stringify(buildSearchIndex()), { headers: { "Content-Type": "application/json; charset=utf-8" } });
