import { titleCase } from './format';
import { slugify } from './slug';

/**
 * Artículos que el INE (y por tanto MITECO) pospone entre paréntesis:
 * "Palmas (Las)", "Coruña (A)", "Aldea (L')", "Balears (Illes)". Cualquier
 * otro paréntesis (p. ej. nombres bilingües como "Noáin (Valle de Elorz)")
 * no coincide con esta lista y se deja tal cual.
 */
const PLACE_ARTICLES = new Set([
    'a', 'as', 'el', 'els', 'es', "l'", 'la', 'las', 'les', 'los', 'o', 'sa', 'ses', 'illes',
]);

/**
 * Reordena un topónimo del formato INE ("Palmas (Las)") al orden de lectura
 * natural ("Las Palmas"). No cambia mayúsculas/minúsculas.
 */
export function normalizePlaceName(raw: string): string {
    const match = raw.match(/^(.+)\s\(([^)]+)\)$/);
    if (!match) return raw;
    const [, base, article] = match;
    if (!PLACE_ARTICLES.has(article.toLowerCase())) return raw;
    const glue = article.endsWith("'") ? '' : ' ';
    return `${article}${glue}${base}`;
}

/** Provincia lista para mostrar (reordenada; el dato del INE viene en mayúsculas). */
export function displayProvince(raw: string): string {
    // "SANTA CRUZ DE TENERIFE" -> "Santa Cruz de Tenerife" (no "De").
    return titleCase(normalizePlaceName(raw)).replace(/(?<=\s)(De|Del)(?=\s)/g, (w) => w.toLowerCase());
}

/** Municipio listo para mostrar (reordenado; el dato ya viene bien capitalizado). */
export function displayCity(raw: string): string {
    return normalizePlaceName(raw);
}

/** Slug de URL a partir del nombre ya reordenado (evita sufijos tipo "-las"). */
export function placeSlug(raw: string): string {
    return slugify(normalizePlaceName(raw));
}
