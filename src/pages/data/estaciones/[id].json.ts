import fs from "node:fs";
import path from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";
import type { GasStation } from "../../../types/gasolinera";
import type { FavoriteStation } from "../../../lib/favorites";
import { loadMissingStations, type MissingStation } from "../../../lib/missingStations";
import { displayAddress } from "../../../lib/format";
import { displayCity, displayProvince } from "../../../lib/placeName";
import { isGeneric } from "../../../lib/insightText";
import { stationUrl } from "../../../lib/stationUrl";

/**
 * Datos de hoy de cada gasolinera, uno por fichero (/data/estaciones/{id}.json), para
 * "Mis gasolineras": la página solo descarga las que el usuario tiene guardadas en vez
 * de las 11.500. Incluye las que hoy no han publicado precios (con su último día).
 */
export const getStaticPaths: GetStaticPaths = () => {
    const today = JSON.parse(fs.readFileSync(path.resolve("public/data/stations.json"), "utf-8")) as GasStation[];
    return [...today, ...loadMissingStations(today)].map((station) => ({ params: { id: station.id }, props: { station } }));
};

export const GET: APIRoute = ({ props }) => {
    const s = props.station as GasStation | MissingStation;
    const lastSeen = (s as MissingStation).lastSeen;
    const prices: FavoriteStation["prices"] = {};
    for (const [fuel, price] of Object.entries(s.prices)) if (price != null) prices[fuel as keyof typeof prices] = price;
    const data: FavoriteStation = {
        id: s.id,
        name: isGeneric(s) ? displayAddress(s.address) : s.brand,
        brand: isGeneric(s) ? "" : s.brand,
        address: displayAddress(s.address),
        city: displayCity(s.city),
        province: displayProvince(s.province),
        url: stationUrl(s),
        schedule: s.schedule ?? "",
        prices,
        lat: s.lat,
        lng: s.lng,
        ...(lastSeen ? { lastSeen } : {}),
    };
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
