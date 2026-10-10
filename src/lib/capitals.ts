/**
 * Capitales de provincia (y Ceuta y Melilla), ordenadas por población, con el nombre
 * con el que vienen en los datos del Ministerio y el nombre habitual para mostrar.
 * Las usa el bloque de capitales de la portada, que las enlaza a todas.
 */
import type { GasStation } from "../types/gasolinera";
import { municipioUrl } from "./stationUrl";
import { placeSlug } from "./placeName";

/** [provincia, municipio (como en los datos), nombre para mostrar] */
const CAPITALS: [string, string, string][] = [
    ["MADRID", "Madrid", "Madrid"],
    ["BARCELONA", "Barcelona", "Barcelona"],
    ["VALENCIA / VALÈNCIA", "Valencia", "Valencia"],
    ["SEVILLA", "Sevilla", "Sevilla"],
    ["ZARAGOZA", "Zaragoza", "Zaragoza"],
    ["MÁLAGA", "Málaga", "Málaga"],
    ["MURCIA", "Murcia", "Murcia"],
    ["BALEARS (ILLES)", "Palma de Mallorca", "Palma"],
    ["PALMAS (LAS)", "Palmas de Gran Canaria (Las)", "Las Palmas de Gran Canaria"],
    ["BIZKAIA", "Bilbao", "Bilbao"],
    ["ALICANTE", "Alicante/Alacant", "Alicante"],
    ["CÓRDOBA", "Córdoba", "Córdoba"],
    ["VALLADOLID", "Valladolid", "Valladolid"],
    ["ARABA/ÁLAVA", "Vitoria-Gasteiz", "Vitoria-Gasteiz"],
    ["CORUÑA (A)", "Coruña (A)", "A Coruña"],
    ["GRANADA", "Granada", "Granada"],
    ["ASTURIAS", "Oviedo", "Oviedo"],
    ["SANTA CRUZ DE TENERIFE", "Santa Cruz de Tenerife", "Santa Cruz de Tenerife"],
    ["NAVARRA", "Pamplona/Iruña", "Pamplona"],
    ["ALMERÍA", "Almería", "Almería"],
    ["GIPUZKOA", "Donostia-San Sebastián", "San Sebastián"],
    ["BURGOS", "Burgos", "Burgos"],
    ["ALBACETE", "Albacete", "Albacete"],
    ["CANTABRIA", "Santander", "Santander"],
    ["CASTELLÓN / CASTELLÓ", "Castellón de la Plana/Castelló de la Plana", "Castellón de la Plana"],
    ["RIOJA (LA)", "Logroño", "Logroño"],
    ["BADAJOZ", "Badajoz", "Badajoz"],
    ["SALAMANCA", "Salamanca", "Salamanca"],
    ["HUELVA", "Huelva", "Huelva"],
    ["LLEIDA", "Lleida", "Lleida"],
    ["TARRAGONA", "Tarragona", "Tarragona"],
    ["LEÓN", "León", "León"],
    ["CÁDIZ", "Cádiz", "Cádiz"],
    ["JAÉN", "Jaén", "Jaén"],
    ["OURENSE", "Ourense", "Ourense"],
    ["GIRONA", "Girona", "Girona"],
    ["LUGO", "Lugo", "Lugo"],
    ["CÁCERES", "Cáceres", "Cáceres"],
    ["MELILLA", "Melilla", "Melilla"],
    ["GUADALAJARA", "Guadalajara", "Guadalajara"],
    ["TOLEDO", "Toledo", "Toledo"],
    ["CEUTA", "Ceuta", "Ceuta"],
    ["PONTEVEDRA", "Pontevedra", "Pontevedra"],
    ["PALENCIA", "Palencia", "Palencia"],
    ["CIUDAD REAL", "Ciudad Real", "Ciudad Real"],
    ["ZAMORA", "Zamora", "Zamora"],
    ["ÁVILA", "Ávila", "Ávila"],
    ["CUENCA", "Cuenca", "Cuenca"],
    ["HUESCA", "Huesca", "Huesca"],
    ["SEGOVIA", "Segovia", "Segovia"],
    ["SORIA", "Soria", "Soria"],
    ["TERUEL", "Teruel", "Teruel"],
];

export interface CapitalInfo {
    label: string;
    url: string;
    count: number;
    /** Gasolina 95 más barata hoy (o diésel si ninguna vende gasolina 95). */
    minPrice: number | null;
}

/**
 * Las capitales con gasolineras hoy, en orden de población. Se buscan por slug (no por
 * el texto exacto) y, si alguna no aparece en los datos, se avisa en el build y se omite.
 */
export function capitalsWithPrices(stations: GasStation[]): CapitalInfo[] {
    const byMuni = new Map<string, GasStation[]>();
    for (const s of stations) {
        const k = `${placeSlug(s.province)}|${placeSlug(s.city)}`;
        (byMuni.get(k) ?? byMuni.set(k, []).get(k)!).push(s);
    }
    const out: CapitalInfo[] = [];
    for (const [province, city, label] of CAPITALS) {
        const list = byMuni.get(`${placeSlug(province)}|${placeSlug(city)}`);
        if (!list?.length) {
            console.warn(`[capitales] Sin gasolineras hoy en ${label} (${province}): no sale en la portada.`);
            continue;
        }
        const prices = list.map((s) => s.prices.sp95 ?? s.prices.diesel).filter((p): p is number => p != null);
        out.push({
            label,
            url: municipioUrl(list[0].province, list[0].city),
            count: list.length,
            minPrice: prices.length ? Math.min(...prices) : null,
        });
    }
    return out;
}
