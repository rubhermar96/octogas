/**
 * Texto propio de cada ficha de gasolinera, sacado de sus datos: posición en su
 * municipio, cómo está frente a su provincia y a España, si es la más barata en 5 km a
 * la redonda (o cuál lo es), cuántas veces ha cambiado de precio este mes y su mínimo
 * registrado, cómo está frente a su marca, qué combustibles vende (destacando los poco
 * comunes) y su horario. Cada frase solo aparece si el dato existe y dice algo.
 */
import type { FuelType, GasStation } from "../types/gasolinera";
import type { StationHistory } from "./history";
import { displayCity } from "./placeName";
import { getDistance } from "./geo";
import { FUEL_LIST_ORDER } from "./fuelSummary";
import {
    FUEL,
    FUEL_NAMES,
    MAIN_FUELS,
    cap,
    cents,
    cheapAdj,
    euros,
    is24h,
    isGeneric,
    joinEs,
    km,
    link,
    plain,
    price,
    scheduleText,
    versus,
    type Alternative,
    type Averages,
    type MainFuel,
    type Paragraph,
} from "./insightText";

export const AROUND_KM = 5;
/** Combustibles poco comunes: tenerlos es un dato útil para quien los busca. */
export const RARE_FUELS: FuelType[] = ["glp", "gnc", "gnl", "hydrogen"];
const DAY = 86_400_000;

export interface StationInsightInput {
    station: GasStation;
    /** Solo si hoy no ha publicado precios: último día (AAAA-MM-DD) en que lo hizo. */
    lastSeen: string | null;
    muni: string;
    prov: string;
    /** Gasolineras del municipio con precios de hoy (incluida esta, si los tiene). */
    muniStations: GasStation[];
    provinceAvg: Averages;
    /** Precios de hoy de toda España, ordenados de menor a mayor. */
    nationalPrices: Partial<Record<MainFuel, number[]>>;
    /** Gasolineras con precios de hoy a menos de AROUND_KM (sin contar esta). */
    around: Alternative[];
    /** Gasolineras de su misma marca en la provincia (con precios de hoy). */
    brandInProvince?: { count: number; avg: Averages };
    /** Nº de gasolineras con cada combustible poco común en su municipio y provincia. */
    fuelCounts: Partial<Record<FuelType, { muni: number; prov: number }>>;
    history?: StationHistory | null;
    now?: number;
}

export interface Insights {
    paragraphs: Paragraph[];
    faq: { q: string; a: string }[];
}

const dateEs = (t: number) => new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: "Europe/Madrid" });

/** "la más barata", "la 3.ª más barata", "la más cara"... dentro de su municipio. */
function rankPhrase(mine: number, prices: number[]): string {
    const cheaper = prices.filter((p) => p < mine - 0.0005).length;
    const ties = prices.filter((p) => Math.abs(p - mine) <= 0.0005).length - 1;
    const n = prices.length;
    if (cheaper === 0) return ties > 0 ? `la más barata (empatada con ${ties === 1 ? "otra" : `otras ${ties}`})` : "la más barata";
    if (cheaper + ties === n - 1 && ties === 0) return "la más cara";
    return `la ${cheaper + 1}.ª más barata`;
}

/** Franja de precio en España según el percentil. */
function nationalBand(mine: number, sorted: number[] | undefined): string | undefined {
    if (!sorted?.length) return undefined;
    const pct = sorted.filter((p) => p < mine - 0.0005).length / sorted.length;
    if (pct <= 0.1) return "entre el 10 % más barato de España";
    if (pct <= 0.25) return "entre el 25 % más barato de España";
    if (pct >= 0.9) return "entre el 10 % más caro de España";
    if (pct >= 0.75) return "entre el 25 % más caro de España";
    return "en la franja media de precios de España";
}

