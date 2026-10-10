/**
 * Texto propio de cada página de provincia, sacado de sus datos: puesto entre las
 * provincias de España, comparación con las más cercanas, diferencia entre la gasolinera
 * más barata y la más cara, municipios más baratos y más caros, tendencia del último
 * mes, marcas, gasolineras 24 horas y combustibles alternativos. Cada frase solo aparece
 * si el dato existe y dice algo.
 */
import type { FuelType, GasStation } from "../types/gasolinera";
import type { ScopeHistory } from "./aggHistory";
import { getDistance } from "./geo";
import { displayCity, displayProvince } from "./placeName";
import { municipioUrl, provinceUrl } from "./stationUrl";
import {
    FUEL,
    FUEL_NAMES,
    MAIN_FUELS,
    average,
    cents,
    cheapAdj,
    dearAdj,
    euros,
    is24h,
    isGeneric,
    link,
    plain,
    price,
    priced,
    versus,
    type Averages,
    type MainFuel,
    type Paragraph,
    type Part,
} from "./insightText";

const DAY = 86_400_000;
/** Provincias "cercanas": las 3 de centro más próximo a menos de esta distancia. */
const NEIGHBOR_KM = 400;
const ALT_FUELS: FuelType[] = ["glp", "gnc", "gnl", "hydrogen"];

export interface ProvinceRef {
    name: string; // como viene en los datos (para la URL)
    avg: Averages;
}

export interface ProvinceInsightInput {
    provinceName: string;
    stations: GasStation[];
    nationalAvg: Averages;
    /** Puesto de la provincia por precio medio (1 = la más barata) y nº de provincias. */
    rank: Partial<Record<MainFuel, { rank: number; total: number }>>;
    neighbors: ProvinceRef[];
    history?: ScopeHistory;
    now?: number;
}

export interface Insights {
    paragraphs: Paragraph[];
    faq: { q: string; a: string }[];
}

const ordinalFem = (n: number) => `${n}.ª`;

/** Media de hace ~30 días en el histórico (entre 21 y 45 días atrás). */
function monthAgo(points: { t: number; price: number }[] | undefined, now: number) {
    if (!points?.length) return undefined;
    const target = now - 30 * DAY;
    let ref = points[0];
    for (const p of points) if (Math.abs(p.t - target) < Math.abs(ref.t - target)) ref = p;
    const days = (now - ref.t) / DAY;
    return days >= 21 && days <= 45 ? ref.price : undefined;
}

const provLink = (p: ProvinceRef): Part => ({ text: displayProvince(p.name), href: provinceUrl(p.name) });
const joinParts = (items: Part[][]): Part[] =>
    items.flatMap((it, i) => [...(i === 0 ? [] : [i === items.length - 1 ? " y " : ", "]), ...it]);

