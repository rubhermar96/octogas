import { getDistance } from './geo';
import type { GasStation, FuelType } from '../types/gasolinera';

export interface GeoPoint {
    lat: number;
    lng: number;
}

export interface GeoResult extends GeoPoint {
    label: string;
}

export interface RouteResult {
    coords: [number, number][]; // [lat, lng]
    distanceKm: number;
    durationMin: number;
    hasToll?: boolean; // si la ruta usa peajes (solo disponible con Valhalla)
}

export interface RouteOptions {
    avoidTolls?: boolean;
}

/** Decodifica la geometría de Valhalla (polyline con precisión 6). */
function decodePolyline6(str: string): [number, number][] {
    let index = 0,
        lat = 0,
        lng = 0;
    const coords: [number, number][] = [];
    const factor = 1e6;
    while (index < str.length) {
        let shift = 0,
            result = 0,
            byte: number;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += result & 1 ? ~(result >> 1) : result >> 1;
        shift = 0;
        result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lng += result & 1 ? ~(result >> 1) : result >> 1;
        coords.push([lat / factor, lng / factor]);
    }
    return coords;
}

/** Construye una etiqueta legible a partir de las propiedades de Photon. */
function photonLabel(p: any): string {
    const main =
        p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || p.county || '';
    const parts: string[] = [main];
    if (p.city && p.city !== main) parts.push(p.city);
    else if (p.county && p.county !== main) parts.push(p.county);
    if (p.state) parts.push(p.state);
    return parts.filter(Boolean).join(', ');
}

/**
 * Busca lugares (direcciones, municipios y POIs: restaurantes, hoteles…) con
 * Photon (OpenStreetMap, sin clave), pensado para autocompletado. Prioriza España.
 */
