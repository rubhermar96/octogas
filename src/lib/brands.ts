/**
 * Normaliza el "Rótulo" del Ministerio a una marca canónica.
 *
 * El campo original viene en mayúsculas y con mucho ruido (números de
 * estación, sufijos de cooperativa, etc.). Esto agrupa las variantes más
 * comunes bajo una marca limpia para poder filtrar y mostrar logos.
 * Si no se reconoce, se devuelve el rótulo en formato "Título".
 */
const BRAND_PATTERNS: Array<[RegExp, string]> = [
    [/repsol/i, "Repsol"],
    [/cepsa/i, "Cepsa"],
    [/\bbp\b|british petroleum/i, "BP"],
    [/shell/i, "Shell"],
    [/galp/i, "Galp"],
    [/petronor/i, "Petronor"],
    [/campsa/i, "Campsa"],
    [/\bavia\b/i, "Avia"],
    [/ballenoil/i, "Ballenoil"],
    [/plenoil/i, "Plenoil"],
    [/petroprix/i, "Petroprix"],
    [/\besso\b/i, "Esso"],
    [/\bq8\b/i, "Q8"],
    [/carrefour/i, "Carrefour"],
    [/alcampo|simply/i, "Alcampo"],
    [/eroski/i, "Eroski"],
    [/\bmakro\b/i, "Makro"],
    [/\bdisa\b/i, "Disa"],
    [/\bgm\s?oil|gmoil/i, "GM Oil"],
    [/meroil/i, "Meroil"],
    [/tamoil/i, "Tamoil"],
    [/\bvip\b/i, "VIP"],
    [/easygas|easy gas/i, "EasyGas"],
    [/\bpetrocat\b/i, "Petrocat"],
    [/\bagip\b/i, "Agip"],
];

export function normalizeBrand(rotulo: string | null | undefined): string {
    const raw = (rotulo ?? "").trim();
    if (!raw) return "Independiente";

    for (const [pattern, name] of BRAND_PATTERNS) {
        if (pattern.test(raw)) return name;
    }

    // Sin marca conocida: pasamos a formato Título (primera letra de cada palabra).
    return raw
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Color corporativo aproximado por marca: { fondo, texto }. */
const BRAND_COLORS: Record<string, { bg: string; fg: string }> = {
    Repsol: { bg: "#EF7D00", fg: "#ffffff" },
    Cepsa: { bg: "#007A33", fg: "#ffffff" },
    BP: { bg: "#006F44", fg: "#ffffff" },
    Shell: { bg: "#FFD500", fg: "#D42E12" },
    Galp: { bg: "#FF6A13", fg: "#ffffff" },
    Petronor: { bg: "#00833E", fg: "#ffffff" },
    Campsa: { bg: "#003DA5", fg: "#ffffff" },
    Avia: { bg: "#E2001A", fg: "#ffffff" },
    Ballenoil: { bg: "#1D70B7", fg: "#ffffff" },
    Plenoil: { bg: "#E30613", fg: "#ffffff" },
    Petroprix: { bg: "#FFC600", fg: "#1A1A1A" },
    Esso: { bg: "#C8102E", fg: "#ffffff" },
    Q8: { bg: "#FFCC00", fg: "#006FCF" },
    Carrefour: { bg: "#004E9F", fg: "#ffffff" },
    Alcampo: { bg: "#E2001A", fg: "#ffffff" },
    Eroski: { bg: "#E5006D", fg: "#ffffff" },
    Makro: { bg: "#003DA5", fg: "#ffffff" },
    Disa: { bg: "#ED1C24", fg: "#ffffff" },
    "GM Oil": { bg: "#0A7D3E", fg: "#ffffff" },
    Meroil: { bg: "#E2001A", fg: "#ffffff" },
    Tamoil: { bg: "#E30613", fg: "#ffffff" },
    VIP: { bg: "#1A1A1A", fg: "#ffffff" },
    EasyGas: { bg: "#7AB800", fg: "#ffffff" },
    Petrocat: { bg: "#ED1C24", fg: "#ffffff" },
    Agip: { bg: "#FFCC00", fg: "#1A1A1A" },
};

/**
 * Marcas con archivo de logo real disponible en /public/brands/<slug>.svg.
 * Mientras esté vacío, se muestran solo los monogramas de color (sin peticiones 404).
 * Para activar un logo: añade el archivo y su slug aquí, p. ej. "repsol".
 */
export const BRANDS_WITH_LOGO = new Set<string>([]);

/** Genera un color estable a partir de un texto (para marcas sin color definido). */
function hashColor(text: string): { bg: string; fg: string } {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = text.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return { bg: `hsl(${hue}, 55%, 42%)`, fg: "#ffffff" };
}

export function brandColors(brand: string): { bg: string; fg: string } {
    return BRAND_COLORS[brand] ?? hashColor(brand);
}

/** Iniciales/monograma de una marca (1-2 caracteres). */
export function brandInitials(brand: string): string {
    const words = brand.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}
