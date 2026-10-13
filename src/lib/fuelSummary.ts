/**
 * Resumen por combustible de un grupo de gasolineras (un municipio, una provincia o toda
 * España): para cada combustible que se vende, la más barata, la media y cuántas lo
 * tienen. Para que las páginas hablen a todos los conductores (diésel, gasolina 98, GLP,
 * gasóleo agrícola...), no solo a los de gasolina 95.
 */
import type { FuelType, GasStation } from "../types/gasolinera";
import { FUEL_NAMES, joinEs } from "./insightText";

/** Orden al enumerar combustibles: gasolinas, gasóleos y gases. */
export const FUEL_LIST_ORDER: FuelType[] = ["sp95", "sp95Premium", "sp98", "diesel", "dieselPremium", "dieselB", "glp", "gnc", "gnl", "hydrogen"];

/** Nombre completo para tablas y títulos. */
export const FUEL_TITLES: Record<FuelType, string> = {
    sp95: "Gasolina 95",
    sp95Premium: "Gasolina 95 premium",
    sp98: "Gasolina 98",
    diesel: "Diésel (gasóleo A)",
    dieselPremium: "Diésel premium",
    dieselB: "Gasóleo B (agrícola)",
    glp: "GLP (autogás)",
    gnc: "Gas natural comprimido (GNC)",
    gnl: "Gas natural licuado (GNL)",
    hydrogen: "Hidrógeno",
};

/** Los gases (GNC, GNL e hidrógeno) se venden por kilo; el resto, por litro. */
export const FUEL_UNIT: Record<FuelType, "€/L" | "€/kg"> = {
    sp95: "€/L",
    sp95Premium: "€/L",
    sp98: "€/L",
    diesel: "€/L",
    dieselPremium: "€/L",
    dieselB: "€/L",
    glp: "€/L",
    gnc: "€/kg",
    gnl: "€/kg",
    hydrogen: "€/kg",
};

export interface FuelRow {
    fuel: FuelType;
    /** Gasolineras que lo venden hoy. */
    count: number;
    min: number;
    avg: number;
    /** La más barata (la primera, si empatan). */
    cheapest: GasStation;
}

export function fuelSummary(stations: GasStation[]): FuelRow[] {
    const rows: FuelRow[] = [];
    for (const fuel of FUEL_LIST_ORDER) {
        let cheapest: GasStation | undefined;
        let sum = 0;
        let count = 0;
        for (const s of stations) {
            const p = s.prices[fuel];
            if (p == null) continue;
            count++;
            sum += p;
            if (!cheapest || p < cheapest.prices[fuel]!) cheapest = s;
        }
        if (cheapest) rows.push({ fuel, count, min: cheapest.prices[fuel]!, avg: sum / count, cheapest });
    }
    return rows;
}

/** "gasolina, diésel, GLP y gasóleo agrícola": los tipos de combustible que hay. */
export function fuelFamilies(rows: FuelRow[]): string {
    const has = (...fuels: FuelType[]) => rows.some((r) => fuels.includes(r.fuel));
    const out: string[] = [];
    if (has("sp95", "sp95Premium", "sp98")) out.push("gasolina");
    if (has("diesel", "dieselPremium")) out.push("diésel");
    if (has("glp")) out.push("GLP");
    if (has("gnc", "gnl")) out.push("gas natural");
    if (has("dieselB")) out.push("gasóleo agrícola");
    if (has("hydrogen")) out.push("hidrógeno");
    return joinEs(out);
}

const nf3 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
/** Recuentos: "2278", "11.510" (en español, los de cuatro cifras van sin punto). */
const nf0 = new Intl.NumberFormat("es-ES");
/** Precio en un texto: "1,599 €/L", "1,299 €/kg". */
export const priceOf = (f: FuelType, n: number) => `${nf3.format(n)} ${FUEL_UNIT[f]}`;

/** Combustibles de las descripciones de página, por orden de interés (se citan hasta 4:
 *  en un pueblo con gasóleo agrícola y sin GLP ni 98, entra el agrícola). */
const DESCRIPTION_FUELS: FuelType[] = ["sp95", "diesel", "sp98", "glp", "dieselB"];

/**
 * "gasolina 95 desde 1,599 €/L, diésel desde 1,689 €/L y GLP desde 0,989 €/L" (para
 * descripciones de página). `from: false` quita el "desde" (una sola gasolinera).
 */
export function fuelPriceList(rows: FuelRow[], from = true): string {
    let pick = rows
        .filter((r) => DESCRIPTION_FUELS.includes(r.fuel))
        .sort((a, b) => DESCRIPTION_FUELS.indexOf(a.fuel) - DESCRIPTION_FUELS.indexOf(b.fuel))
        .slice(0, 4);
    if (!pick.length) pick = rows.slice(0, 3);
    return joinEs(pick.map((r) => `${FUEL_NAMES[r.fuel]} ${from ? "desde" : "a"} ${priceOf(r.fuel, r.min)}`));
}

