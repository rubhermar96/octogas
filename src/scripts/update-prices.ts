import fs from "node:fs";
import path from "node:path";
import { normalizeBrand } from "../lib/brands";
import { placeSlug } from "../lib/placeName";
import type { GasStation } from "../types/gasolinera";

const API_URL =
    "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";

const OUTPUT_DIR = path.resolve("public/data");

/** Convierte "1,649" -> 1.649, y vacío/0 -> null. */
function parsePrice(raw: string | undefined): number | null {
    if (!raw) return null;
    const value = parseFloat(raw.replace(",", "."));
    return Number.isFinite(value) && value > 0 ? value : null;
}

// Cajas que cubren España: península, Baleares, Ceuta y Melilla; y Canarias.
const SPAIN_BOXES = [
    { minLat: 35.1, maxLat: 43.9, minLng: -9.5, maxLng: 4.5 },
    { minLat: 27.5, maxLat: 29.5, minLng: -18.3, maxLng: -13.3 },
];
const inSpain = (lat: number, lng: number) =>
    SPAIN_BOXES.some((b) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng);

/**
 * Valida la posición que publica MITECO. Algunas estaciones llegan en (0, 0) —en el
 * Atlántico, frente a África— o con latitud y longitud intercambiadas. Las segundas se
 * corrigen; el resto se marca como no geolocalizada (NaN) y se excluye del catálogo.
 */
function fixCoords(stations: GasStation[]): void {
    const fixed: string[] = [];
    const dropped: string[] = [];
    for (const s of stations) {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || inSpain(s.lat, s.lng)) continue;
        if (inSpain(s.lng, s.lat)) {
            [s.lat, s.lng] = [s.lng, s.lat];
            fixed.push(`${s.name} (${s.city})`);
        } else {
            dropped.push(`${s.name} (${s.city}) ${s.lat},${s.lng}`);
            s.lat = NaN;
            s.lng = NaN;
        }
    }
    if (fixed.length) console.log(`OCTO Data: ${fixed.length} con latitud/longitud intercambiadas, corregidas → ${fixed.join(" · ")}`);
    if (dropped.length) console.log(`OCTO Data: ${dropped.length} con coordenadas fuera de España, excluidas → ${dropped.join(" · ")}`);
}

/** Convierte "39,211417" -> 39.211417. */
function parseCoord(raw: string | undefined): number {
    if (!raw) return NaN;
    return parseFloat(raw.replace(",", "."));
}

/** Elimina las claves sin precio (null) para no serializarlas en el JSON. */
function compactPrices(prices: Record<string, number | null>): GasStation["prices"] {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(prices)) {
        if (v != null) out[k] = v;
    }
    return out as GasStation["prices"];
}

/**
 * Descarta precios implausibles (estaciones que reportan valores de relleno a
 * MITECO, p. ej. "1,000" clavado en todos los carburantes). Umbrales relativos a
 * la MEDIANA nacional de cada carburante, calibrados con datos reales (jul 2026):
 *  - Carretera (sp95/98/diésel…): los falsos quedan a ≤0,62× la mediana y el
 *    suelo legítimo del mercado (Canarias, low-cost) a ≥0,71× → corte en 0,67.
 *  - Gasóleo B / GLP / GNC…: colas bajas anchas y LEGÍTIMAS (cooperativas,
 *    granel; hay gasóleo B real a 0,82) → corte laxo en 0,50.
 *  - Tope superior 1,8× para basura por arriba. Sin mediana fiable (menos de 50
 *    precios, p. ej. hidrógeno) no se filtra.
 * Muta `prices` de cada estación; una estación puede quedarse sin precios (y se
 * excluye después, junto a las no geolocalizadas).
 */
const ROAD_FUELS = new Set(["sp95", "sp95Premium", "sp98", "diesel", "dieselPremium"]);
function sanitizePrices(stations: GasStation[]): void {
    const byFuel = new Map<string, number[]>();
    for (const s of stations) {
        for (const [f, p] of Object.entries(s.prices)) {
            if (p == null) continue;
            if (!byFuel.has(f)) byFuel.set(f, []);
            byFuel.get(f)!.push(p);
        }
    }
    const bounds = new Map<string, { lo: number; hi: number }>();
    for (const [f, prices] of byFuel) {
        if (prices.length < 50) continue;
        prices.sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        const loRatio = ROAD_FUELS.has(f) ? 0.67 : 0.5;
        bounds.set(f, { lo: median * loRatio, hi: median * 1.8 });
    }
    let dropped = 0;
    const examples: string[] = [];
    for (const s of stations) {
        for (const [f, p] of Object.entries(s.prices)) {
            if (p == null) continue;
            const b = bounds.get(f);
            if (b && (p < b.lo || p > b.hi)) {
                delete (s.prices as Record<string, number>)[f];
                dropped++;
                if (examples.length < 8) examples.push(`${s.name} (${s.city}) ${f}=${p}`);
            }
        }
    }
    if (dropped > 0) {
        console.log(
            `OCTO Data: descartados ${dropped} precios implausibles → ${examples.join(" · ")}`
        );
    }
}

