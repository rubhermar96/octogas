/**
 * Índice del buscador de la cabecera (components/Search/SiteSearch.astro), generado en
 * cada build con las mismas URLs que las páginas: municipios y provincias en
 * /data/buscador/lugares.json (pequeño, para que haya resultados al instante) y, además,
 * las gasolineras en /data/buscador/gasolineras.json. Cada fichero es completo por sí
 * solo (las gasolineras apuntan a su municipio por posición en la lista que traen), así
 * que nunca se mezclan datos de dos publicaciones distintas.
 */
import fs from "node:fs";
import path from "node:path";
import type { GasStation } from "../types/gasolinera";
import { loadMissingStations } from "./missingStations";
import { displayCity, displayProvince, placeSlug } from "./placeName";
import { brandsData } from "./brandPages";

export interface SearchIndex {
    /** Provincias: [nombre, slug, otros nombres con los que se buscan]. */
    p: [string, string, string?][];
    /** Municipios: [nombre, provincia (posición en p), slug, gasolineras con precio hoy, otros nombres]. */
    m: [string, number, string, number, string?][];
    /** Marcas con página (lib/brandPages.ts): [nombre, slug, gasolineras]. */
    b: [string, string, number][];
    /** Marcas con página en una provincia: [marca (posición en b), provincia (posición en p), gasolineras]. */
    bp: [number, number, number][];
    /** Gasolineras: [rótulo, dirección (como la publica el Ministerio), municipio (posición en m), id]. */
    s?: [string, string, number, string][];
}

// Nombres en castellano de provincias y municipios que los datos traen en la lengua
// cooficial (o con el artículo detrás), para que "Gerona" o "La Coruña" también salgan.
const PROVINCE_ALIASES: Record<string, string> = {
    "illes-balears": "baleares islas baleares",
    "a-coruna": "la coruna",
    bizkaia: "vizcaya",
    gipuzkoa: "guipuzcoa",
    girona: "gerona",
    lleida: "lerida",
    ourense: "orense",
    navarra: "nafarroa",
    "las-palmas": "gran canaria",
};
const MUNICIPIO_ALIASES: Record<string, string> = {
    "a-coruna": "la coruna",
    girona: "gerona",
    lleida: "lerida",
    ourense: "orense",
    "palma-de-mallorca": "palma",
};

let cache: Required<SearchIndex> | undefined;

/** Índice completo (con gasolineras). Incluye las que hoy no publican precios y conservan ficha. */
export function buildSearchIndex(): Required<SearchIndex> {
    if (cache) return cache;
    const today = JSON.parse(fs.readFileSync(path.resolve("public/data/stations.json"), "utf-8")) as GasStation[];
    const missing = loadMissingStations(today);

    const index: Required<SearchIndex> = { p: [], m: [], b: [], bp: [], s: [] };
    // Provincias: solo las de hoy (son las que tienen página).
    const provinces = new Map<string, number>();
    for (const st of today) {
        const slug = placeSlug(st.province ?? "");
        if (!slug || provinces.has(slug)) continue;
        provinces.set(slug, index.p.length);
        index.p.push(PROVINCE_ALIASES[slug] ? [displayProvince(st.province), slug, PROVINCE_ALIASES[slug]] : [displayProvince(st.province), slug]);
    }
    // Municipios y gasolineras: primero las de hoy, cuyos nombres mandan (como en las páginas).
    const munis = new Map<string, number>();
    for (const [list, priced] of [
        [today, true],
        [missing, false],
    ] as const) {
        for (const st of list) {
            const ps = placeSlug(st.province ?? "");
            const ms = placeSlug(st.city ?? "");
            const pi = provinces.get(ps);
            if (pi == null || !ms) continue;
            const key = `${ps}|${ms}`;
            let mi = munis.get(key);
            if (mi == null) {
                mi = index.m.length;
                munis.set(key, mi);
                index.m.push(MUNICIPIO_ALIASES[ms] ? [displayCity(st.city), pi, ms, 0, MUNICIPIO_ALIASES[ms]] : [displayCity(st.city), pi, ms, 0]);
            }
            if (priced) index.m[mi][3]++;
            index.s.push([st.brand, st.address, mi, st.id]);
        }
    }
    for (const brand of brandsData().brands) {
        const bi = index.b.length;
        index.b.push([brand.name, brand.slug, brand.stations.length]);
        for (const bp of brand.provinces) {
            const pi = provinces.get(bp.slug);
            if (bp.hasPage && pi != null) index.bp.push([bi, pi, bp.stations.length]);
        }
    }
    return (cache = index);
}