/** Con artículo, para empezar o completar frases. */
export const FUEL_THE: Record<FuelType, string> = {
    sp95: "la gasolina 95",
    sp95Premium: "la gasolina 95 premium",
    sp98: "la gasolina 98",
    diesel: "el diésel",
    dieselPremium: "el diésel premium",
    dieselB: "el gasóleo agrícola",
    glp: "el GLP",
    gnc: "el GNC",
    gnl: "el GNL",
    hydrogen: "el hidrógeno",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface FaqScope {
    /** Para las preguntas: "Valladolid". */
    label: string;
    /** "en Valladolid", "en la provincia de Valladolid". */
    at: string;
    /** "Valladolid", "la provincia de Valladolid" (en "las 12 gasolineras de ..."). */
    of: string;
    /** Gasolineras con precios hoy. */
    stations: GasStation[];
    /** Cómo se nombra una gasolinera en las respuestas. */
    name: (s: GasStation) => string;
}

/** Cuánto cuestan los combustibles comunes; dónde se venden los minoritarios. */
const HOW_MUCH: FuelType[] = ["sp95", "diesel", "sp98"];
const WHERE: FuelType[] = ["glp", "dieselB", "gnc", "gnl", "hydrogen"];

/**
 * Preguntas frecuentes por combustible: la más barata según lo que eche cada uno y una
 * pregunta por combustible que se venda en la zona (precio de los comunes; dónde
 * repostar GLP, gasóleo agrícola o gas natural, que se buscan por eso).
 */
export function fuelFaq(rows: FuelRow[], scope: FaqScope): { q: string; a: string }[] {
    const { label, at, of, stations, name } = scope;
    const total = stations.length;
    const row = (f: FuelType) => rows.find((r) => r.fuel === f);
    const faq: { q: string; a: string }[] = [];

    // La más barata: para gasolina 95 y para diésel (la misma o una para cada uno).
    const r95 = row("sp95");
    const rD = row("diesel");
    let cheapest: string | undefined;
    if (total === 1) cheapest = `${cap(of)} tiene una sola gasolinera: ${name(stations[0])}.`;
    else if (r95 && rD && r95.cheapest.id === rD.cheapest.id)
        cheapest = `Hoy es ${name(r95.cheapest)}, la más barata tanto para gasolina 95 (${priceOf("sp95", r95.min)}) como para diésel (${priceOf("diesel", rD.min)}).`;
    else if (r95 && rD)
        cheapest = `Depende del combustible. Para gasolina 95 es ${name(r95.cheapest)}, a ${priceOf("sp95", r95.min)}; para diésel, ${name(rD.cheapest)}, a ${priceOf("diesel", rD.min)}.`;
    else if (r95 || rD) {
        const r = (r95 ?? rD)!;
        cheapest = `Para ${FUEL_NAMES[r.fuel]}, la más barata es ${name(r.cheapest)}, a ${priceOf(r.fuel, r.min)}.`;
    }
    if (cheapest) faq.push({ q: `¿Cuál es la gasolinera más barata de ${label}?`, a: cheapest });

    for (const f of [...HOW_MUCH, ...WHERE]) {
        const r = row(f);
        if (!r) continue;
        const q = HOW_MUCH.includes(f) ? `¿Cuánto cuesta ${FUEL_THE[f]} en ${label}?` : `¿Dónde repostar ${FUEL_NAMES[f]} en ${label}?`;
        let a: string;
        if (r.count === 1) {
            a =
                total === 1
                    ? `${cap(FUEL_THE[f])} está a ${priceOf(f, r.min)} en ${name(r.cheapest)}, la única gasolinera de ${of}.`
                    : `Solo una de las ${nf0.format(total)} gasolineras de ${of} vende ${FUEL_NAMES[f]}: ${name(r.cheapest)}, a ${priceOf(f, r.min)}.`;
        } else if (WHERE.includes(f) && r.count <= 4) {
            const list = stations.filter((s) => s.prices[f] != null).sort((x, y) => x.prices[f]! - y.prices[f]!);
            a = `${r.count} gasolineras ${at} venden ${FUEL_NAMES[f]}: ${list.map((s) => `${name(s)}, a ${priceOf(f, s.prices[f]!)}`).join("; ")}.`;
        } else {
            a = `${cap(FUEL_THE[f])} cuesta de media ${priceOf(f, r.avg)} ${at}; la más barata es ${name(r.cheapest)}, a ${priceOf(f, r.min)}.`;
            if (r.count < total) a += r.count === total - 1 ? " La venden todas las gasolineras menos una." : ` La venden ${nf0.format(r.count)} de las ${nf0.format(total)} gasolineras.`;
        }
        faq.push({ q, a });
    }
    return faq;
}
