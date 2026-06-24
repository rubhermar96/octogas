import fs from "node:fs";
import path from "node:path";
import { normalizeBrand } from "../lib/brands";
import { slugify } from "../lib/slug";
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

/** Convierte "39,211417" -> 39.211417. */
function parseCoord(raw: string | undefined): number {
    if (!raw) return NaN;
    return parseFloat(raw.replace(",", "."));
}

async function updateGasData() {
    console.log("OCTO Data: descargando datos del Ministerio…");
    const response = await fetch(API_URL);
    if (!response.ok) {
        throw new Error(`API respondió ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const list: any[] = data.ListaEESSPrecio ?? [];

    const stations: GasStation[] = list
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
            prices: {
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
            },
        }))
        // Solo estaciones geolocalizadas y con al menos un precio.
        .filter(
            (g) =>
                Number.isFinite(g.lat) &&
                Number.isFinite(g.lng) &&
                Object.values(g.prices).some((p) => p !== null)
        );

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
                provinceSlug: slugify(s.province),
                citySlug: slugify(s.city),
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
