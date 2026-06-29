/**
 * Pone en "Título" un texto que viene en mayúsculas (p. ej. nombres de
 * provincia del Ministerio: "MADRID" -> "Madrid", "BALEARS (ILLES)" ->
 * "Balears (Illes)"). Respeta separadores como /, (), - y espacios.
 */
export function titleCase(text: string): string {
    return text
        .toLowerCase()
        .replace(/(^|[\s/(\-])([a-záéíóúñ])/g, (_, sep, ch) => sep + ch.toUpperCase());
}
