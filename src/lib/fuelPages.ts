/**
 * Páginas de combustibles que se buscan por sí mismos porque pocas gasolineras los
 * venden: GLP (autogás) y gasóleo agrícola. Una página para toda España
 * (/gasolineras-glp/) y una por provincia (/gasolineras-glp/valladolid/), con todas las
 * gasolineras que lo venden, de la más barata a la más cara, y texto sacado de los datos.
 */
import fs from "node:fs";
import path from "node:path";
import type { FuelType, GasStation } from "../types/gasolinera";
import type { AggPoint } from "./aggHistory";
import { displayCity, displayProvince, placeSlug } from "./placeName";
import { municipioUrl } from "./stationUrl";
import { cents, euros, is24h, isGeneric, joinEs, link, plain, price, type Paragraph, type Part } from "./insightText";
import { displayAddress } from "./format";

export type FuelPageKind = "glp" | "dieselB";

export interface FuelPageConfig {
    fuel: FuelType;
    /** Ruta de la página de España; las de provincia cuelgan de ella. */
    base: string;
    /** Nombre en títulos: "GLP (autogás)". */
    title: string;
    /** Nombre dentro de una frase: "GLP", "gasóleo agrícola". */
    short: string;
    /** Con artículo: "el GLP". */
    the: string;
    /** Qué es y para quién (texto fijo, para quien llega buscándolo). */
    about: string;
    /** Cuánto se ahorra: "en un depósito de 40 litros", "cada 100 litros". */
    saving: { litres: number; phrase: string };
    nationalTitle: string;
    nationalH1: string;
    provinceTitle: (prov: string) => string;
    provinceH1: (prov: string) => string;
}

export const FUEL_PAGES: Record<FuelPageKind, FuelPageConfig> = {
    glp: {
        fuel: "glp",
        base: "/gasolineras-glp/",
        title: "GLP (autogás)",
        short: "GLP",
        the: "el GLP",
        about:
            "El GLP o autogás es el gas licuado del petróleo que usan los coches de GLP, casi siempre bifuel (con un depósito de gasolina y otro de gas), que suelen llevar la etiqueta ECO de la DGT. Como no lo venden todas las gasolineras, conviene saber dónde están las que lo tienen antes de quedarse sin gas.",
        saving: { litres: 40, phrase: "en un depósito de 40 litros" },
        nationalTitle: "Precio del GLP (autogás) hoy y gasolineras con GLP en España | OCTO",
        nationalH1: "Precio del GLP (autogás) hoy y gasolineras que lo venden",
        provinceTitle: (prov) => `Gasolineras con GLP (autogás) en ${prov}: precio hoy | OCTO`,
        provinceH1: (prov) => `Gasolineras con GLP en ${prov}`,
    },
    dieselB: {
        fuel: "dieselB",
        base: "/gasoleo-agricola/",
        title: "gasóleo agrícola (gasóleo B)",
        short: "gasóleo agrícola",
        the: "el gasóleo agrícola",
        about:
            "El gasóleo B o agrícola lleva un colorante y paga menos impuestos, y solo puede usarse en los vehículos y la maquinaria autorizados, como tractores y maquinaria agrícola. Su precio cambia mucho de una gasolinera a otra, así que comparar antes de llenar el depósito del tractor se nota.",
        saving: { litres: 100, phrase: "cada 100 litros" },
        nationalTitle: "Precio del gasóleo agrícola (gasóleo B) hoy en España | OCTO",
        nationalH1: "Precio del gasóleo agrícola hoy y gasolineras que lo venden",
        provinceTitle: (prov) => `Gasóleo agrícola en ${prov}: precio hoy y gasolineras | OCTO`,
        provinceH1: (prov) => `Gasóleo agrícola en ${prov}`,
    },
};

export const fuelPageUrl = (kind: FuelPageKind, province?: string) =>
    province ? `${FUEL_PAGES[kind].base}${placeSlug(province)}/` : FUEL_PAGES[kind].base;

/** Página de un combustible con página propia (para enlazarla desde las tablas). */
export const fuelPageKind = (fuel: FuelType): FuelPageKind | undefined =>
    (Object.keys(FUEL_PAGES) as FuelPageKind[]).find((k) => FUEL_PAGES[k].fuel === fuel);

export interface ProvinceFuel {
    name: string; // como viene en los datos
    label: string;
    /** Sus gasolineras con el combustible, de la más barata a la más cara. */
    stations: GasStation[];
    min: number;
    avg: number;
}