export function stationInsights(input: StationInsightInput): Insights {
    const { station, lastSeen, muni, prov, muniStations, provinceAvg, nationalPrices, around, brandInProvince, fuelCounts, history } = input;
    const now = input.now ?? Date.now();
    const active = !lastSeen;
    const paragraphs: Paragraph[] = [];
    const faq: Insights["faq"] = [];
    const mine = (f: MainFuel) => station.prices[f] ?? undefined;
    // Combustible principal de la ficha: gasolina 95 si la vende, si no diésel.
    const main: MainFuel = mine("sp95") != null ? "sp95" : "diesel";

    // --- 1. Posición en su municipio ---
    if (active) {
        if (muniStations.length === 1) {
            paragraphs.push([`Es la única gasolinera de ${muni}.`]);
        } else {
            const ranks = MAIN_FUELS.flatMap((f) => {
                const p = mine(f);
                const prices = muniStations.map((s) => s.prices[f]).filter((x): x is number => x != null);
                if (p == null || prices.length < 2) return [];
                return [{ f, phrase: rankPhrase(p, prices), n: prices.length }];
            });
            if (ranks.length) {
                const both = ranks.length === 2 && ranks[0].phrase === ranks[1].phrase && ranks[0].n === ranks[1].n;
                const text = both
                    ? `Entre las ${ranks[0].n} gasolineras de ${muni}, es ${ranks[0].phrase} tanto para gasolina 95 como para diésel.`
                    : `Entre las gasolineras de ${muni}, es ${ranks.map((r) => `${r.phrase} para ${FUEL[r.f].name} (de ${r.n})`).join(" y ")}.`;
                paragraphs.push([text]);
                faq.push({ q: `¿Es barata esta gasolinera?`, a: text });
            }
        }
    }

    // --- 2. Frente a su provincia y a España ---
    if (active) {
        const sentences: string[] = [];
        MAIN_FUELS.forEach((f) => {
            const p = mine(f);
            if (p == null) return;
            const bits: string[] = [];
            if (provinceAvg[f] != null) bits.push(`${versus(p, provinceAvg[f]!, f)} la media ${sentences.length ? "provincial" : `de la provincia de ${prov}`} (${price(provinceAvg[f]!)})`);
            const band = nationalBand(p, nationalPrices[f]);
            if (!bits.length && !band) return;
            const subject = sentences.length ? cap(FUEL[f].the) : `Su ${FUEL[f].name}`;
            sentences.push(
                `${subject}, a ${price(p)}, está ${bits.length ? bits[0] : ""}${bits.length && band ? " y " : ""}${band ?? ""}.`
            );
        });
        if (sentences.length) {
            paragraphs.push([sentences.join(" ")]);
            if (faq.length) faq[faq.length - 1].a += " " + sentences.join(" ");
        }
    }

    // --- 3. La más barata a menos de AROUND_KM (con precios de hoy), para gasolina 95 y
    //        diésel ---
    const where = (a: Alternative) =>
        a.station.city === station.city ? `a ${km(a.km)}` : `en ${displayCity(a.station.city)}, a ${km(a.km)}`;
    const nearFuels = MAIN_FUELS.filter((f) => !active || mine(f) != null).map((f) => {
        const candidates = around.filter((a) => a.station.prices[f] != null);
        const cheapest = [...candidates].sort((a, b) => a.station.prices[f]! - b.station.prices[f]! || a.km - b.km)[0];
        const p = mine(f);
        const status = !candidates.length ? "none" : !active ? "today" : p! <= cheapest.station.prices[f]! + 0.0005 ? "best" : "beaten";
        return { f, candidates, cheapest, status };
    });
    let nearText: Paragraph | undefined;
    const [n1, n2] = nearFuels;
    if (nearFuels.length && nearFuels.every((x) => x.status === "none")) {
        nearText = [`No hay otras gasolineras con ${joinEs(nearFuels.map((x) => FUEL[x.f].name))} a menos de ${AROUND_KM} km.`];
    } else if (n2 && n1.status === "best" && n2.status === "best") {
        const c = Math.max(n1.candidates.length, n2.candidates.length);
        nearText = [
            `Es la más barata para gasolina 95 y diésel en ${AROUND_KM} km a la redonda: ${
                c === 1 ? "la otra gasolinera cercana no mejora" : `ninguna de las ${c} gasolineras cercanas mejora`
            } sus precios.`,
        ];
    } else if (n2 && n1.status === n2.status && (n1.status === "beaten" || n1.status === "today") && n1.cheapest.station.id === n2.cheapest.station.id) {
        const s = n1.cheapest.station;
        nearText = [
            n1.status === "today" ? `Con precios de hoy, la más barata a menos de ${AROUND_KM} km para gasolina 95 y diésel es ` : `La más barata a menos de ${AROUND_KM} km para gasolina 95 y diésel es `,
            link(s),
            ` (${where(n1.cheapest)}), con la gasolina 95 a ${price(s.prices.sp95!)} y el diésel a ${price(s.prices.diesel!)}`,
            n1.status === "beaten" ? `: ${cents(mine("sp95")! - s.prices.sp95!)} y ${cents(mine("diesel")! - s.prices.diesel!)} menos por litro que aquí.` : ".",
        ];
    } else {
        nearText = [];
        for (const { f, candidates, cheapest, status } of nearFuels) {
            if (nearText.length) nearText.push(" ");
            if (status === "none") nearText.push(`No hay otras gasolineras con ${FUEL[f].name} a menos de ${AROUND_KM} km.`);
            else if (status === "today")
                nearText.push(
                    `Con precios de hoy, ${FUEL[f].the} más ${cheapAdj(f)} a menos de ${AROUND_KM} km está en `,
                    link(cheapest.station),
                    ` (${where(cheapest)}), a ${price(cheapest.station.prices[f]!)}.`
                );
            else if (status === "best")
                nearText.push(
                    `Es la más barata para ${FUEL[f].name} en ${AROUND_KM} km a la redonda: ${
                        candidates.length === 1 ? "la otra gasolinera cercana no mejora" : `ninguna de las ${candidates.length} gasolineras cercanas mejora`
                    } su precio.`
                );
            else {
                const p = mine(f)!;
                const diff = p - cheapest.station.prices[f]!;
                nearText.push(
                    `La más barata para ${FUEL[f].name} a menos de ${AROUND_KM} km es `,
                    link(cheapest.station),
                    ` (${where(cheapest)}), a ${price(cheapest.station.prices[f]!)}: ${cents(diff)} menos por litro, ${euros(diff * 50)} en un depósito de 50 litros.`
                );
                const closest = candidates.filter((a) => a.station.prices[f]! < p - 0.0005).sort((a, b) => a.km - b.km)[0];
                if (closest && closest.station.id !== cheapest.station.id && closest.km < cheapest.km - 0.3)
                    nearText.push(` La más cercana que la mejora está ${where(closest)}: `, link(closest.station), `, a ${price(closest.station.prices[f]!)}.`);
            }
        }
    }
    if (nearText?.length) {
        paragraphs.push(nearText);
        faq.push({ q: `¿Hay gasolineras más baratas cerca de esta?`, a: plain(nearText) });
    }

    // --- 4. Su propio histórico: cambios de precio este mes y mínimo registrado, para
    //        gasolina 95 y diésel ---
    if (active) {
        const monthAgo = now - 30 * DAY;
        const changeSentences: string[] = [];
        const lows: { f: MainFuel; price: number; t: number }[] = [];
        for (const f of MAIN_FUELS) {
            const pts = history?.[f];
            const to = mine(f);
            if (!pts?.length || to == null) continue;
            const sorted = [...pts].sort((a, b) => a.t - b.t);
            const before = sorted.filter((x) => x.t <= monthAgo);
            if (before.length) {
                const from = before[before.length - 1].price;
                const changes = sorted.filter((x) => x.t > monthAgo).length;
                const times = changes === 1 ? "una vez" : `${changes} veces`;
                const same = Math.abs(to - from) < 0.0005;
                // La segunda frase, más corta: "El del diésel, 3 veces: de ... a ...".
                if (!changeSentences.length) {
                    if (changes === 0) changeSentences.push(`Lleva más de un mes sin cambiar el precio ${FUEL[f].of}.`);
                    else
                        changeSentences.push(
                            `En los últimos 30 días ha cambiado ${times} el precio ${FUEL[f].of}${same ? ` y está igual que hace un mes (${price(to)})` : `: ha pasado de ${price(from)} a ${price(to)}`}.`
                        );
                } else if (changes === 0) changeSentences.push(`El ${FUEL[f].of} no ha cambiado en todo el mes.`);
                else changeSentences.push(`El ${FUEL[f].of}, ${times}${same ? `, y está igual que hace un mes (${price(to)})` : `: de ${price(from)} a ${price(to)}`}.`);
            }
            // Precio vigente en cada momento de los últimos 30 días (el de hace un mes y los
            // cambios posteriores): el más bajo, si es menor que el de hoy.
            const window = [...(before.length ? [{ ...before[before.length - 1], t: monthAgo }] : []), ...sorted.filter((x) => x.t > monthAgo)];
            if (window.length) {
                const low = window.reduce((a, b) => (b.price < a.price ? b : a));
                if (low.price < to - 0.0005) lows.push({ f, price: low.price, t: low.t });
            }
        }
        const sentences = [...changeSentences];
        if (lows.length === 1) {
            const low = lows[0];
            // Si vende los dos, hay que decir de cuál se habla.
            const both = MAIN_FUELS.every((f) => mine(f) != null && history?.[f]?.length);
            sentences.push(
                low.t === monthAgo
                    ? `Hace un mes estaba más barata${both ? ` en ${FUEL[low.f].name}` : ""}: ${price(low.price)}.`
                    : both
                      ? `El precio más bajo ${FUEL[low.f].of} en los últimos 30 días fue ${price(low.price)}, el ${dateEs(low.t)}.`
                      : `Su precio más bajo de los últimos 30 días fue ${price(low.price)}, el ${dateEs(low.t)}.`
            );
        } else if (lows.length === 2) {
            const when = (t: number) => (t === monthAgo ? "hace un mes" : `el ${dateEs(t)}`);
            sentences.push(`Sus precios más bajos del último mes: ${joinEs(lows.map((l) => `${price(l.price)} en ${FUEL[l.f].name} (${when(l.t)})`))}.`);
        }
        if (sentences.length) paragraphs.push([sentences.join(" ")]);
    }

    // --- 5. Frente a su marca ---
    if (active && !isGeneric(station)) {
        const sentences: string[] = [];
        const p = mine(main);
        const b = brandInProvince;
        // Gasolina 95 y diésel frente a la media de su marca en la provincia.
        const vsBrand = b && b.count >= 3 ? MAIN_FUELS.filter((f) => mine(f) != null && b.avg[f] != null) : [];
        if (b && vsBrand.length)
            sentences.push(
                `Es una de las ${b.count} gasolineras ${station.brand} de la provincia de ${prov}, y su ${FUEL[vsBrand[0]].name} está ${versus(mine(vsBrand[0])!, b.avg[vsBrand[0]]!, vsBrand[0])} la media de la marca allí (${price(b.avg[vsBrand[0]]!)})${
                    vsBrand[1] ? `; su ${FUEL[vsBrand[1]].name}, ${versus(mine(vsBrand[1])!, b.avg[vsBrand[1]]!, vsBrand[1])} la media (${price(b.avg[vsBrand[1]]!)})` : ""
                }.`
            );
        const sameBrand = muniStations.filter((s) => s.brand === station.brand && s.prices[main] != null);
        if (p != null && sameBrand.length >= 2) {
            const better = sameBrand.filter((s) => s.prices[main]! < p - 0.0005).length;
            sentences.push(
                better === 0
                    ? `En ${muni} es la más barata de las ${sameBrand.length} ${station.brand}.`
                    : `En ${muni} hay ${sameBrand.length} ${station.brand}, y ${better === 1 ? "una es más barata" : `${better} son más baratas`} que esta.`
            );
        }
        if (sentences.length) paragraphs.push([sentences.join(" ")]);
    }

    // --- 6. Qué vende y cuándo abre ---
    const fuels = FUEL_LIST_ORDER.filter((f) => station.prices[f] != null);
    const sentences: string[] = [];
    if (fuels.length) {
        const names = fuels.map((f) => FUEL_NAMES[f]);
        const list = names.length < 2 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
        sentences.push(`${active ? "Vende" : "Según los últimos datos que publicó, vende"} ${list}.`);
        for (const f of fuels.filter((x) => RARE_FUELS.includes(x))) {
            const c = fuelCounts[f];
            if (!c) continue;
            if (active && c.muni === 1) sentences.push(`Es la única gasolinera de ${muni} con ${FUEL_NAMES[f]}.`);
            else if (c.prov > 0 && c.prov <= 15)
                sentences.push(
                    c.prov === 1
                        ? `Es la única gasolinera de la provincia de ${prov} con ${FUEL_NAMES[f]}.`
                        : `Es una de las ${c.prov} gasolineras de la provincia de ${prov} con ${FUEL_NAMES[f]}.`
                );
        }
    }
    const sched = scheduleText(station.schedule);
    if (sched) {
        let s = cap(sched);
        if (active && is24h(station) && muniStations.length >= 2) {
            const open = muniStations.filter(is24h).length;
            s += open === 1 ? `: es la única de ${muni} que lo hace` : ` (una de las ${open} de ${muni} que lo hacen)`;
        }
        sentences.push(`${s}.`);
    }
    if (sentences.length) {
        paragraphs.push([sentences.join(" ")]);
        if (fuels.length) faq.push({ q: `¿Qué combustibles vende esta gasolinera?`, a: sentences[0] });
    }

    return { paragraphs, faq };
}

