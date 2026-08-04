import { slugify } from "./slug";

/**
 * Mismo normalizePlaceName/placeSlug que la web (src/lib/placeName.ts).
 * Duplicado aquí para que el backend sea autónomo y los scopeId de los
 * agregados coincidan con los slugs de las rutas de la web.
 *
 * Artículos que el INE (y por tanto MITECO) pospone entre paréntesis:
 * "Palmas (Las)", "Coruña (A)", "Aldea (L')", "Balears (Illes)".
 */
const PLACE_ARTICLES = new Set([
    "a", "as", "el", "els", "es", "l'", "la", "las", "les", "los", "o", "sa", "ses", "illes",
]);

/**
 * Reordena un topónimo del formato INE ("Palmas (Las)") al orden de lectura
 * natural ("Las Palmas"). Deja intacto cualquier otro paréntesis que no sea
 * un artículo conocido (p. ej. nombres bilingües como "Noáin (Valle de Elorz)").
 */
export function normalizePlaceName(raw: string): string {
    const match = raw.match(/^(.+)\s\(([^)]+)\)$/);
    if (!match) return raw;
    const [, base, article] = match;
    if (!PLACE_ARTICLES.has(article.toLowerCase())) return raw;
    const glue = article.endsWith("'") ? "" : " ";
    return `${article}${glue}${base}`;
}

/** Slug de un topónimo, ya reordenado a lectura natural antes de slugificar. */
export function placeSlug(raw: string): string {
    return slugify(normalizePlaceName(raw));
}
