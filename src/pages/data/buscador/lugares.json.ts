import type { APIRoute } from "astro";
import { buildSearchIndex, type SearchIndex } from "../../../lib/searchIndex";

/** Municipios, provincias y marcas para el buscador de la cabecera (ver lib/searchIndex.ts). */
export const GET: APIRoute = () => {
    const { p, m, b, bp } = buildSearchIndex();
    const data: SearchIndex = { p, m, b, bp };
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