/**
 * Prepara una vez, para todo el build, lo que cada ficha necesita comparar: gasolineras
 * de su municipio, medias de su provincia y de su marca, precios de toda España,
 * gasolineras a menos de AROUND_KM y nº de gasolineras con cada combustible poco común.
 * Todo con las gasolineras que tienen precios hoy (`today`).
 */
export function stationInsightContext(today: GasStation[]) {
    const muniKey = (s: GasStation) => `${s.province}|${s.city}`;
    const byMuni = new Map<string, GasStation[]>();
    const byProv = new Map<string, GasStation[]>();
    for (const s of today) {
        (byMuni.get(muniKey(s)) ?? byMuni.set(muniKey(s), []).get(muniKey(s))!).push(s);
        (byProv.get(s.province) ?? byProv.set(s.province, []).get(s.province)!).push(s);
    }
    const avgOf = (list: GasStation[]): Averages => {
        const out: Averages = {};
        for (const f of MAIN_FUELS) {
            const v = list.map((s) => s.prices[f]).filter((p): p is number => p != null);
            if (v.length) out[f] = v.reduce((a, b) => a + b, 0) / v.length;
        }
        return out;
    };
    const provAvg = new Map([...byProv].map(([p, l]) => [p, avgOf(l)]));
    const brandStats = new Map<string, { count: number; avg: Averages }>();
    for (const [p, list] of byProv) {
        const byBrand = new Map<string, GasStation[]>();
        for (const s of list) if (!isGeneric(s)) (byBrand.get(s.brand) ?? byBrand.set(s.brand, []).get(s.brand)!).push(s);
        for (const [b, l] of byBrand) brandStats.set(`${p}|${b}`, { count: l.length, avg: avgOf(l) });
    }
    const nationalPrices: Partial<Record<MainFuel, number[]>> = {};
    for (const f of MAIN_FUELS)
        nationalPrices[f] = today.map((s) => s.prices[f]).filter((p): p is number => p != null).sort((a, b) => a - b);
    const rareCount = (list: GasStation[] | undefined, f: FuelType) => (list ?? []).filter((s) => s.prices[f] != null).length;

    // Rejilla de ~0,05° (unos 5 km) para buscar las cercanas sin recorrerlas todas.
    const CELL = 0.05;
    const grid = new Map<string, GasStation[]>();
    for (const s of today) {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
        const k = `${Math.floor(s.lat / CELL)}|${Math.floor(s.lng / CELL)}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
    }
    const aroundOf = (s: GasStation): Alternative[] => {
        const out: Alternative[] = [];
        const ci = Math.floor(s.lat / CELL);
        const cj = Math.floor(s.lng / CELL);
        for (let i = ci - 1; i <= ci + 1; i++)
            for (let j = cj - 2; j <= cj + 2; j++)
                for (const o of grid.get(`${i}|${j}`) ?? []) {
                    if (o.id === s.id) continue;
                    const d = getDistance(s.lat, s.lng, o.lat, o.lng);
                    if (d <= AROUND_KM) out.push({ station: o, km: d });
                }
        return out;
    };

    return (station: GasStation, extra: { lastSeen: string | null; muni: string; prov: string; history?: StationHistory | null }): StationInsightInput => {
        const muniList = byMuni.get(muniKey(station));
        const provList = byProv.get(station.province);
        const fuelCounts: StationInsightInput["fuelCounts"] = {};
        for (const f of RARE_FUELS) if (station.prices[f] != null) fuelCounts[f] = { muni: rareCount(muniList, f), prov: rareCount(provList, f) };
        return {
            station,
            ...extra,
            muniStations: muniList ?? [],
            provinceAvg: provAvg.get(station.province) ?? {},
            nationalPrices,
            around: aroundOf(station),
            brandInProvince: brandStats.get(`${station.province}|${station.brand}`),
            fuelCounts,
        };
    };
}