export async function searchPlaces(query: string, limit = 6): Promise<GeoResult[]> {
    if (query.trim().length < 3) return [];
    // Sin sesgo de proximidad: con él, "Santander" devolvía cajeros en Madrid en
    // vez de la ciudad. Filtramos a España y dejamos el ranking por relevancia.
    const url = `https://photon.komoot.io/api/?limit=${limit}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const feats = (data.features || []).filter(
        (f: any) => f.geometry?.coordinates?.length === 2 && f.properties
    );
    // Preferimos resultados en España; si no hay, mostramos todos.
    const es = feats.filter((f: any) => f.properties.countrycode === 'ES');
    const use = es.length ? es : feats;
    return use.map((f: any) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        label: photonLabel(f.properties),
    }));
}

/** Geocodifica un texto (devuelve la mejor coincidencia). */
export async function geocode(query: string): Promise<GeoResult | null> {
    const r = await searchPlaces(query, 1);
    return r[0] ?? null;
}

/** Calcula la ruta en coche entre dos puntos. */
export async function getRoute(a: GeoPoint, b: GeoPoint, opts: RouteOptions = {}): Promise<RouteResult | null> {
    return getRouteMulti([a, b], opts);
}

/**
 * Calcula la ruta pasando por varios puntos en orden. Usa Valhalla (gratis, sin
 * clave) para soportar "evitar peajes" y detectar si la ruta los usa; si falla,
 * cae a OSRM (sin info de peajes).
 */
// Si Valhalla falla/tarda una vez, dejamos de intentarlo en esta sesión (evita
// esperas largas en cada cálculo). Se reintenta al recargar la página.
let valhallaUp = true;

export async function getRouteMulti(points: GeoPoint[], opts: RouteOptions = {}): Promise<RouteResult | null> {
    if (points.length < 2) return null;
    if (valhallaUp) {
        try {
            const body = {
                locations: points.map((p) => ({ lat: p.lat, lon: p.lng })),
                costing: 'auto',
                costing_options: { auto: { use_tolls: opts.avoidTolls ? 0 : 1 } },
                units: 'kilometers',
            };
            const res = await fetch('https://valhalla1.openstreetmap.de/route', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(7000),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.trip?.legs?.length) {
                    const coords = (data.trip.legs as any[]).flatMap((l) => decodePolyline6(l.shape));
                    return {
                        coords,
                        distanceKm: data.trip.summary.length,
                        durationMin: data.trip.summary.time / 60,
                        hasToll: !!data.trip.summary.has_toll,
                    };
                }
            }
        } catch {
            // Timeout o error: marcamos Valhalla como caído y usamos OSRM.
            valhallaUp = false;
        }
    }
    return getRouteOSRM(points);
}

/** Respaldo con OSRM (no informa de peajes). */
async function getRouteOSRM(points: GeoPoint[]): Promise<RouteResult | null> {
    const coordsStr = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.routes?.length) return null;
    const r = data.routes[0];
    const coords = (r.geometry.coordinates as [number, number][]).map(
        ([lng, lat]) => [lat, lng] as [number, number]
    );
    return { coords, distanceKm: r.distance / 1000, durationMin: r.duration / 60 };
}

/** Progreso (0..1) de un punto a lo largo del trazado de la ruta. */
export function progressOnRoute(route: [number, number][], lat: number, lng: number): number {
    if (route.length < 2) return 0;
    const step = Math.max(1, Math.floor(route.length / 400));
    let minD = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < route.length; i += step) {
        const d = getDistance(lat, lng, route[i][0], route[i][1]);
        if (d < minD) {
            minD = d;
            bestIdx = i;
        }
    }
    return bestIdx / (route.length - 1);
}

export type Priority = 'cheap' | 'balanced' | 'fast';

export interface CorridorStation extends GasStation {
    detourKm: number; // distancia al trazado de la ruta
    progress: number; // 0..1 posición a lo largo de la ruta
    price: number; // precio del combustible elegido
}

/**
 * Encuentra las gasolineras dentro del "corredor" de la ruta y las puntúa.
 * Muestrea el trazado para que el cálculo sea ligero aunque haya miles de estaciones.
 */
export function findCorridorStations(
    stations: GasStation[],
    route: [number, number][],
    fuel: FuelType,
    corridorKm = 4
): CorridorStation[] {
    if (route.length === 0) return [];

    // Bounding box de la ruta + margen para prefiltrar.
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lat, lng] of route) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    }
    const margin = corridorKm / 100; // ~grados aprox
    minLat -= margin; maxLat += margin; minLng -= margin; maxLng += margin;

    // Muestreo del trazado (un punto de cada N) para acelerar.
    const step = Math.max(1, Math.floor(route.length / 400));
    const sampled: [number, number][] = [];
    for (let i = 0; i < route.length; i += step) sampled.push(route[i]);
    if (sampled[sampled.length - 1] !== route[route.length - 1]) sampled.push(route[route.length - 1]);

    const result: CorridorStation[] = [];
    for (const s of stations) {
        if (s.lat < minLat || s.lat > maxLat || s.lng < minLng || s.lng > maxLng) continue;
        const price = s.prices[fuel];
        if (price == null) continue;

        let minD = Infinity;
        let bestIdx = 0;
        for (let i = 0; i < sampled.length; i++) {
            const d = getDistance(s.lat, s.lng, sampled[i][0], sampled[i][1]);
            if (d < minD) {
                minD = d;
                bestIdx = i;
            }
        }
        if (minD <= corridorKm) {
            result.push({
                ...s,
                detourKm: minD,
                progress: bestIdx / (sampled.length - 1),
                price,
            });
        }
    }
    return result;
}

export interface FuelPlan {
    fuelNeeded: number;     // litros que consume el viaje
    startLiters: number;    // litros con los que sales
    usableStart: number;    // litros de salida utilizables (descontada la reserva)
    startRangeKm: number;   // km que puedes recorrer con el combustible de salida
    maxRangeKm: number;     // autonomía con depósito lleno (descontada la reserva)
    canMakeItNoStops: boolean;
    minStops: number;       // paradas mínimas necesarias
    litersToBuy: number;    // litros que necesitas comprar en el viaje
    reserveLiters: number;
}

// Margen de seguridad fijo: combustible que no quieres bajar ENTRE paradas
// (distinto de la reserva con la que quieres LLEGAR al destino).
export const SAFETY_PCT = 8;

/** Modelo de depósito: autonomía, paradas mínimas y litros a repostar. */
export function computeFuelPlan(params: {
    distanceKm: number;
    consumption: number; // L/100km
    capacity: number; // L
    startPct: number; // 0..100
    arrivePct?: number; // % con el que quieres LLEGAR al destino (def. 10)
    safetyPct?: number; // % de seguridad entre paradas (def. SAFETY_PCT)
}): FuelPlan {
    const arrivePct = params.arrivePct ?? 10;
    const safetyPct = params.safetyPct ?? SAFETY_PCT;
    const fuelNeeded = (params.distanceKm * params.consumption) / 100;
    const startLiters = (params.capacity * params.startPct) / 100;
    const arriveReserve = (params.capacity * arrivePct) / 100;
    const safetyReserve = (params.capacity * safetyPct) / 100;

    // Autonomía con el margen de seguridad (no la reserva de llegada).
    const usableStart = Math.max(0, startLiters - safetyReserve);
    const startRangeKm = (usableStart / params.consumption) * 100;
    const fullUsable = Math.max(0.1, params.capacity - safetyReserve);
    const maxRangeKm = (fullUsable / params.consumption) * 100;

    // Llegas sin repostar si, sin parar, terminas con al menos la reserva deseada.
    const canMakeItNoStops = startLiters - fuelNeeded >= arriveReserve;

    let minStops = 0;
    if (!canMakeItNoStops) {
        // Paradas por autonomía (no quedarte tirado)…
        const rangeStops = fuelNeeded <= usableStart
            ? 0
            : Math.max(1, Math.ceil((params.distanceKm - startRangeKm) / maxRangeKm));
        // …pero si llegas por autonomía aunque sin la reserva deseada, hace falta 1 parada.
        minStops = Math.max(1, rangeStops);
    }
    const litersToBuy = Math.max(0, fuelNeeded - startLiters + arriveReserve);

    return {
        fuelNeeded,
        startLiters,
        usableStart,
        startRangeKm,
        maxRangeKm,
        canMakeItNoStops,
        minStops,
        litersToBuy,
        reserveLiters: arriveReserve,
    };
}

export interface RefuelStop extends CorridorStation {
    liters: number; // litros a repostar en esta parada
    cost: number; // coste de ese repostaje
}

/**
 * Reparte el repostaje entre las paradas: en cada una se echa lo justo para
 * llegar a la siguiente (o al destino) manteniendo la reserva de llegada.
 */
export function allocateRefuels(
    stops: CorridorStation[],
    params: {
        totalDistanceKm: number;
        consumption: number;
        capacity: number;
        startLiters: number;
        arrivePct: number; // reserva deseada al LLEGAR al destino
        safetyPct?: number; // margen entre paradas
    }
): RefuelStop[] {
    const sorted = [...stops].sort((a, b) => a.progress - b.progress);
    const arriveReserve = (params.capacity * params.arrivePct) / 100;
    const safetyReserve = (params.capacity * (params.safetyPct ?? SAFETY_PCT)) / 100;
    const perKm = params.consumption / 100;
    let tank = params.startLiters;
    let prev = 0;
    const out: RefuelStop[] = [];

    for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        const legToHere = (s.progress - prev) * params.totalDistanceKm;
        tank = Math.max(0, tank - legToHere * perKm); // combustible al llegar a la parada
        const isLast = i === sorted.length - 1;
        const nextProgress = isLast ? 1 : sorted[i + 1].progress;
        const legToNext = (nextProgress - s.progress) * params.totalDistanceKm;
        // En la última parada llenamos para llegar con la reserva deseada;
        // en las intermedias, solo lo justo para llegar a la siguiente con el margen de seguridad.
        const targetReserve = isLast ? arriveReserve : safetyReserve;
        const needToNext = legToNext * perKm + targetReserve;
        const fill = Math.max(0, Math.min(params.capacity, needToNext) - tank);
        tank += fill;
        out.push({ ...s, liters: fill, cost: fill * s.price });
        prev = s.progress;
    }
    return out;
}

// Pesos relativos de precio vs. tiempo según la prioridad (sobre valores 0..1).
const PRIORITY_WEIGHTS: Record<Priority, { price: number; time: number }> = {
    cheap: { price: 1, time: 0.05 },
    balanced: { price: 0.6, time: 0.4 },
    fast: { price: 0.05, time: 1 },
};

// "Coste" en km de hacer una parada dedicada solo para repostar.
const DEDICATED_STOP_KM = 6;
// Si estás a <= esta distancia de una parada tuya, repostar ahí no añade tiempo.
const NEAR_WAYPOINT_KM = 4;

/**
 * Selecciona las paradas de repostaje a lo largo de la ruta según la prioridad.
 * - "barato": minimiza el precio.
 * - "rápido": minimiza el tiempo perdido (desvío + parada). Si pasas cerca de una
 *   parada tuya (p. ej. un restaurante), repostar ahí no cuesta tiempo y se prefiere.
 * - "equilibrado": mezcla ambos.
 * Precio y tiempo se normalizan a 0..1 para poder combinarlos de forma justa.
 */
export interface FuelRange {
    totalDistanceKm: number;
    startRangeKm: number; // km alcanzables con el combustible de salida
    maxRangeKm: number; // km alcanzables con el depósito lleno
    // Distancia máxima al destino para que la ÚLTIMA parada permita llegar con la
    // reserva deseada (si quieres llegar muy lleno, debe estar cerca del destino).
    arriveTopUpRangeKm?: number;
}

export function pickStops(
    corridor: CorridorStation[],
    stops: number,
    priority: Priority,
    waypoints: GeoPoint[] = [],
    fuel?: FuelRange
): CorridorStation[] {
    if (corridor.length === 0 || stops <= 0) return [];

    const nearestWaypointKm = (s: CorridorStation) =>
        waypoints.length
            ? Math.min(...waypoints.map((w) => getDistance(s.lat, s.lng, w.lat, w.lng)))
            : Infinity;

    // Coste de tiempo (km equivalentes): desvío + penalización si es parada dedicada.
    const enriched = corridor.map((s) => {
        const convenient = nearestWaypointKm(s) <= NEAR_WAYPOINT_KM;
        const timeCost = s.detourKm + (convenient ? 0 : DEDICATED_STOP_KM);
        return { s, price: s.price, timeCost };
    });

    const prices = enriched.map((e) => e.price);
    const times = enriched.map((e) => e.timeCost);
    const pMin = Math.min(...prices), pMax = Math.max(...prices);
    const tMin = Math.min(...times), tMax = Math.max(...times);
    const norm = (v: number, lo: number, hi: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);

    const w = PRIORITY_WEIGHTS[priority];
    const scored = enriched.map((e) => ({
        s: e.s,
        score: w.price * norm(e.price, pMin, pMax) + w.time * norm(e.timeCost, tMin, tMax),
    }));

    // Ventana de progreso [lo, hi] donde puede ir la parada k.
    // Con datos de autonomía: la parada va donde el depósito está bajo (no antes de
    // que haga falta), es decir, en el último tramo de cada "tanque". Sin esos datos,
    // se reparten en tramos iguales.
    const windowFor = (k: number): [number, number] => {
        if (fuel && fuel.maxRangeKm > 0 && fuel.totalDistanceKm > 0) {
            const D = fuel.totalDistanceKm;
            const deadlineKm = Math.min(D, fuel.startRangeKm + k * fuel.maxRangeKm);
            const windowKm = fuel.maxRangeKm * 0.45; // repostar en el último ~45% del tanque
            let loKm = Math.max(0, deadlineKm - windowKm);
            // En la ÚLTIMA parada, si quieres llegar muy lleno, debe estar cerca del
            // destino para que el repostaje alcance la reserva de llegada.
            if (k === stops - 1 && fuel.arriveTopUpRangeKm != null) {
                loKm = Math.max(loKm, D - fuel.arriveTopUpRangeKm);
            }
            return [Math.max(0, loKm / D), Math.min(1, deadlineKm / D)];
        }
        return [k / stops, (k + 1) / stops];
    };

    const picks: CorridorStation[] = [];
    for (let k = 0; k < stops; k++) {
        const [lo, hi] = windowFor(k);
        const available = scored.filter((x) => !picks.some((p) => p.id === x.s.id));
        let pool = available.filter((x) => x.s.progress >= lo && x.s.progress <= hi);
        // Si no hay estaciones en la ventana, ampliamos: cualquiera antes del límite;
        // y si tampoco, cualquiera disponible.
        if (pool.length === 0) pool = available.filter((x) => x.s.progress <= hi);
        if (pool.length === 0) pool = available;
        if (pool.length === 0) break;
        const best = pool.reduce((a, b) => (b.score < a.score ? b : a));
        picks.push(best.s);
    }
    return picks.sort((a, b) => a.progress - b.progress);
}
