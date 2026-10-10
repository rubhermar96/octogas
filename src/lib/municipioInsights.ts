/**
 * Texto propio de cada página de municipio, sacado de sus datos (no de una plantilla
 * con los números cambiados): diferencia entre la más barata y la más cara, comparación
 * con la provincia y con España, zona más barata, tendencia del último mes, gasolineras
 * 24 horas, marcas y alternativas más baratas cerca. Cada frase solo aparece si el dato
 * existe y dice algo (un municipio con una gasolinera no tiene "zona más barata").
 */
import type { GasStation } from "../types/gasolinera";
import type { ScopeHistory } from "./aggHistory";
import { getDistance } from "./geo";
import { displayAddress } from "./format";
import { displayCity } from "./placeName";
import {
    FUEL,
    MAIN_FUELS as FUELS,
    average,
    cap,
    cents,
    cheapAdj,
    euros,
    is24h,
    isGeneric,
    km,
    link,
    pick,
    plain,
    price,
    priced,
    scheduleText,
    versus,
    type Alternative,
    type Averages,
    type MainFuel,
    type Paragraph,
} from "./insightText";

export type { Alternative, Averages, MainFuel, Part, Paragraph } from "./insightText";

export interface InsightInput {
    muni: string; // nombre para mostrar
    prov: string;
    slug: string; // para variar la redacción entre municipios de forma estable
    stations: GasStation[];
    provinceAvg: Averages;
    provinceCount: number; // gasolineras de la provincia
    nationalAvg: Averages;
    history?: ScopeHistory; // medias diarias del municipio (histórico real)
    /** Gasolineras de otros municipios a menos de NEARBY_KM del centro de este. */
    nearby: Alternative[];
    /** Gasolineras del municipio que hoy no han publicado precios (último día visto). */
    missing?: (GasStation & { lastSeen: string })[];
    /** "6 de octubre": fecha legible de un día AAAA-MM-DD. */
    dayLabel?: (day: string) => string;
    now?: number;
}

export interface Insights {
    paragraphs: Paragraph[];
    faq: { q: string; a: string }[];
}

export const NEARBY_KM = 10;
const DAY = 86_400_000;

