/**
 * Páginas por marca: /marcas/ (qué marca es más barata), /marcas/repsol/ (una marca en
 * toda España) y /marcas/repsol/madrid/ (una marca en una provincia), con los precios de
 * hoy y texto sacado de los datos, como las de municipios y provincias.
 *
 * Para que una página no aparezca y desaparezca de un día para otro, los mínimos de
 * gasolineras cuentan también las que hoy no han publicado precios pero sí en los
 * últimos días (missingStations.ts); los precios y las medias, solo con las de hoy.
 */
import fs from "node:fs";
import path from "node:path";
import type { GasStation } from "../types/gasolinera";
import { BRAND_LOGO_FILES } from "./brandLogos";
import { loadMissingStations } from "./missingStations";
import { displayCity, displayProvince, placeSlug } from "./placeName";
import { slugify } from "./slug";
import { municipioUrl, stationUrl } from "./stationUrl";
import { displayAddress } from "./format";
import {
    FUEL,
    MAIN_FUELS,
    cap,
    cents,
    euros,
    is24h,
    isGeneric,
    joinEs,
    link,
    plain,
    price,
    versus,
    type Averages,
    type MainFuel,
    type Paragraph,
    type Part,
} from "./insightText";

/** Gasolineras que necesita una marca para tener página. */
export const BRAND_MIN = 10;
/** Y en una provincia, para tener la suya (/marcas/repsol/madrid/). */
export const BRAND_PROVINCE_MIN = 5;
/** Gasolineras con precio que necesita una marca para entrar en las comparaciones de una provincia. */
const RANK_PROVINCE_MIN = 3;
/** Litros de un depósito, para pasar céntimos a euros. */
const TANK = 50;

export interface BrandProvince {
    /** Como viene en los datos. */
    name: string;
    label: string;
    slug: string;
    /** Sus gasolineras de la marca con precios hoy. */
    stations: GasStation[];
    avg: Averages;
    hasPage: boolean;
}

/** Cambio medio del último mes en las mismas gasolineras: la marca y toda España. */
export type Trend = Partial<Record<MainFuel, { brand: number; national: number }>>;

export interface Brand {
    name: string;
    slug: string;
    /** Fichero del logo en /brands/, si lo hay. */
    logo?: string;
    /** Con precios hoy. */
    stations: GasStation[];
    avg: Averages;
    /** Provincias con alguna de sus gasolineras hoy, por orden alfabético. */
    provinces: BrandProvince[];
    trend?: Trend;
    /** Casi todas en Canarias, Ceuta o Melilla, donde el combustible paga menos impuestos. */
    lowTax: boolean;
    /** En ese caso, dónde: "Canarias" o "Ceuta y Melilla". */
    region?: string;
}