export function provinceInsights(input: ProvinceInsightInput): Insights {
    const { provinceName, stations, nationalAvg, rank, neighbors, history } = input;
    const now = input.now ?? Date.now();
    const prov = displayProvince(provinceName);
    const n = stations.length;
    const paragraphs: Paragraph[] = [];
    const faq: Insights["faq"] = [];
    const avg: Averages = { sp95: average(stations, "sp95"), diesel: average(stations, "diesel") };

    // --- 1. Puesto entre las provincias de España ---
    const r95 = rank.sp95;
    if (avg.sp95 != null && r95 && nationalAvg.sp95 != null) {
        const place =
            r95.rank === 1
                ? "la provincia más barata de España"
                : r95.rank === r95.total
                  ? "la provincia más cara de España"
                  : `la ${ordinalFem(r95.rank)} provincia más barata de España (de ${r95.total})`;
        let text = `Con una media de ${price(avg.sp95)} para ${FUEL.sp95.name}, ${prov} es ${place}: ${versus(avg.sp95, nationalAvg.sp95, "sp95")} la media nacional (${price(nationalAvg.sp95)}).`;
        const rd = rank.diesel;
        if (avg.diesel != null && rd && nationalAvg.diesel != null) {
            const vs = `${versus(avg.diesel, nationalAvg.diesel, "diesel")} la media nacional`;
            text +=
                rd.rank === 1 || rd.rank === rd.total
                    ? ` Para el diésel (${price(avg.diesel)} de media) es ${(rd.rank === 1) === (r95.rank === 1) && (r95.rank === 1 || r95.rank === r95.total) ? "también " : ""}la ${rd.rank === 1 ? "más barata" : "más cara"}: ${vs}.`
                    : ` Para el diésel (${price(avg.diesel)} de media) ocupa el puesto ${rd.rank} de ${rd.total}, ${vs}.`;
        }
        paragraphs.push([text]);
        faq.push({ q: `¿Es cara la gasolina en ${prov}?`, a: text });
    }

    // --- 2. Frente a las provincias más cercanas ---
    const main: MainFuel = avg.sp95 != null ? "sp95" : "diesel";
    const near = neighbors.filter((p) => p.avg[main] != null && avg[main] != null);
    if (near.length) {
        const mine = avg[main]!;
        const cheaperThan = near.filter((p) => p.avg[main]! > mine + 0.0005);
        const dearerThan = near.filter((p) => p.avg[main]! < mine - 0.0005);
        const item = (p: ProvinceRef): Part[] => [provLink(p), ` (${price(p.avg[main]!)})`];
        const parts: Part[] = [`Frente a las provincias más cercanas, repostar ${FUEL[main].name} en ${prov} sale `];
        if (cheaperThan.length) parts.push("más barato que en ", ...joinParts(cheaperThan.map(item)));
        if (cheaperThan.length && dearerThan.length) parts.push(", y ");
        if (dearerThan.length) parts.push("más caro que en ", ...joinParts(dearerThan.map(item)));
        if (!cheaperThan.length && !dearerThan.length) parts.push("prácticamente igual que en ", ...joinParts(near.map(item)));
        parts.push(".");
        paragraphs.push(parts);
    }

    // --- 3. Diferencia entre la gasolinera más barata y la más cara ---
    const list = priced(stations, main);
    if (list.length >= 2) {
        const lo = list[0];
        const hi = list[list.length - 1];
        const diff = hi.prices[main]! - lo.prices[main]!;
        if (diff >= 0.005)
            paragraphs.push([
                `Entre la gasolinera más barata de la provincia (`,
                link(lo),
                `, en ${displayCity(lo.city)}, a ${price(lo.prices[main]!)}) y la más cara (${price(hi.prices[main]!)}) hay ${cents(diff)} por litro de ${FUEL[main].name}: ${euros(diff * 50)} en un depósito de 50 litros.`,
            ]);
    }

    // --- 4. Municipios más baratos y más caros de media (con 2 gasolineras o más) ---
    const byCity = new Map<string, GasStation[]>();
    for (const s of stations) (byCity.get(s.city) ?? byCity.set(s.city, []).get(s.city)!).push(s);
    const munis = [...byCity.entries()]
        .filter(([, l]) => l.filter((s) => s.prices[main] != null).length >= 2)
        .map(([city, l]) => ({ city, avg: average(l, main)! }))
        .sort((a, b) => a.avg - b.avg);
    if (munis.length >= 4) {
        const item = (m: { city: string; avg: number }): Part[] => [
            { text: displayCity(m.city), href: municipioUrl(provinceName, m.city) },
            ` (${price(m.avg)})`,
        ];
        const cheap = munis.slice(0, 3);
        const dear = munis.slice(-2).reverse().filter((m) => !cheap.includes(m));
        const p: Paragraph = [`Por municipios, ${FUEL[main].the} más ${cheapAdj(main)} de media está en `, ...joinParts(cheap.map(item))];
        if (dear.length) p.push(`; ${FUEL[main].fem ? "la" : "el"} más ${dearAdj(main)}, en `, ...joinParts(dear.map(item)));
        p.push(".");
        paragraphs.push(p);
        faq.push({ q: `¿En qué municipios de ${prov} está la gasolina más barata?`, a: plain(p) });
    }

    // --- 5. Tendencia: media de hoy frente a la de hace un mes (histórico real) ---
    const trends: string[] = [];
    for (const f of MAIN_FUELS) {
        const from = monthAgo(history?.[f], now);
        const to = avg[f];
        if (from == null || to == null) continue;
        const d = to - from;
        trends.push(
            Math.abs(d) < 0.003
                ? `${FUEL[f].the} se mantiene estable (${price(to)})`
                : `${FUEL[f].the} ha ${d < 0 ? "bajado" : "subido"} ${cents(d)} de media, de ${price(from)} a ${price(to)}`
        );
    }
    if (trends.length) {
        const text = `En el último mes, en la provincia de ${prov} ${trends.join(", y ")}.`;
        paragraphs.push([text]);
        faq.push({ q: `¿Está subiendo o bajando la gasolina en ${prov}?`, a: text });
    }

    // --- 6. Marcas: la más extendida y la más barata y más cara de media ---
    const byBrand = new Map<string, GasStation[]>();
    for (const s of stations) if (!isGeneric(s)) (byBrand.get(s.brand) ?? byBrand.set(s.brand, []).get(s.brand)!).push(s);
    const brands = [...byBrand.entries()].map(([brand, l]) => ({ brand, count: l.length, avg: average(l, main) }));
    const top = [...brands].sort((a, b) => b.count - a.count)[0];
    const ranked = brands.filter((b) => b.count >= 3 && b.avg != null).sort((a, b) => a.avg! - b.avg!);
    const brandSentences: string[] = [];
    if (top && top.count >= 3 && n >= 10) brandSentences.push(`${top.brand} es la marca con más gasolineras en la provincia (${top.count} de ${n}).`);
    if (ranked.length >= 2 && ranked[ranked.length - 1].avg! - ranked[0].avg! >= 0.005)
        brandSentences.push(
            `De media, ${ranked[0].brand} es la más barata para ${FUEL[main].name} (${price(ranked[0].avg!)} en ${ranked[0].count} gasolineras) y ${ranked[ranked.length - 1].brand} la más cara (${price(ranked[ranked.length - 1].avg!)} en ${ranked[ranked.length - 1].count}).`
        );
    if (brandSentences.length) paragraphs.push([brandSentences.join(" ")]);

    // --- 7. 24 horas y combustibles alternativos ---
    const extra: string[] = [];
    const open = stations.filter(is24h).length;
    if (n >= 2) extra.push(open ? `${open} de las ${n} gasolineras de ${prov} abren las 24 horas todos los días.` : `Ninguna gasolinera de ${prov} abre las 24 horas todos los días.`);
    const alt = ALT_FUELS.map((f) => ({ f, c: stations.filter((s) => s.prices[f] != null).length })).filter((x) => x.c > 0);
    if (alt.length) {
        // "hay 14 gasolineras con GLP (autogás), 2 con GNC y 1 con hidrógeno"
        const items = alt.map((x, k) => `${x.c}${k === 0 ? (x.c === 1 ? " gasolinera" : " gasolineras") : ""} con ${FUEL_NAMES[x.f]}`);
        extra.push(`En combustibles alternativos, hay ${items.length < 2 ? items[0] : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`}.`);
        const glp = alt.find((x) => x.f === "glp");
        if (glp) faq.push({ q: `¿Dónde repostar GLP en ${prov}?`, a: `Hay ${glp.c === 1 ? "una gasolinera" : `${glp.c} gasolineras`} con GLP (autogás) en la provincia de ${prov}. Puedes verlas en el explorador eligiendo GLP como combustible.` });
    }
    if (extra.length) paragraphs.push([extra.join(" ")]);

    return { paragraphs, faq };
}

/**
 * Prepara una vez, para todo el build, lo que cada provincia necesita comparar: medias
 * y puesto de todas las provincias y su centro (para buscar las cercanas).
 */
export function provinceInsightContext(today: GasStation[]) {
    const byProv = new Map<string, GasStation[]>();
    for (const s of today) if (s.province) (byProv.get(s.province) ?? byProv.set(s.province, []).get(s.province)!).push(s);
    const info = [...byProv.entries()].map(([name, l]) => {
        const located = l.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
        return {
            name,
            avg: { sp95: average(l, "sp95"), diesel: average(l, "diesel") } as Averages,
            lat: located.reduce((a, s) => a + s.lat, 0) / located.length,
            lng: located.reduce((a, s) => a + s.lng, 0) / located.length,
        };
    });
    const nationalAvg: Averages = { sp95: average(today, "sp95"), diesel: average(today, "diesel") };
    const ranks = new Map<string, ProvinceInsightInput["rank"]>();
    for (const f of MAIN_FUELS) {
        const sorted = info.filter((p) => p.avg[f] != null).sort((a, b) => a.avg[f]! - b.avg[f]!);
        sorted.forEach((p, i) => ranks.set(p.name, { ...(ranks.get(p.name) ?? {}), [f]: { rank: i + 1, total: sorted.length } }));
    }
    return (provinceName: string, history?: ScopeHistory): ProvinceInsightInput => {
        const me = info.find((p) => p.name === provinceName)!;
        const neighbors = info
            .filter((p) => p.name !== provinceName)
            .map((p) => ({ p, d: getDistance(me.lat, me.lng, p.lat, p.lng) }))
            .filter((x) => x.d <= NEIGHBOR_KM)
            .sort((a, b) => a.d - b.d)
            .slice(0, 3)
            .map((x) => ({ name: x.p.name, avg: x.p.avg }));
        return {
            provinceName,
            stations: byProv.get(provinceName) ?? [],
            nationalAvg,
            rank: ranks.get(provinceName) ?? {},
            neighbors,
            history,
        };
    };
}

