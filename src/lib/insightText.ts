/**
 * Piezas comunes de los textos generados a partir de los datos (municipioInsights.ts
 * y stationInsights.ts): formato de precios y céntimos, concordancia de los
 * combustibles, enlaces a fichas y horarios en palabras.
 */
import type { GasStation, FuelType } from "../types/gasolinera";
import { displayAddress } from "./format";
import { stationUrl } from "./stationUrl";

/** Trozo de texto o enlace; un párrafo es una lista de trozos. */
export type Part = string | { text: string; href: string };
export type Paragraph = Part[];

export type MainFuel = "sp95" | "diesel";
export type Averages = Partial<Record<MainFuel, number>>;
export const MAIN_FUELS: MainFuel[] = ["sp95", "diesel"];

export interface Alternative {
    station: GasStation;
    km: number;
}

/** Nombre, artículo y género de los combustibles principales, para concordar las frases. */
export const FUEL = {
    sp95: { name: "gasolina 95", the: "la gasolina 95", of: "de la gasolina 95", fem: true },
    diesel: { name: "diésel", the: "el diésel", of: "del diésel", fem: false },
} as const;
export const cheapAdj = (f: MainFuel) => (FUEL[f].fem ? "barata" : "barato");
export const dearAdj = (f: MainFuel) => (FUEL[f].fem ? "cara" : "caro");
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Nombre de cada combustible dentro de una frase. */
export const FUEL_NAMES: Record<FuelType, string> = {
    sp95: "gasolina 95",
    sp95Premium: "gasolina 95 premium",
    sp98: "gasolina 98",
    diesel: "diésel",
    dieselPremium: "diésel premium",
    dieselB: "gasóleo B (agrícola)",
    glp: "GLP (autogás)",
    gnc: "gas natural comprimido (GNC)",
    gnl: "gas natural licuado (GNL)",
    hydrogen: "hidrógeno",
};

const nf3 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nf2 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
export const price = (n: number) => `${nf3.format(n)} €/L`;
export const euros = (n: number) => `${nf2.format(n)} €`;
export const km = (n: number) => `${nf1.format(n)} km`;
/** "3,2 céntimos", "1 céntimo", "4 céntimos". */
export const cents = (diff: number) => {
    const c = Math.round(Math.abs(diff) * 1000) / 10;
    return `${nf1.format(c)} ${c === 1 ? "céntimo" : "céntimos"}`;
};

/** "1,5 céntimos más barata que" / "más cara que" / "igual que" (valor frente a referencia). */
export function versus(value: number, ref: number, f: MainFuel): string {
    const d = value - ref;
    if (Math.abs(d) < 0.0005) return "igual que";
    return `${cents(d)} más ${d < 0 ? cheapAdj(f) : dearAdj(f)} que`;
}

/** Sin rótulo de marca (p. ej. «Nº 10.935»). */
export const isGeneric = (s: GasStation) => /^n[ºo°]/i.test(s.brand) || /^\d/.test(s.brand);

/** Enlace a la ficha: "Ballenoil, en Avenida Burgos, 36" o, sin marca, la dirección. */
export const link = (s: GasStation): Part => ({
    text: isGeneric(s) ? displayAddress(s.address) : `${s.brand}, en ${displayAddress(s.address)}`,
    href: stationUrl(s),
});

/** Variante de redacción estable para cada página. */
export function pick<T>(seed: string, salt: string, options: T[]): T {
    let h = 0;
    for (const c of seed + salt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return options[h % options.length];
}

export const priced = (list: GasStation[], f: MainFuel) =>
    list.filter((s) => s.prices[f] != null).sort((a, b) => a.prices[f]! - b.prices[f]!);
export const average = (list: GasStation[], f: MainFuel) => {
    const v = list.map((s) => s.prices[f]).filter((p): p is number => p != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

// --- Horarios de la API: "L-D: 24H", "L-S: 06:00-22:00; D: 08:00-14:00",
//     "L-V: 07:00-14:00 y 16:00-20:00"... ---
const DAY_ES: Record<string, string> = { L: "lunes", M: "martes", X: "miércoles", J: "jueves", V: "viernes", S: "sábado", D: "domingo" };
const DAY_ES_PLURAL: Record<string, string> = { ...DAY_ES, S: "sábados", D: "domingos" };
const DAY_SCHEMA: Record<string, string> = { L: "Mo", M: "Tu", X: "We", J: "Th", V: "Fr", S: "Sa", D: "Su" };

interface ScheduleSegment {
    from: string;
    to: string;
    ranges: [string, string][] | "24h";
}

/** Tramos del horario, o undefined si no tiene el formato esperado. "L: ..." a secas
 *  (solo lunes) se considera ambiguo: muchas gasolineras lo usan para toda la semana. */
function parseSchedule(raw: string): ScheduleSegment[] | undefined {
    const out: ScheduleSegment[] = [];
    for (const seg of raw.split(";").map((x) => x.trim()).filter(Boolean)) {
        const m = seg.match(/^([LMXJVSD])(?:-([LMXJVSD]))?:\s*(.+)$/);
        if (!m) return undefined;
        const hours = m[3].trim();
        if (/^24H$/i.test(hours)) {
            out.push({ from: m[1], to: m[2] ?? m[1], ranges: "24h" });
            continue;
        }
        const ranges = hours.split(/\s+y\s+/).map((r) => r.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/));
        if (ranges.some((r) => !r)) return undefined;
        out.push({ from: m[1], to: m[2] ?? m[1], ranges: ranges.map((r) => [r![1], r![2]]) });
    }
    if (!out.length || (out.length === 1 && out[0].from === "L" && out[0].to === "L")) return undefined;
    return out;
}

const joinEs = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`);

/** Horario en palabras: "abre de lunes a sábado de 06:00 a 22:00 y los domingos de 08:00 a 14:00". */
export function scheduleText(raw: string | undefined): string | undefined {
    const t = raw?.trim();
    if (!t) return undefined;
    if (/^L-D:\s*24H$/i.test(t)) return "abre las 24 horas todos los días";
    const segs = parseSchedule(t);
    if (!segs) return `tiene este horario: ${t}`;
    const parts = segs.map((s) => {
        const days =
            s.from === "L" && s.to === "D"
                ? "todos los días"
                : s.from === "S" && s.to === "D"
                  ? "los fines de semana"
                  : s.from === s.to
                    ? `los ${DAY_ES_PLURAL[s.from]}`
                    : `de ${DAY_ES[s.from]} a ${DAY_ES[s.to]}`;
        const hours = s.ranges === "24h" ? "las 24 horas" : s.ranges.map(([a, b]) => `de ${a} a ${b}`).join(" y ");
        return `${days} ${hours}`;
    });
    return `abre ${joinEs(parts)}`;
}

/** Horario en formato schema.org (openingHours: "Mo-Sa 06:00-22:00"), si se entiende. */
export function openingHours(raw: string | undefined): string[] | undefined {
    const segs = raw ? parseSchedule(raw.trim()) : undefined;
    if (!segs) return undefined;
    return segs.flatMap((s) => {
        const days = DAY_SCHEMA[s.from] + (s.from !== s.to ? `-${DAY_SCHEMA[s.to]}` : "");
        return s.ranges === "24h" ? [`${days} 00:00-23:59`] : s.ranges.map(([a, b]) => `${days} ${a}-${b}`);
    });
}
export const is24h = (s: GasStation) => /^L-D:\s*24H$/i.test((s.schedule ?? "").trim());

export const plain = (p: Paragraph) => p.map((x) => (typeof x === "string" ? x : x.text)).join("");