async function updateGasData() {
    console.log("OCTO Data: descargando datos del Ministerio…");
    const response = await fetch(API_URL);
    if (!response.ok) {
        throw new Error(`API respondió ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const list: any[] = data.ListaEESSPrecio ?? [];

    const parsed: GasStation[] = list
        .map((item): GasStation => ({
            id: item.IDEESS,
            name: (item["Rótulo"] ?? "").trim(),
            brand: normalizeBrand(item["Rótulo"]),
            address: (item["Dirección"] ?? "").trim(),
            city: (item.Municipio ?? "").trim(),
            province: (item.Provincia ?? "").trim(),
            postalCode: item["C.P."] ?? "",
            idMunicipio: item.IDMunicipio ?? "",
            idProvincia: item.IDProvincia ?? "",
            lat: parseCoord(item.Latitud),
            lng: parseCoord(item["Longitud (WGS84)"]),
            saleType: item["Tipo Venta"] ?? "",
            schedule: (item.Horario ?? "").trim(),
            margin: item.Margen === "D" || item.Margen === "I" ? item.Margen : undefined,
            // Solo las claves con precio (omitimos los null: ahorra ~28% del JSON).
            prices: compactPrices({
                sp95: parsePrice(item["Precio Gasolina 95 E5"]),
                sp95Premium: parsePrice(item["Precio Gasolina 95 E5 Premium"]),
                sp98: parsePrice(item["Precio Gasolina 98 E5"]),
                diesel: parsePrice(item["Precio Gasoleo A"]),
                dieselPremium: parsePrice(item["Precio Gasoleo Premium"]),
                dieselB: parsePrice(item["Precio Gasoleo B"]),
                glp: parsePrice(item["Precio Gases licuados del petróleo"]),
                gnc: parsePrice(item["Precio Gas Natural Comprimido"]),
                gnl: parsePrice(item["Precio Gas Natural Licuado"]),
                hydrogen: parsePrice(item["Precio Hidrogeno"]),
            }),
        }));

    // Fuera precios de relleno/implausibles ANTES de filtrar: una estación cuyos
    // precios sean todos falsos se queda sin ninguno y se excluye del catálogo.
    fixCoords(parsed);
    sanitizePrices(parsed);

    // Solo estaciones geolocalizadas y con al menos un precio.
    const stations: GasStation[] = parsed.filter(
        (g) =>
            Number.isFinite(g.lat) &&
            Number.isFinite(g.lng) &&
            Object.values(g.prices).some((p) => p !== null)
    );

    // El margen solo se conserva donde hace falta para distinguir dos gasolineras con
    // la misma marca y dirección (parejas de autovía); en el resto solo engordaría el JSON.
    const sameKey = (g: GasStation) => `${g.brand}|${g.address}|${g.city}`.toLowerCase();
    const keyCount = new Map<string, number>();
    for (const g of stations) keyCount.set(sameKey(g), (keyCount.get(sameKey(g)) ?? 0) + 1);
    for (const g of stations) if ((keyCount.get(sameKey(g)) ?? 0) < 2) delete g.margin;

    // Índice ligero de municipios para el autocompletado (evita cargar 3 MB en el cliente).
    const muniMap = new Map<
        string,
        { city: string; province: string; provinceSlug: string; citySlug: string; count: number }
    >();
    for (const s of stations) {
        if (!s.city || !s.province) continue;
        const key = `${s.province}|${s.city}`;
        const existing = muniMap.get(key);
        if (existing) {
            existing.count++;
        } else {
            muniMap.set(key, {
                city: s.city,
                province: s.province,
                provinceSlug: placeSlug(s.province),
                citySlug: placeSlug(s.city),
                count: 1,
            });
        }
    }
    const municipios = [...muniMap.values()].sort((a, b) => a.city.localeCompare(b.city));

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "stations.json"), JSON.stringify(stations));
    fs.writeFileSync(path.join(OUTPUT_DIR, "municipios.json"), JSON.stringify(municipios));

    console.log(
        `OCTO Data: ${stations.length} estaciones y ${municipios.length} municipios actualizados.`
    );
}

updateGasData().catch((error) => {
    console.error("Error al actualizar datos:", error);
    process.exit(1);
});