export interface FuelData {
    kind: FuelPageKind;
    config: FuelPageConfig;
    /** Todas las gasolineras con precios hoy (para "X de las Y"). */
    total: number;
    /** Las que lo venden, de la más barata a la más cara. */
    stations: GasStation[];
    avg: number;
    /** Provincias que lo tienen, por orden alfabético. */
    provinces: ProvinceFuel[];
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const nf0 = new Intl.NumberFormat("es-ES");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let cache: GasStation[] | undefined;
function loadStations(): GasStation[] {
    cache ??= JSON.parse(fs.readFileSync(path.resolve("public/data/stations.json"), "utf-8")) as GasStation[];
    return cache;
}

export function fuelData(kind: FuelPageKind): FuelData {
    const config = FUEL_PAGES[kind];
    const f = config.fuel;
    const all = loadStations();
    const stations = all.filter((s) => s.prices[f] != null).sort((a, b) => a.prices[f]! - b.prices[f]!);
    const byProv = new Map<string, GasStation[]>();
    for (const s of stations) (byProv.get(s.province) ?? byProv.set(s.province, []).get(s.province)!).push(s);
    const provinces = [...byProv.entries()]
        .map(([name, list]) => ({
            name,
            label: displayProvince(name),
            stations: list,
            min: list[0].prices[f]!,
            avg: mean(list.map((s) => s.prices[f]!)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "es"));
    return { kind, config, total: all.length, stations, avg: mean(stations.map((s) => s.prices[f]!)), provinces };
}

/** "Ballenoil, en Calle X, 3" (la marca y la dirección, o solo la dirección). */
export const stationName = (s: GasStation) => (isGeneric(s) ? displayAddress(s.address) : s.brand);

/** "1,2 céntimos más barato que" / "más caro que" / "igual que" (combustibles en masculino). */
function versus(value: number, ref: number): string {
    const d = value - ref;
    if (Math.abs(d) < 0.0005) return "igual que";
    return `${cents(d)} más ${d < 0 ? "barato" : "caro"} que`;
}

/** Media de hace ~30 días en el histórico (entre 21 y 45 días atrás). */
function monthAgo(points: AggPoint[] | undefined, now: number) {
    if (!points?.length) return undefined;
    const target = now - 30 * 86_400_000;
    let ref = points[0];
    for (const p of points) if (Math.abs(p.t - target) < Math.abs(ref.t - target)) ref = p;
    const days = (now - ref.t) / 86_400_000;
    return days >= 21 && days <= 45 ? ref.price : undefined;
}

function trendText(points: AggPoint[] | undefined, today: number, where: string, the: string): string | undefined {
    const from = monthAgo(points, Date.now());
    if (from == null) return undefined;
    const d = today - from;
    return Math.abs(d) < 0.003
        ? `En el último mes, ${the} se mantiene estable ${where} (${price(today)} de media).`
        : `En el último mes, ${the} ha ${d < 0 ? "bajado" : "subido"} ${cents(d)} de media ${where}, de ${price(from)} a ${price(today)}.`;
}

const placeOf = (s: GasStation) => {
    const city = displayCity(s.city);
    const prov = displayProvince(s.province);
    return city === prov ? city : `${city} (${prov})`;
};

export interface Texts {
    paragraphs: Paragraph[];
    faq: { q: string; a: string }[];
}

/** Texto de la página de España. */
export function nationalTexts(data: FuelData, history?: AggPoint[]): Texts {
    const { config, stations, total, avg, provinces, kind } = data;
    const f = config.fuel;
    const cheapest = stations[0];
    const paragraphs: Paragraph[] = [];
    const faq: Texts["faq"] = [];

    const first: Paragraph = [
        `Hoy ${config.the} cuesta de media ${price(avg)} en España. Lo venden ${nf0.format(stations.length)} de las ${nf0.format(total)} gasolineras, repartidas por ${provinces.length} provincias, y la más barata es `,
        link(cheapest),
        `, en ${placeOf(cheapest)}, a ${price(cheapest.prices[f]!)}.`,
    ];
    paragraphs.push(first);
    faq.push({ q: `¿Cuánto cuesta ${config.the} hoy?`, a: plain(first) });

    const trend = trendText(history, avg, "en España", config.the);
    if (trend) {
        paragraphs.push([trend]);
        faq.push({ q: `¿Está subiendo o bajando el precio ${config.the === "el GLP" ? "del GLP" : "del gasóleo agrícola"}?`, a: trend });
    }

    // Provincias más baratas y más caras de media (con 3 gasolineras o más).
    const ranked = provinces.filter((p) => p.stations.length >= 3).sort((a, b) => a.avg - b.avg);
    if (ranked.length >= 6) {
        const item = (p: ProvinceFuel): Part[] => [{ text: p.label, href: fuelPageUrl(kind, p.name) }, ` (${price(p.avg)})`];
        const join = (items: Part[][]) => items.flatMap((it, i) => [...(i === 0 ? [] : [i === items.length - 1 ? " y " : ", "]), ...it]);
        const p: Paragraph = [
            `Por provincias, ${config.the} más barato de media está en `,
            ...join(ranked.slice(0, 3).map(item)),
            "; el más caro, en ",
            ...join(ranked.slice(-2).reverse().map(item)),
            ".",
        ];
        paragraphs.push(p);
        faq.push({ q: `¿En qué provincias es más barato ${config.the}?`, a: plain(p) });
    }

    faq.push({
        q: `¿Cuántas gasolineras venden ${config.short}?`,
        a: `Hoy lo venden ${nf0.format(stations.length)} de las ${nf0.format(total)} gasolineras de España con precios publicados. En cada provincia puedes ver todas, de la más barata a la más cara.`,
    });
    faq.push({ q: kind === "glp" ? "¿Qué es el GLP o autogás?" : "¿Quién puede usar el gasóleo agrícola?", a: config.about });
    return { paragraphs, faq };
}

/** Texto de la página de una provincia. */
export function provinceTexts(data: FuelData, prov: ProvinceFuel, history?: AggPoint[]): Texts {
    const { config, avg: national, provinces } = data;
    const f = config.fuel;
    const { label, stations } = prov;
    const n = stations.length;
    const cheapest = stations[0];
    const paragraphs: Paragraph[] = [];
    const faq: Texts["faq"] = [];
    const city = (s: GasStation) => displayCity(s.city);

    // 1. Media frente a España y puesto entre las provincias.
    const rank = [...provinces].sort((a, b) => a.avg - b.avg).findIndex((p) => p.name === prov.name) + 1;
    const place =
        rank === 1
            ? `la provincia donde ${config.the} está más barato de media`
            : rank === provinces.length
              ? `la provincia donde ${config.the} está más caro de media`
              : `la ${rank}.ª provincia más barata para ${config.short} de las ${provinces.length} que lo tienen`;
    const first = n === 1
        ? `${cap(config.the)} cuesta ${price(prov.avg)} en la provincia de ${label}, ${versus(prov.avg, national)} la media de España (${price(national)}).`
        : `${cap(config.the)} cuesta de media ${price(prov.avg)} en la provincia de ${label}, ${versus(prov.avg, national)} la media de España (${price(national)}): es ${place}.`;
    paragraphs.push([first]);
    faq.push({ q: `¿Cuánto cuesta ${config.the} en ${label}?`, a: first });

    // 2. La más barata y la diferencia con la más cara.
    let cheapText: Paragraph;
    if (n === 1) {
        cheapText = [`Solo hay una gasolinera con ${config.short} en la provincia: `, link(cheapest), `, en ${city(cheapest)}, a ${price(cheapest.prices[f]!)}.`];
    } else {
        const dear = stations[n - 1];
        const d = dear.prices[f]! - cheapest.prices[f]!;
        cheapText = [`La más barata es `, link(cheapest), `, en ${city(cheapest)}, a ${price(cheapest.prices[f]!)}`];
        cheapText.push(
            d >= 0.005
                ? `; la más cara está a ${price(dear.prices[f]!)}. Son ${cents(d)} por litro de diferencia: ${euros(d * config.saving.litres)} ${config.saving.phrase}.`
                : `, y apenas hay diferencia con la más cara (${price(dear.prices[f]!)}).`
        );
    }
    paragraphs.push(cheapText);
    faq.push({ q: `¿Cuál es la gasolinera con ${config.short} más barata de ${label}?`, a: plain(cheapText) });

    // 3. En qué municipios hay (enlazados), los que más gasolineras tienen primero.
    const byCity = new Map<string, number>();
    for (const s of stations) byCity.set(s.city, (byCity.get(s.city) ?? 0) + 1);
    const cities = [...byCity.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"));
    const shown = cities.slice(0, 12);
    const rest = cities.length - shown.length;
    const cityParts: Part[] = shown.flatMap(([c, k], i) => [
        ...(i === 0 ? [] : [i === shown.length - 1 && !rest ? " y " : ", "]),
        { text: displayCity(c), href: municipioUrl(prov.name, c) },
        ...(k > 1 ? [` (${k})`] : []),
    ]);
    const where: Paragraph =
        cities.length === 1
            ? [`${n === 1 ? "Está" : `Las ${n} están`} en `, ...cityParts, "."]
            : [`Hay ${config.short} en ${cities.length} municipios de la provincia: `, ...cityParts, rest ? ` y ${rest} más.` : "."];
    paragraphs.push(where);
    faq.push({ q: `¿Dónde hay ${config.short} en ${label}?`, a: `${n === 1 ? "Una gasolinera lo vende" : `${n} gasolineras lo venden`} en la provincia de ${label}. ${plain(where)}` });

    // 4. Tendencia del último mes (histórico de la provincia).
    const trend = trendText(history, prov.avg, `en la provincia de ${label}`, config.the);
    if (trend) paragraphs.push([trend]);

    // 5. Abiertas 24 horas.
    if (n >= 2) {
        const open = stations.filter(is24h);
        const text: Paragraph = !open.length
            ? [`Ninguna de las ${n} gasolineras con ${config.short} de la provincia abre las 24 horas todos los días.`]
            : open.length === n
              ? [`Las ${n} gasolineras con ${config.short} de la provincia abren las 24 horas, todos los días.`]
              : [
                    `${open.length === 1 ? "Una" : open.length} de las ${n} gasolineras con ${config.short} de la provincia ${open.length === 1 ? "abre" : "abren"} las 24 horas todos los días${open.length === 1 ? ": " : "; la más barata de ellas es "}`,
                    link(open[0]),
                    `, en ${city(open[0])}, a ${price(open[0].prices[f]!)}.`,
                ];
        paragraphs.push(text);
        faq.push({ q: `¿Hay gasolineras con ${config.short} abiertas 24 horas en ${label}?`, a: plain(text) });
    }

    return { paragraphs, faq };
}
