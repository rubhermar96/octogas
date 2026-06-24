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
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
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

/** Penalización por km de desvío según prioridad (€ equivalentes por km). */
const DETOUR_PENALTY: Record<Priority, number> = {
    cheap: 0.01,
    balanced: 0.05,
    fast: 0.2,
};

/**
 * Selecciona las paradas de repostaje recomendadas a lo largo de la ruta.
 * Divide la ruta en tramos y elige en cada uno la estación con mejor puntuación
 * (precio + penalización por desvío según la prioridad).
 */
export function pickStops(
    corridor: CorridorStation[],
    stops: number,
    priority: Priority
): CorridorStation[] {
    if (corridor.length === 0 || stops <= 0) return [];
    const penalty = DETOUR_PENALTY[priority];
    const scored = corridor.map((s) => ({ s, score: s.price + s.detourKm * penalty }));

    const picks: CorridorStation[] = [];
    for (let k = 0; k < stops; k++) {
        // Tramo k de la ruta (reparte las paradas a lo largo del trayecto).
        const lo = k / stops;
        const hi = (k + 1) / stops;
        const inSegment = scored.filter((x) => x.s.progress >= lo && x.s.progress < hi);
        const pool = inSegment.length > 0 ? inSegment : scored;
        const best = pool.reduce((a, b) => (b.score < a.score ? b : a));
        if (!picks.find((p) => p.id === best.s.id)) picks.push(best.s);
    }
    return picks.sort((a, b) => a.progress - b.progress);
}
