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
}

/** Geocodifica una dirección/municipio en España con Nominatim (OpenStreetMap). */
export async function geocode(query: string): Promise<GeoResult | null> {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&q=${encodeURIComponent(
        query
    )}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        label: data[0].display_name as string,
    };
}

/** Calcula la ruta en coche entre dos puntos con OSRM (demo público). */
export async function getRoute(a: GeoPoint, b: GeoPoint): Promise<RouteResult | null> {
    return getRouteMulti([a, b]);
}

/** Calcula la ruta en coche pasando por varios puntos en orden (origen, paradas…, destino). */
export async function getRouteMulti(points: GeoPoint[]): Promise<RouteResult | null> {
    if (points.length < 2) return null;
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

/** Modelo de depósito: autonomía, paradas mínimas y litros a repostar. */
export function computeFuelPlan(params: {
    distanceKm: number;
    consumption: number; // L/100km
    capacity: number; // L
    startPct: number; // 0..100
    reservePct?: number; // % a no bajar (def. 10)
}): FuelPlan {
    const reservePct = params.reservePct ?? 10;
    const fuelNeeded = (params.distanceKm * params.consumption) / 100;
    const startLiters = (params.capacity * params.startPct) / 100;
    const reserveLiters = (params.capacity * reservePct) / 100;
    const usableStart = Math.max(0, startLiters - reserveLiters);
    const startRangeKm = (usableStart / params.consumption) * 100;
    const fullUsable = Math.max(0.1, params.capacity * (1 - reservePct / 100));
    const maxRangeKm = (fullUsable / params.consumption) * 100;
    const canMakeItNoStops = fuelNeeded <= usableStart;

    let minStops = 0;
    if (!canMakeItNoStops) {
        const remaining = params.distanceKm - startRangeKm;
        minStops = Math.max(1, Math.ceil(remaining / maxRangeKm));
    }
    const litersToBuy = Math.max(0, fuelNeeded - usableStart);

    return {
        fuelNeeded,
        startLiters,
        usableStart,
        startRangeKm,
        maxRangeKm,
        canMakeItNoStops,
        minStops,
        litersToBuy,
        reserveLiters,
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
        arrivePct: number;
    }
): RefuelStop[] {
    const sorted = [...stops].sort((a, b) => a.progress - b.progress);
    const reserveL = (params.capacity * params.arrivePct) / 100;
    const perKm = params.consumption / 100;
    let tank = params.startLiters;
    let prev = 0;
    const out: RefuelStop[] = [];

    for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        const legToHere = (s.progress - prev) * params.totalDistanceKm;
        tank = Math.max(0, tank - legToHere * perKm); // combustible al llegar a la parada
        const nextProgress = i < sorted.length - 1 ? sorted[i + 1].progress : 1;
        const legToNext = (nextProgress - s.progress) * params.totalDistanceKm;
        const needToNext = legToNext * perKm + reserveL;
        const fill = Math.max(0, Math.min(params.capacity, needToNext) - tank);
        tank += fill;
        out.push({ ...s, liters: fill, cost: fill * s.price });
        prev = s.progress;
    }
    return out;
}

// Pesos relativos de precio vs. tiempo según la prioridad (sobre valores 0..1).
const PRIORITY_WEIGHTS: Record<Priority, { price: number; time: number }> = {
    cheap: { price: 1, time: 0.1 },
    balanced: { price: 0.5, time: 0.5 },
    fast: { price: 0.1, time: 1 },
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
export function pickStops(
    corridor: CorridorStation[],
    stops: number,
    priority: Priority,
    waypoints: GeoPoint[] = []
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

    const picks: CorridorStation[] = [];
    for (let k = 0; k < stops; k++) {
        const lo = k / stops;
        const hi = (k + 1) / stops;
        const available = scored.filter((x) => !picks.some((p) => p.id === x.s.id));
        const inSegment = available.filter((x) => x.s.progress >= lo && x.s.progress < hi);
        const pool = inSegment.length > 0 ? inSegment : available;
        if (pool.length === 0) break;
        const best = pool.reduce((a, b) => (b.score < a.score ? b : a));
        picks.push(best.s);
    }
    return picks.sort((a, b) => a.progress - b.progress);
}
