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

// Palabras que, dentro de una dirección, van en minúscula ("Avenida de la Constitución").
const ADDRESS_MINOR_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'a', 'en']);

/**
 * Dirección legible a partir de la que publica MITECO, casi siempre en mayúsculas:
 * "CARRETERA AP-9 KM. 39,5" -> "Carretera AP-9 Km. 39,5". Los códigos de carretera
 * (AP-9, N-651, E-70/A-6, CV404...) y "S/N" se quedan en mayúsculas. Si la dirección
 * ya viene con mayúsculas y minúsculas, se respeta tal cual.
 */
export function displayAddress(raw: string): string {
    // Los datos traen comas sueltas ("CALLE SAN RAMON 8,", "CALLE JOVEN TRINIDAD,, 11")
    // que, al componer textos como "{dirección}, {municipio}", daban ",,".
    const text = raw.trim().replace(/\s*,(?:\s*,)+\s*/g, ', ').replace(/[\s,;]+$/, '');
    if (text !== text.toUpperCase()) return text;
    return text
        .split(/\s+/)
        .map((word, i) => {
            // "Sin número": SN, S/N, S.N. → "S/N" (conservando la coma que lo siga).
            const sn = word.match(/^s[/.]?n\.?([^\p{L}\d]*)$/iu);
            if (sn) return `S/N${sn[1]}`;
            if (/^[a-zñ]{1,4}-?\d/i.test(word)) return word.toUpperCase();
            const lower = word.toLowerCase();
            if (i > 0 && ADDRESS_MINOR_WORDS.has(lower)) return lower;
            return titleCase(lower);
        })
        .join(' ');
}
