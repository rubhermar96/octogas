import type { APIRoute } from "astro";
import { buildSearchIndex, type SearchIndex } from "../../../lib/searchIndex";

/** Municipios y provincias para el buscador de la cabecera (ver lib/searchIndex.ts). */
export const GET: APIRoute = () => {
    const { p, m } = buildSearchIndex();
    const data: SearchIndex = { p, m };
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