export interface BrandsData {
    /** Marcas con página, de la que más gasolineras tiene a la que menos. */
    brands: Brand[];
    bySlug: Map<string, Brand>;
    /** Gasolineras con precios hoy (todas las marcas). */
    total: number;
    national: Averages;
    /** Marcas con página y BRAND_MIN precios del combustible, de la más barata a la más cara. */
    ranking: Record<MainFuel, Brand[]>;
    /** Gasolineras de hoy por provincia (todas las marcas) y sus medias. */
    provinceStations: Map<string, GasStation[]>;
    provinceAvg: Map<string, Averages>;
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const nf0 = new Intl.NumberFormat("es-ES");

function avgOf(list: GasStation[]): Averages {
    const out: Averages = {};
    for (const f of MAIN_FUELS) {
        const v = list.map((s) => s.prices[f]).filter((p): p is number => p != null);
        if (v.length) out[f] = mean(v);
    }
    return out;
}

const pricedCount = (list: GasStation[], f: MainFuel) => list.filter((s) => s.prices[f] != null).length;
const byPrice = (f: MainFuel) => (a: GasStation, b: GasStation) => (a.prices[f] ?? Infinity) - (b.prices[f] ?? Infinity);

/** Provincias donde el combustible paga menos impuestos (IGIC o IPSI en vez de IVA, y otros impuestos especiales). */
const LOW_TAX = new Set(["PALMAS (LAS)", "SANTA CRUZ DE TENERIFE", "CEUTA", "MELILLA"]);

/**
 * Gasolineras de la marca con las que comparar en toda España: sin las de Canarias, Ceuta
 * y Melilla (salvo en las marcas de allí), que por los impuestos siempre salen las más
 * baratas y no le sirven a quien vive en la península. `mainland`: si se han quitado.
 */
export function comparable(brand: Brand): { stations: GasStation[]; mainland: boolean } {
    if (brand.lowTax) return { stations: brand.stations, mainland: false };
    const stations = brand.stations.filter((s) => !LOW_TAX.has(s.province));
    return stations.length && stations.length < brand.stations.length ? { stations, mainland: true } : { stations: brand.stations, mainland: false };
}

/** Marca con nombre propio: ni "Nº 10.935" ni "(Sin Rótulo)". */
const hasBrand = (s: GasStation) => !isGeneric(s) && !!s.brand && !s.brand.startsWith("(") && !!slugify(s.brand);

/**
 * Precios de hace unos 30 días (el snapshot de data-archive/ más cercano, entre 21 y 45
 * días atrás), por id de gasolinera. Sin snapshots (integración continua), nada.
 */
function monthAgoPrices(): Map<string, GasStation["prices"]> | undefined {
    const dir = path.resolve("data-archive");
    if (!fs.existsSync(dir)) return undefined;
    const now = Date.now();
    let best: { file: string; diff: number } | undefined;
    for (const file of fs.readdirSync(dir)) {
        const m = file.match(/^stations-(\d{4}-\d{2}-\d{2})\.json$/);
        if (!m) continue;
        const days = (now - Date.parse(`${m[1]}T12:00:00Z`)) / 86_400_000;
        if (days < 21 || days > 45) continue;
        const diff = Math.abs(days - 30);
        if (!best || diff < best.diff) best = { file, diff };
    }
    if (!best) return undefined;
    try {
        const list = JSON.parse(fs.readFileSync(path.join(dir, best.file), "utf8")) as GasStation[];
        return new Map(list.map((s) => [s.id, s.prices]));
    } catch {
        return undefined;
    }
}

/** Cambio medio de cada gasolinera de la lista entre hace un mes y hoy (con 5 o más). */
function changeOf(list: GasStation[], before: Map<string, GasStation["prices"]>, f: MainFuel): number | undefined {
    const d: number[] = [];
    for (const s of list) {
        const then = before.get(s.id)?.[f];
        if (s.prices[f] != null && then != null) d.push(s.prices[f]! - then);
    }
    return d.length >= 5 ? mean(d) : undefined;
}

let cache: BrandsData | undefined;

export function brandsData(): BrandsData {
    if (cache) return cache;
    const today = JSON.parse(fs.readFileSync(path.resolve("public/data/stations.json"), "utf-8")) as GasStation[];
    const missing = loadMissingStations(today);

    const provinceStations = new Map<string, GasStation[]>();
    for (const s of today) (provinceStations.get(s.province) ?? provinceStations.set(s.province, []).get(s.province)!).push(s);
    const provinceAvg = new Map([...provinceStations].map(([p, l]) => [p, avgOf(l)]));

    // Recuento con las que hoy no publican (para los mínimos) y gasolineras de hoy, por marca.
    const counts = new Map<string, { all: number; byProv: Map<string, number> }>();
    for (const s of [...today, ...missing]) {
        if (!hasBrand(s)) continue;
        const c = counts.get(s.brand) ?? counts.set(s.brand, { all: 0, byProv: new Map() }).get(s.brand)!;
        c.all++;
        c.byProv.set(s.province, (c.byProv.get(s.province) ?? 0) + 1);
    }
    const todayByBrand = new Map<string, GasStation[]>();
    for (const s of today) if (hasBrand(s)) (todayByBrand.get(s.brand) ?? todayByBrand.set(s.brand, []).get(s.brand)!).push(s);

    const before = monthAgoPrices();
    const nationalChange: Partial<Record<MainFuel, number>> = {};
    if (before) for (const f of MAIN_FUELS) nationalChange[f] = changeOf(today, before, f);

    const brands: Brand[] = [];
    const bySlug = new Map<string, Brand>();
    for (const [name, c] of [...counts].sort((a, b) => b[1].all - a[1].all)) {
        const stations = todayByBrand.get(name);
        if (c.all < BRAND_MIN || !stations?.length) continue;
        const slug = slugify(name);
        if (bySlug.has(slug)) {
            console.warn(`[marcas] "${name}" y "${bySlug.get(slug)!.name}" comparten URL (/marcas/${slug}/): solo sale la segunda.`);
            continue;
        }
        const byProv = new Map<string, GasStation[]>();
        for (const s of stations) (byProv.get(s.province) ?? byProv.set(s.province, []).get(s.province)!).push(s);
        const provinces: BrandProvince[] = [...byProv]
            .map(([pname, list]) => ({
                name: pname,
                label: displayProvince(pname),
                slug: placeSlug(pname),
                stations: list,
                avg: avgOf(list),
                hasPage: (c.byProv.get(pname) ?? 0) >= BRAND_PROVINCE_MIN && !!placeSlug(pname),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, "es"));
        let trend: Trend | undefined;
        if (before) {
            trend = {};
            for (const f of MAIN_FUELS) {
                const b = changeOf(stations, before, f);
                if (b != null && nationalChange[f] != null) trend[f] = { brand: b, national: nationalChange[f]! };
            }
        }
        const share = (provs: string[]) => stations.filter((s) => provs.includes(s.province)).length / stations.length;
        const region = share(["PALMAS (LAS)", "SANTA CRUZ DE TENERIFE"]) >= 0.8 ? "Canarias" : share(["CEUTA", "MELILLA"]) >= 0.8 ? "Ceuta y Melilla" : undefined;
        const lowTax = share([...LOW_TAX]) >= 0.8;
        const brand: Brand = { name, slug, logo: BRAND_LOGO_FILES[slug], stations, avg: avgOf(stations), provinces, trend, lowTax, region };
        brands.push(brand);
        bySlug.set(slug, brand);
    }

    const ranking = {} as Record<MainFuel, Brand[]>;
    for (const f of MAIN_FUELS)
        ranking[f] = brands.filter((b) => pricedCount(b.stations, f) >= BRAND_MIN).sort((a, b) => a.avg[f]! - b.avg[f]!);

    cache = { brands, bySlug, total: today.length, national: avgOf(today), ranking, provinceStations, provinceAvg };
    return cache;
}

export const brandUrl = (brand: Brand, province?: BrandProvince) =>
    province ? `/marcas/${brand.slug}/${province.slug}/` : `/marcas/${brand.slug}/`;

/**
 * Página de la marca de una gasolinera: la de su provincia si la tiene, si no la de
 * España, o ninguna. Para enlazarla desde las fichas.
 */
export function brandPageFor(station: GasStation): { url: string; brand: Brand; province?: BrandProvince } | undefined {
    if (!hasBrand(station)) return undefined;
    const brand = brandsData().bySlug.get(slugify(station.brand));
    if (!brand || brand.name !== station.brand) return undefined;
    const province = brand.provinces.find((p) => p.name === station.province && p.hasPage);
    return { url: brandUrl(brand, province), brand, province };
}

/** Marcas con página en una provincia, de la que más gasolineras tiene allí a la que menos. */
export function brandsInProvince(province: string): { brand: Brand; province: BrandProvince }[] {
    return brandsData()
        .brands.flatMap((brand) => {
            const p = brand.provinces.find((x) => x.name === province && x.hasPage);
            return p ? [{ brand, province: p }] : [];
        })
        .sort((a, b) => b.province.stations.length - a.province.stations.length);
}

export interface Texts {
    paragraphs: Paragraph[];
    faq: { q: string; a: string }[];
}

/** "la más barata", "la 3.ª más barata", "la 2.ª más cara" o "la más cara" de `of`. */
const rankWord = (pos: number, of: number) =>
    pos === 1 ? "la más barata" : pos === of ? "la más cara" : pos <= of / 2 ? `la ${pos}.ª más barata` : `la ${of - pos + 1}.ª más cara`;

/** Enlace a una gasolinera por su dirección (cuando ya se sabe la marca). */
const addressLink = (s: GasStation): Part => ({ text: displayAddress(s.address), href: stationUrl(s) });

const placeOf = (s: GasStation) => {
    const city = displayCity(s.city);
    const prov = displayProvince(s.province);
    return city === prov ? city : `${city} (${prov})`;
};

/** Enlaces separados por comas y "y". */
const joinParts = (items: Part[][]): Part[] => items.flatMap((it, i) => [...(i === 0 ? [] : [i === items.length - 1 ? " y " : ", "]), ...it]);

/** Precio medio de los dos combustibles frente a una referencia, en una frase. */
function pricesVersus(avg: Averages, ref: Averages, refName: string): string | undefined {
    const fuels = MAIN_FUELS.filter((f) => avg[f] != null && ref[f] != null);
    if (!fuels.length) return undefined;
    const [a, b] = fuels;
    const first = `${FUEL[a].the} cuesta ${price(avg[a]!)}, ${versus(avg[a]!, ref[a]!, a)} ${refName} (${price(ref[a]!)})`;
    return b ? `${first}, y ${FUEL[b].the}, ${price(avg[b]!)} (${versus(avg[b]!, ref[b]!, b)} ${refName}, ${price(ref[b]!)})` : first;
}

/** La más barata de la lista para cada combustible, juntas si es la misma gasolinera (el punto final, aparte). */
function cheapestParagraph(list: GasStation[], who: string, where: (s: GasStation) => string): Paragraph | undefined {
    const best = MAIN_FUELS.map((f) => ({ f, s: [...list].sort(byPrice(f))[0] })).filter((x) => x.s?.prices[x.f] != null);
    if (!best.length) return undefined;
    const [a, b] = best;
    if (b && a.s.id === b.s.id)
        return [`${cap(who)} más barata para gasolina 95 y diésel está en `, addressLink(a.s), `, en ${where(a.s)}: ${price(a.s.prices.sp95!)} y ${price(a.s.prices.diesel!)}`, "."];
    const p: Paragraph = [`${cap(who)} más barata para ${FUEL[a.f].name} está en `, addressLink(a.s), `, en ${where(a.s)}, a ${price(a.s.prices[a.f]!)}`];
    if (b) p.push(`; para ${FUEL[b.f].name}, en `, addressLink(b.s), `, en ${where(b.s)}, a ${price(b.s.prices[b.f]!)}`);
    p.push(".");
    return p;
}

/** Cuántas abren 24 horas. */
function open24Text(list: GasStation[], brand: string, where: string): string | undefined {
    const n = list.length;
    if (n < 2) return undefined;
    const k = list.filter(is24h).length;
    if (!k) return `Ninguna de las ${n} gasolineras ${brand}${where} abre las 24 horas todos los días.`;
    if (k === n) return `Las ${n} gasolineras ${brand}${where} abren las 24 horas, todos los días.`;
    return `${k === 1 ? "Una" : nf0.format(k)} de las ${nf0.format(n)} gasolineras ${brand}${where} ${k === 1 ? "abre" : "abren"} las 24 horas todos los días (${Math.round((k / n) * 100)}\u00a0%).`;
}

/** Texto de /marcas/{marca}/. */
export function brandTexts(data: BrandsData, brand: Brand): Texts {
    const { name, stations, avg, provinces } = brand;
    const paragraphs: Paragraph[] = [];
    const faq: Texts["faq"] = [];
    const n = stations.length;

    // 1. Cuántas y dónde.
    const top = [...provinces].sort((a, b) => b.stations.length - a.stations.length).slice(0, 3);
    const where = provinces.length > 3 ? `, sobre todo en ${joinEs(top.map((p) => `${p.label} (${p.stations.length})`))}` : "";
    const first = `Hoy hay ${nf0.format(n)} gasolineras ${name} con precios publicados en España, en ${provinces.length} ${provinces.length === 1 ? "provincia" : "provincias"}${where}.`;
    paragraphs.push([first]);
    faq.push({ q: `¿Cuántas gasolineras ${name} hay en España?`, a: first });

    // 2. Precio medio frente a España.
    const vs = pricesVersus(avg, data.national, "la media de España");
    if (vs) {
        const text = `De media, en las gasolineras ${name} ${vs}.${
            brand.lowTax ? ` Casi todas están en ${brand.region ?? "Canarias, Ceuta o Melilla"}, donde el combustible paga menos impuestos que en la península y Baleares: por eso su media queda por debajo de la de España.` : ""
        }`;
        paragraphs.push([text]);
        faq.push({ q: `¿Cuánto cuesta la gasolina en ${name} hoy?`, a: text });
    }

    // 3. Puesto entre las marcas.
    const ranks = MAIN_FUELS.map((f) => ({ f, list: data.ranking[f], pos: data.ranking[f].indexOf(brand) + 1 })).filter((r) => r.pos > 0);
    if (ranks.length) {
        const [a, b] = ranks;
        const p: Paragraph = [
            `Entre las marcas con al menos ${BRAND_MIN} gasolineras, ${name} es ${rankWord(a.pos, a.list.length)} para ${FUEL[a.f].name} (de ${a.list.length})`,
            b ? ` y ${rankWord(b.pos, b.list.length)} para ${FUEL[b.f].name} (de ${b.list.length})` : "",
            ". ",
            { text: "Ver todas las marcas, de la más barata a la más cara", href: "/marcas/" },
            ".",
        ];
        paragraphs.push(p);
        faq.push({
            q: `¿Es ${name} más barata que otras marcas?`,
            a: plain(p.slice(0, 3)).trim(),
        });
    }

    // 4. Sus gasolineras más baratas.
    const pool = comparable(brand);
    const cheap = cheapestParagraph(pool.stations, `${pool.mainland ? "en la península y Baleares, " : ""}la ${name}`, placeOf);
    if (cheap) {
        paragraphs.push(cheap);
        faq.push({ q: `¿Cuál es la gasolinera ${name} más barata?`, a: plain(cheap) });
    }

    // 5. Provincias donde está más barata y más cara (con varias gasolineras).
    // Sin Canarias, Ceuta y Melilla (salvo en sus marcas): allí siempre sale más barata por los impuestos.
    const qualified = (x: MainFuel) =>
        provinces
            .filter((p) => pricedCount(p.stations, x) >= RANK_PROVINCE_MIN && (brand.lowTax || !LOW_TAX.has(p.name)))
            .sort((a, b) => a.avg[x]! - b.avg[x]!);
    const f: MainFuel = qualified("sp95").length >= 6 ? "sp95" : "diesel";
    const ranked = qualified(f);
    if (ranked.length >= 6) {
        const item = (p: BrandProvince): Part[] => [p.hasPage ? { text: p.label, href: brandUrl(brand, p) } : p.label, ` (${price(p.avg[f]!)})`];
        const mainland = !brand.lowTax && provinces.some((p) => LOW_TAX.has(p.name));
        paragraphs.push([
            `${mainland ? "En la península y Baleares" : "Por provincias"}, ${FUEL[f].the} de ${name} está más ${FUEL[f].fem ? "barata" : "barato"} de media en `,
            ...joinParts(ranked.slice(0, 3).map(item)),
            ", y más ",
            FUEL[f].fem ? "cara" : "caro",
            " en ",
            ...joinParts(ranked.slice(-2).reverse().map(item)),
            ".",
        ]);
    }

    // 6. Último mes, en las mismas gasolineras.
    const trendFuels = MAIN_FUELS.filter((x) => brand.trend?.[x]);
    if (trendFuels.length) {
        const part = (x: MainFuel) => {
            const { brand: d, national } = brand.trend![x]!;
            const dir = Math.abs(d) < 0.0005 ? "se ha mantenido" : `ha ${d < 0 ? "bajado" : "subido"} ${cents(d)}`;
            return `${FUEL[x].the} ${dir} de media (en toda España, ${Math.abs(national) < 0.0005 ? "igual" : `${national < 0 ? "−" : "+"}${cents(national)}`})`;
        };
        const text = `En el último mes, en las gasolineras ${name} ${trendFuels.map(part).join(", y ")}.`;
        paragraphs.push([text]);
        faq.push({ q: `¿Ha bajado el precio en ${name} este mes?`, a: text });
    }

    // 7. Abiertas 24 horas.
    const open = open24Text(stations, name, " de España");
    if (open) {
        paragraphs.push([open]);
        faq.push({ q: `¿Cuántas gasolineras ${name} abren 24 horas?`, a: open });
    }
    return { paragraphs, faq };
}

/** Texto de /marcas/{marca}/{provincia}/. */
export function brandProvinceTexts(data: BrandsData, brand: Brand, bp: BrandProvince): Texts {
    const { name } = brand;
    const { label, stations, avg } = bp;
    const n = stations.length;
    const paragraphs: Paragraph[] = [];
    const faq: Texts["faq"] = [];

    // 1. Cuántas y en qué municipios (enlazados), los que más tienen primero.
    const byCity = new Map<string, number>();
    for (const s of stations) byCity.set(s.city, (byCity.get(s.city) ?? 0) + 1);
    const cities = [...byCity].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"));
    const shown = cities.slice(0, 10);
    const rest = cities.length - shown.length;
    const cityParts: Part[] = shown.flatMap(([c, k], i) => [
        ...(i === 0 ? [] : [i === shown.length - 1 && !rest ? " y " : ", "]),
        { text: displayCity(c), href: municipioUrl(bp.name, c) },
        ...(k > 1 ? [` (${k})`] : []),
    ]);
    const first: Paragraph =
        cities.length === 1
            ? [`En la provincia de ${label} hay ${n} gasolineras ${name} con precios hoy, todas en `, ...cityParts, "."]
            : [`En la provincia de ${label} hay ${n} gasolineras ${name} con precios hoy, en ${cities.length} municipios: `, ...cityParts, rest ? ` y ${rest} más.` : "."];
    paragraphs.push(first);
    faq.push({ q: `¿Cuántas gasolineras ${name} hay en ${label}?`, a: plain(first) });

    // 2. Precio medio frente a la provincia y a la marca en España.
    const provAvg = data.provinceAvg.get(bp.name) ?? {};
    const vsProv = pricesVersus(avg, provAvg, "la media de la provincia");
    if (vsProv) {
        const f = MAIN_FUELS.find((x) => avg[x] != null && brand.avg[x] != null);
        const vsBrand = f ? ` En el conjunto de España, ${FUEL[f].the} de ${name} está a ${price(brand.avg[f]!)} de media.` : "";
        const text = `De media, en las gasolineras ${name} de ${label} ${vsProv}.${vsBrand}`;
        paragraphs.push([text]);
        faq.push({ q: `¿Cuánto cuesta la gasolina en ${name} en ${label}?`, a: text });
    }

    // 3. Puesto entre las marcas de la provincia.
    const provList = data.provinceStations.get(bp.name) ?? [];
    const byBrand = new Map<string, GasStation[]>();
    for (const s of provList) if (hasBrand(s)) (byBrand.get(s.brand) ?? byBrand.set(s.brand, []).get(s.brand)!).push(s);
    const ranks = MAIN_FUELS.map((f) => {
        const list = [...byBrand]
            .filter(([, l]) => pricedCount(l, f) >= RANK_PROVINCE_MIN)
            .map(([b, l]) => ({ b, avg: avgOf(l)[f]! }))
            .sort((x, y) => x.avg - y.avg);
        return { f, of: list.length, pos: list.findIndex((x) => x.b === name) + 1 };
    }).filter((r) => r.pos > 0 && r.of >= 3);
    if (ranks.length) {
        const [a, b] = ranks;
        const text = `Entre las marcas con al menos ${RANK_PROVINCE_MIN} gasolineras en la provincia, ${name} es ${rankWord(a.pos, a.of)} para ${FUEL[a.f].name} (de ${a.of})${b ? ` y ${rankWord(b.pos, b.of)} para ${FUEL[b.f].name} (de ${b.of})` : ""}.`;
        paragraphs.push([text]);
        faq.push({ q: `¿Es ${name} de las más baratas en ${label}?`, a: text });
    }

    // 4. Su más barata y la diferencia con su más cara.
    const city = (s: GasStation) => displayCity(s.city);
    const cheap = cheapestParagraph(stations, `la ${name}`, city);
    if (cheap) {
        const f: MainFuel = pricedCount(stations, "sp95") ? "sp95" : "diesel";
        const sorted = stations.filter((s) => s.prices[f] != null).sort(byPrice(f));
        const d = sorted.length >= 2 ? sorted[sorted.length - 1].prices[f]! - sorted[0].prices[f]! : 0;
        if (d >= 0.005) {
            cheap.pop();
            cheap.push(
                `. Entre la ${name} más barata y la más cara de la provincia hay ${cents(d)} por litro de ${FUEL[f].name}: ${euros(d * TANK)} en un depósito de ${TANK} litros.`
            );
        }
        paragraphs.push(cheap);
        faq.push({ q: `¿Cuál es la gasolinera ${name} más barata de ${label}?`, a: plain(cheap) });
    }

    // 5. Si la marca da igual: la más barata de la provincia.
    for (const f of MAIN_FUELS) {
        const mine = stations.filter((s) => s.prices[f] != null).sort(byPrice(f))[0];
        const any = provList.filter((s) => s.prices[f] != null).sort(byPrice(f))[0];
        if (!mine || !any || any.brand === name || mine.prices[f]! - any.prices[f]! < 0.005) continue;
        paragraphs.push([
            `Si la marca te da igual, la gasolinera con ${FUEL[f].the} más ${FUEL[f].fem ? "barata" : "barato"} de la provincia es `,
            link(any),
            `, en ${city(any)}, a ${price(any.prices[f]!)}: ${cents(mine.prices[f]! - any.prices[f]!)} menos que la ${name} más barata.`,
        ]);
        break;
    }

    // 6. Abiertas 24 horas.
    const open = open24Text(stations, name, ` de ${label}`);
    if (open) {
        paragraphs.push([open]);
        faq.push({ q: `¿Hay gasolineras ${name} abiertas 24 horas en ${label}?`, a: open });
    }
    return { paragraphs, faq };
}

/** Texto de /marcas/. */
export function brandsIndexTexts(data: BrandsData): Texts {
    const paragraphs: Paragraph[] = [];
    const faq: Texts["faq"] = [];
    const a = (b: Brand): Part => ({ text: b.name, href: brandUrl(b) });

    // 1. La más barata y la más cara de cada combustible.
    for (const f of MAIN_FUELS) {
        const list = data.ranking[f];
        if (list.length < 3) continue;
        const lo = list[0];
        const hi = list[list.length - 1];
        const d = hi.avg[f]! - lo.avg[f]!;
        const p: Paragraph = [
            `Para ${FUEL[f].name}, la marca más barata de media es `,
            a(lo),
            ` (${price(lo.avg[f]!)} en sus ${pricedCount(lo.stations, f)} gasolineras) y la más cara, `,
            a(hi),
            ` (${price(hi.avg[f]!)}): ${cents(d)} por litro de diferencia, ${euros(d * TANK)} en un depósito de ${TANK} litros. La media de España está en ${price(data.national[f]!)}.`,
        ];
        // Las de Canarias, Ceuta y Melilla salen más baratas por los impuestos: también la más barata del resto.
        const mainland = list.find((b) => !b.lowTax);
        if (lo.lowTax && mainland)
            p.push(
                ` ${lo.name} está casi solo en ${lo.region ?? "Canarias, Ceuta o Melilla"}, donde el combustible paga menos impuestos; en la península y Baleares, la más barata es `,
                a(mainland),
                ` (${price(mainland.avg[f]!)}).`
            );
        paragraphs.push(p);
        faq.push({ q: f === "sp95" ? "¿Qué marca de gasolinera es la más barata?" : "¿Qué marca tiene el diésel más barato?", a: plain(p) });
    }

    // 2. Las que más gasolineras tienen, de la más barata a la más cara.
    const big = data.brands.slice(0, 5).filter((b) => b.avg.sp95 != null);
    if (big.length >= 3) {
        const sorted = [...big].sort((x, y) => x.avg.sp95! - y.avg.sp95!);
        const p: Paragraph = [
            `De las ${big.length} marcas con más gasolineras, de la más barata a la más cara para gasolina 95: `,
            ...joinParts(sorted.map((b) => [a(b), ` (${price(b.avg.sp95!)})`])),
            ".",
        ];
        paragraphs.push(p);
        const [x, y] = data.brands;
        if (x?.avg.sp95 != null && y?.avg.sp95 != null) {
            const cheaper = x.avg.sp95 <= y.avg.sp95 ? x : y;
            const dearer = cheaper === x ? y : x;
            faq.push({
                q: `¿Es más barata ${x.name} o ${y.name}?`,
                a: `De media, hoy es más barata ${cheaper.name}: ${price(cheaper.avg.sp95!)} la gasolina 95 frente a ${price(dearer.avg.sp95!)} en ${dearer.name}${
                    cheaper.avg.diesel != null && dearer.avg.diesel != null ? `, y ${price(cheaper.avg.diesel)} el diésel frente a ${price(dearer.avg.diesel)}` : ""
                }. Pero cada gasolinera pone su precio: en tu zona puede ser al revés.`,
            });
        }
    }

    faq.push({
        q: "¿Cuántas marcas de gasolineras hay en España?",
        a: `Hoy publican precios ${nf0.format(data.total)} gasolineras. ${data.brands.length} marcas tienen al menos ${BRAND_MIN}; el resto son marcas pequeñas o gasolineras independientes.`,
    });
    faq.push({
        q: "¿Por qué una misma marca tiene precios distintos?",
        a: "Muchas gasolineras de una marca son de dueños distintos que fijan su propio precio, y el precio cambia con la zona, la competencia cercana y los impuestos de cada comunidad. Por eso conviene comparar gasolineras concretas, no solo marcas.",
    });
    return { paragraphs, faq };
}