/** Calle de una dirección, sin número ni "S/N": clave para agrupar y texto para mostrar. */
function street(address: string): { key: string; text: string } | undefined {
    const text = address
        .split(",")[0]
        .trim()
        .replace(/\s+(S\/?N|SN|N[ºO°]?\s*\d.*|KM\.?\s*[\d.,]+.*|\d+\s*[A-Z]?)$/i, "")
        .trim();
    if (text.length < 4) return undefined;
    const key = text
        .toUpperCase()
        .replace(/^(AVDA\.?|AV\.?)\s/, "AVENIDA ")
        .replace(/^(CL\.?|C\/)\s*/, "CALLE ")
        .replace(/^CTRA\.?\s/, "CARRETERA ")
        .replace(/\b(DE|DEL|LA|LAS|LOS|EL)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return { key, text: displayAddress(text) };
}

/** Media de hace ~30 días en el histórico (entre 21 y 45 días atrás). */
function monthAgo(points: { t: number; price: number }[] | undefined, now: number) {
    if (!points?.length) return undefined;
    const target = now - 30 * DAY;
    let ref = points[0];
    for (const p of points) if (Math.abs(p.t - target) < Math.abs(ref.t - target)) ref = p;
    const days = (now - ref.t) / DAY;
    return days >= 21 && days <= 45 ? ref.price : undefined;
}

export function municipioInsights(input: InsightInput): Insights {
    if (input.stations.length === 0) return noPricesToday(input);
    const { muni, prov, slug, stations, provinceAvg, provinceCount, nationalAvg, history, nearby } = input;
    const now = input.now ?? Date.now();
    const n = stations.length;
    const paragraphs: Paragraph[] = [];
    const faq: Insights["faq"] = [];
    // Combustible principal del municipio: gasolina 95 si hay precios, si no diésel.
    const main: MainFuel = priced(stations, "sp95").length ? "sp95" : "diesel";
    const mainList = priced(stations, main);

    // --- 1. Una sola gasolinera: cuál es, su horario y cómo está de precio ---
    if (n === 1) {
        const s = stations[0];
        const sched = scheduleText(s.schedule);
        const p: Paragraph = [`${muni} tiene una sola gasolinera: `, link(s), sched ? `, que ${sched}.` : "."];
        const cmp = FUELS.filter((f) => s.prices[f] != null && provinceAvg[f] != null).map(
            (f, i) =>
                `${FUEL[f].the} a ${price(s.prices[f]!)}, ${versus(s.prices[f]!, provinceAvg[f]!, f)} ${i === 0 ? `la media de la provincia de ${prov}` : "la media provincial"}`
        );
        if (cmp.length) p.push(` Tiene ${cmp.join(", y ")}.`);
        paragraphs.push(p);
    }

    // --- 2. Diferencia entre la más barata y la más cara ---
    if (mainList.length >= 2) {
        const cheap = mainList[0];
        const dear = mainList[mainList.length - 1];
        const lo = cheap.prices[main]!;
        const hi = dear.prices[main]!;
        if (hi - lo < 0.005) {
            paragraphs.push([`En ${muni} el precio ${FUEL[main].of} apenas cambia de una gasolinera a otra: de ${price(lo)} a ${price(hi)}.`]);
        } else {
            const tank = euros((hi - lo) * 50);
            paragraphs.push(
                pick(slug, "spread", [
                    [
                        `Entre la gasolinera más barata y la más cara de ${muni} hay ${cents(hi - lo)} por litro de ${FUEL[main].name} (${price(lo)} frente a ${price(hi)}): llenar un depósito de 50 litros en la más barata, `,
                        link(cheap),
                        `, sale ${tank} más barato.`,
                    ],
                    [
                        `Elegir bien dónde repostar en ${muni} se nota: para ${FUEL[main].name}, la más barata, `,
                        link(cheap),
                        `, está a ${price(lo)} y la más cara a ${price(hi)}. Son ${cents(hi - lo)} por litro, ${tank} en un depósito de 50 litros.`,
                    ],
                ])
            );
        }
    }

    // --- 3. Media del municipio frente a la provincia y a España ---
    const averages: Partial<Record<MainFuel, number>> = {};
    for (const f of FUELS) averages[f] = average(stations, f);
    if (n >= 2) {
        const sentences: string[] = [];
        FUELS.forEach((f, i) => {
            const a = averages[f];
            if (a == null) return;
            const refs: string[] = [];
            if (provinceAvg[f] != null && provinceCount > n)
                refs.push(`${versus(a, provinceAvg[f]!, f)} la media ${i === 0 ? `de la provincia de ${prov}` : "provincial"} (${price(provinceAvg[f]!)})`);
            if (nationalAvg[f] != null) refs.push(`${versus(a, nationalAvg[f]!, f)} la ${i === 0 ? "de España" : "nacional"} (${price(nationalAvg[f]!)})`);
            if (!refs.length) return;
            sentences.push(
                i === 0 || !sentences.length
                    ? `${cap(FUEL[f].the)} cuesta de media ${price(a)} en ${muni}: ${refs.join(" y ")}.`
                    : `${cap(FUEL[f].the)}, a ${price(a)} de media, está ${refs.join(" y ")}.`
            );
        });
        if (sentences.length) paragraphs.push([sentences.join(" ")]);
    }

    // --- 4. Zona más barata: una calle que repite entre las más baratas o, si no,
    //        el código postal con la media más baja ---
    if (mainList.length >= 6) {
        const byStreet = new Map<string, { text: string; count: number }>();
        for (const s of mainList.slice(0, 6)) {
            const st = street(s.address);
            if (!st) continue;
            const e = byStreet.get(st.key) ?? { text: st.text, count: 0 };
            e.count++;
            byStreet.set(st.key, e);
        }
        const best = [...byStreet.values()].sort((a, b) => b.count - a.count)[0];
        let zone: string | undefined;
        if (best && best.count >= 2) {
            zone = `${best.text} concentra ${best.count} de las 6 gasolineras más baratas de ${muni} para ${FUEL[main].name}.`;
        } else {
            const byCp = new Map<string, number[]>();
            for (const s of mainList) if (s.postalCode) byCp.set(s.postalCode, [...(byCp.get(s.postalCode) ?? []), s.prices[main]!]);
            const cps = [...byCp.entries()]
                .filter(([, v]) => v.length >= 2)
                .map(([cp, v]) => ({ cp, avg: v.reduce((a, b) => a + b, 0) / v.length }))
                .sort((a, b) => a.avg - b.avg);
            const lo = cps[0];
            const hi = cps[cps.length - 1];
            if (cps.length >= 3 && hi.avg - lo.avg >= 0.005)
                zone = `Por zonas, el código postal ${lo.cp} tiene ${FUEL[main].the} más ${cheapAdj(main)} de media (${price(lo.avg)}), frente a ${price(hi.avg)} en el ${hi.cp}.`;
        }
        if (zone) {
            paragraphs.push([zone]);
            faq.push({ q: `¿En qué zona de ${muni} está la gasolina más barata?`, a: zone });
        }
    }

    // --- 5. Tendencia: media de hoy frente a la de hace un mes (histórico real) ---
    const trends: string[] = [];
    for (const f of FUELS) {
        const from = monthAgo(history?.[f], now);
        const to = averages[f];
        if (from == null || to == null) continue;
        const d = to - from;
        trends.push(
            Math.abs(d) < 0.003
                ? `${FUEL[f].the} se mantiene estable (${price(to)})`
                : `${FUEL[f].the} ha ${d < 0 ? "bajado" : "subido"} ${cents(d)}, de ${price(from)} a ${price(to)}`
        );
    }
    if (trends.length) {
        const text = `En el último mes, en ${muni} ${trends.join(", y ")}.`;
        paragraphs.push([text]);
        faq.push({ q: `¿Está subiendo o bajando el precio de la gasolina en ${muni}?`, a: text });
    }

    // --- 6. Gasolineras abiertas 24 horas ---
    if (n >= 2) {
        const open = stations.filter(is24h);
        if (open.length === 0) paragraphs.push([`Ninguna de las ${n} gasolineras de ${muni} abre las 24 horas.`]);
        else if (open.length === n) paragraphs.push([`Todas las gasolineras de ${muni} abren las 24 horas, todos los días.`]);
        else {
            const p: Paragraph = [
                open.length === 1
                    ? `Solo una de las ${n} gasolineras de ${muni} abre las 24 horas todos los días: `
                    : `${open.length} de las ${n} gasolineras de ${muni} abren las 24 horas todos los días; la más barata de ellas para ${FUEL[main].name} es `,
            ];
            const cheapOpen = priced(open, main)[0] ?? open[0];
            p.push(link(cheapOpen), cheapOpen.prices[main] != null ? `, a ${price(cheapOpen.prices[main]!)}.` : ".");
            paragraphs.push(p);
        }
    }

    // --- 7. Marcas: la más barata y la más cara de media (con al menos 2 gasolineras) ---
    if (n >= 6) {
        const byBrand = new Map<string, number[]>();
        for (const s of mainList) if (!isGeneric(s)) byBrand.set(s.brand, [...(byBrand.get(s.brand) ?? []), s.prices[main]!]);
        const brands = [...byBrand.entries()]
            .filter(([, v]) => v.length >= 2)
            .map(([brand, v]) => ({ brand, count: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length }))
            .sort((a, b) => a.avg - b.avg);
        const lo = brands[0];
        const hi = brands[brands.length - 1];
        if (brands.length >= 2 && hi.avg - lo.avg >= 0.005)
            paragraphs.push([
                `Por marcas, ${lo.brand} es la más barata de media para ${FUEL[main].name} en ${muni} (${price(lo.avg)} en sus ${lo.count} gasolineras) y ${hi.brand} la más cara (${price(hi.avg)} en ${hi.count}).`,
            ]);
    }

    // --- 8. Alternativas más baratas a menos de NEARBY_KM, fuera del municipio ---
    const best: Partial<Record<MainFuel, Alternative & { saving: number }>> = {};
    for (const f of FUELS) {
        const localMin = priced(stations, f)[0]?.prices[f];
        if (localMin == null) continue;
        const b = nearby
            .filter((a) => a.station.prices[f] != null && a.station.prices[f]! <= localMin - 0.005)
            .sort((a, b) => a.station.prices[f]! - b.station.prices[f]! || a.km - b.km)[0];
        if (b) best[f] = { ...b, saving: localMin - b.station.prices[f]! };
    }
    const where = (a: Alternative) => `en ${displayCity(a.station.city)}, a ${km(a.km)}`;
    const alts: Paragraph[] = [];
    if (best.sp95 && best.diesel && best.sp95.station.id === best.diesel.station.id) {
        const a = best.sp95;
        alts.push([
            `A menos de ${NEARBY_KM} km hay una gasolinera más barata para los dos combustibles: `,
            link(a.station),
            ` (${where(a)}), con la gasolina 95 a ${price(a.station.prices.sp95!)} y el diésel a ${price(a.station.prices.diesel!)}: ${cents(a.saving)} y ${cents(best.diesel.saving)} menos que lo más barato de ${muni}.`,
        ]);
    } else {
        for (const f of FUELS) {
            const a = best[f];
            if (!a) continue;
            alts.push([
                `${cap(FUEL[f].name)} más ${cheapAdj(f)} a menos de ${NEARBY_KM} km: `,
                link(a.station),
                ` (${where(a)}), a ${price(a.station.prices[f]!)}, ${cents(a.saving)} menos que la más barata de ${muni}.`,
            ]);
        }
    }
    if (alts.length) {
        paragraphs.push(...alts);
        faq.push({ q: `¿Hay gasolineras más baratas cerca de ${muni}?`, a: alts.map(plain).join(" ") });
    } else if (n <= 3) {
        const text = nearby.length
            ? `Ninguna gasolinera a menos de ${NEARBY_KM} km de ${muni} mejora sus precios: aquí está lo más barato de la zona.`
            : `No hay otras gasolineras a menos de ${NEARBY_KM} km de ${muni}.`;
        paragraphs.push([text]);
        faq.push({ q: `¿Hay gasolineras más baratas cerca de ${muni}?`, a: text });
    }

    return { paragraphs, faq };
}

/**
 * Municipio cuyas gasolineras no han publicado precios hoy (la página se mantiene
 * unos días, ver missingStations.ts): cuándo lo hicieron por última vez y dónde
 * repostar más barato cerca mientras tanto.
 */
function noPricesToday(input: InsightInput): Insights {
    const { muni, nearby } = input;
    const missing = [...(input.missing ?? [])].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const day = input.dayLabel ?? ((d: string) => d);
    const paragraphs: Paragraph[] = [];
    const faq: Insights["faq"] = [];

    if (missing.length === 1) {
        paragraphs.push([`Hoy ninguna gasolinera de ${muni} ha publicado precios en el Ministerio: `, link(missing[0]), ` lo hizo por última vez el ${day(missing[0].lastSeen)}.`]);
    } else if (missing.length > 1) {
        paragraphs.push([`Hoy ninguna de las ${missing.length} gasolineras de ${muni} ha publicado precios en el Ministerio; la última actualización fue el ${day(missing[0].lastSeen)}.`]);
    }

    const cheapestNear = (f: MainFuel) =>
        nearby.filter((a) => a.station.prices[f] != null).sort((a, b) => a.station.prices[f]! - b.station.prices[f]! || a.km - b.km)[0];
    const sp95 = cheapestNear("sp95");
    const diesel = cheapestNear("diesel");
    const where = (a: Alternative) => `en ${displayCity(a.station.city)}, a ${km(a.km)}`;
    if (sp95 && diesel && sp95.station.id === diesel.station.id) {
        paragraphs.push([
            `Mientras tanto, la gasolinera más barata a menos de ${NEARBY_KM} km es `,
            link(sp95.station),
            ` (${where(sp95)}), con la gasolina 95 a ${price(sp95.station.prices.sp95!)} y el diésel a ${price(sp95.station.prices.diesel!)}.`,
        ]);
    } else {
        for (const [f, a] of [["sp95", sp95], ["diesel", diesel]] as [MainFuel, Alternative | undefined][]) {
            if (!a) continue;
            paragraphs.push([`${cap(FUEL[f].the)} más ${cheapAdj(f)} a menos de ${NEARBY_KM} km está en `, link(a.station), ` (${where(a)}), a ${price(a.station.prices[f]!)}.`]);
        }
    }
    if (!sp95 && !diesel) paragraphs.push([`No hay otras gasolineras con precios de hoy a menos de ${NEARBY_KM} km de ${muni}.`]);

    faq.push({ q: `¿Hay precios de hoy en las gasolineras de ${muni}?`, a: paragraphs.map(plain).join(" ") });
    return { paragraphs, faq };
}

/** Rejilla espacial (celdas de 0,1°) para buscar gasolineras cercanas sin recorrerlas todas. */
export function nearbyFinder(all: GasStation[]) {
    const CELL = 0.1;
    const grid = new Map<string, GasStation[]>();
    for (const s of all) {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
        const k = `${Math.floor(s.lat / CELL)}|${Math.floor(s.lng / CELL)}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
    }
    /** Gasolineras a menos de NEARBY_KM de (lat, lng), salvo las que `exclude` descarte. */
    return (lat: number, lng: number, exclude: (s: GasStation) => boolean): Alternative[] => {
        const out: Alternative[] = [];
        const ci = Math.floor(lat / CELL);
        const cj = Math.floor(lng / CELL);
        // 10 km son ~0,09° de latitud y hasta ~0,13° de longitud en la Península.
        for (let i = ci - 1; i <= ci + 1; i++)
            for (let j = cj - 2; j <= cj + 2; j++)
                for (const s of grid.get(`${i}|${j}`) ?? []) {
                    if (exclude(s)) continue;
                    const d = getDistance(lat, lng, s.lat, s.lng);
                    if (d <= NEARBY_KM) out.push({ station: s, km: d });
                }
        return out;
    };
}
