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
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const main = p.name || street || p.city || p.county || '';
    const parts: string[] = [main];
    // Si es un lugar con nombre (comercio, hotel, POI…), añadimos su dirección
    // para distinguir dos locales de la misma cadena en la misma ciudad (p. ej.
    // los tres Carrefour de Cáceres). Sin calle en OSM, usamos el barrio.
    if (p.name) {
        if (street) parts.push(street);
        else if (p.district && p.district !== main) parts.push(p.district);
    }
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
    // lang=default: nombres locales de OSM ("Castilla y León"); sin él, Photon
    // traduce según el Accept-Language del navegador (en inglés → "Castile and León").
    const url = `https://photon.komoot.io/api/?limit=${limit}&lang=default&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const feats = (data.features || []).filter(
        (f: any) => f.geometry?.coordinates?.length === 2 && f.properties
    );
    // Preferimos resultados en España; si no hay, mostramos todos.
    const es = feats.filter((f: any) => f.properties.countrycode === 'ES');
    const use = es.length ? es : feats;
    // Photon devuelve entidades OSM distintas con el mismo nombre (p. ej. la
    // ciudad, el municipio y la provincia de "Valladolid"): con nuestra etiqueta
    // quedan idénticas a la vista, así que deduplicamos quedándonos con la más
    // relevante (Photon ordena por relevancia y la primera suele ser la ciudad).
    const seen = new Set<string>();
    const out: GeoResult[] = [];
    for (const f of use) {
        const label = photonLabel(f.properties);
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label });
    }
    return out;
}

/** Geocodifica un texto (devuelve la mejor coincidencia). */
export async function geocode(query: string): Promise<GeoResult | null> {
    const r = await searchPlaces(query, 1);
    return r[0] ?? null;
}

/** Dirección aproximada de unas coordenadas (para etiquetar puntos elegidos en el mapa). */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoResult | null> {
    try {
        // lang=default: nombres locales de OSM (ver searchPlaces).
        const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=default`);
        if (!res.ok) return null;
        const data = await res.json();
        const f = (data.features || [])[0];
        if (!f?.properties) return null;
        return { lat, lng, label: photonLabel(f.properties) };
    } catch {
        return null;
    }
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

/**
 * Kilómetros acumulados desde el origen hasta cada vértice del trazado. Se calcula una
 * vez por ruta (los arrays de coordenadas no se mutan, así que sirven de clave).
 */
const cumulativeCache = new WeakMap<[number, number][], number[]>();
function cumulativeKm(route: [number, number][]): number[] {
    let cum = cumulativeCache.get(route);
    if (!cum) {
        cum = [0];
        for (let i = 1; i < route.length; i++) {
            cum.push(cum[i - 1] + getDistance(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]));
        }
        cumulativeCache.set(route, cum);
    }
    return cum;
}

/**
 * Progreso (0..1) del vértice i medido en DISTANCIA recorrida. No vale i/(n-1): los
 * routers ponen muchos más vértices en curvas y ciudades que en autovía, y esa
 * proporción llegaba a desviarse más de 100 km de la posición real.
 */
function progressAt(route: [number, number][], i: number): number {
    const cum = cumulativeKm(route);
    const total = cum[cum.length - 1];
    return total > 0 ? cum[i] / total : 0;
}

/** Mayor distancia (km) entre dos vértices consecutivos de la muestra. */
const sampleGapCache = new WeakMap<[number, number][], number>();
function sampleGapKm(route: [number, number][], step: number): number {
    let gap = sampleGapCache.get(route);
    if (gap === undefined) {
        const cum = cumulativeKm(route);
        gap = 0;
        for (let i = 0; i < cum.length; i += step) gap = Math.max(gap, cum[Math.min(i + step, cum.length - 1)] - cum[i]);
        sampleGapCache.set(route, gap);
    }
    return gap;
}

/**
 * Vértice del trazado más cercano a un punto. Primero recorre una muestra (un vértice
 * de cada `step`) y luego afina entre los vecinos del mejor candidato, así la precisión
 * es la del trazado completo sin recorrer todos los vértices para cada gasolinera.
 * Con `maxKm`, si la muestra ya queda lejos se ahorra el afinado (no va a entrar).
 */
function nearestVertex(
    route: [number, number][],
    lat: number,
    lng: number,
    maxKm = Infinity
): { idx: number; km: number } {
    const step = Math.max(1, Math.floor(route.length / 400));
    const last = route.length - 1;
    const sampleIdx: number[] = [];
    for (let i = 0; i < route.length; i += step) sampleIdx.push(i);
    if (sampleIdx[sampleIdx.length - 1] !== last) sampleIdx.push(last);
    const samples = sampleIdx.map((i) => ({ i, d: getDistance(lat, lng, route[i][0], route[i][1]) }));
    const best = samples.reduce((a, b) => (b.d < a.d ? b : a));
    const coarse = best.d;
    if (step === 1) return { idx: best.i, km: best.d };

    // La distancia a la muestra puede exceder la real en hasta media separación entre
    // muestras (en autovía los vértices están muy espaciados). Se afina alrededor de
    // TODAS las muestras que podrían esconder el vértice más cercano: si la ruta pasa
    // dos veces cerca (circunvalaciones), el bueno no tiene por qué ser el de la muestra.
    const slack = sampleGapKm(route, step) / 2;
    if (coarse - slack > maxKm) return { idx: best.i, km: best.d };
    let km = best.d;
    let idx = best.i;
    for (const c of samples) {
        if (c.d - slack > Math.min(km, maxKm)) continue;
        const from = Math.max(0, c.i - step);
        const to = Math.min(last, c.i + step);
        for (let i = from; i <= to; i++) {
            const d = getDistance(lat, lng, route[i][0], route[i][1]);
            if (d < km) {
                km = d;
                idx = i;
            }
        }
    }
    return { idx, km };
}

/** Progreso (0..1) de un punto a lo largo del trazado de la ruta. */
export function progressOnRoute(route: [number, number][], lat: number, lng: number): number {
    if (route.length < 2) return 0;
    return progressAt(route, nearestVertex(route, lat, lng).idx);
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
    // Margen en grados: 1° de latitud son ~111 km, pero 1° de longitud mide menos cuanto
    // más al norte (~80 km a la latitud de Galicia).
    const marginLat = corridorKm / 111;
    const marginLng = corridorKm / (111 * Math.cos((Math.max(Math.abs(minLat), Math.abs(maxLat)) * Math.PI) / 180));
    minLat -= marginLat; maxLat += marginLat; minLng -= marginLng; maxLng += marginLng;

    const result: CorridorStation[] = [];
    for (const s of stations) {
        if (s.lat < minLat || s.lat > maxLat || s.lng < minLng || s.lng > maxLng) continue;
        const price = s.prices[fuel];
        if (price == null) continue;

        const near = nearestVertex(route, s.lat, s.lng, corridorKm);
        if (near.km <= corridorKm) {
            result.push({
                ...s,
                detourKm: near.km,
                progress: progressAt(route, near.idx),
                price,
            });
        }
    }
    return result;
}

export interface FuelPlan {
    fuelNeeded: number;     // litros que consume el viaje
    startLiters: number;    // litros con los que sales
    usableStart: number;    // litros de salida utilizables (descontado el mínimo)
    startRangeKm: number;   // km que puedes recorrer con el combustible de salida
    maxRangeKm: number;     // autonomía con depósito lleno (descontado el mínimo)
    canMakeItNoStops: boolean;
    minStops: number;       // paradas mínimas necesarias
    litersToBuy: number;    // litros que necesitas comprar en el viaje
    reserveLiters: number;  // reserva efectiva al LLEGAR (la mayor entre la pedida y tu mínimo)
    minLiters: number;      // litros mínimos que nunca se bajan ENTRE paradas (el mismo valor pasado, o el def.)
    belowMinAtStart: boolean; // sales ya con menos combustible que tu mínimo
}

// Margen de seguridad por defecto (%): combustible que no quieres bajar ENTRE
// paradas cuando el usuario no fija un mínimo explícito en litros.
export const SAFETY_PCT = 8;

/** Modelo de depósito: autonomía, paradas mínimas y litros a repostar. */
export function computeFuelPlan(params: {
    distanceKm: number;
    consumption: number; // L/100km
    capacity: number; // L
    startPct: number; // 0..100
    arrivePct?: number; // % con el que quieres LLEGAR al destino (def. 10)
    minLiters?: number; // litros mínimos que no quieres bajar ENTRE paradas (def. SAFETY_PCT% de la capacidad)
}): FuelPlan {
    const arrivePct = params.arrivePct ?? 10;
    // El mínimo no puede superar la capacidad del depósito (sería pedir más de lo que cabe).
    const minLiters = Math.min(
        Math.max(0, params.minLiters ?? (params.capacity * SAFETY_PCT) / 100),
        params.capacity
    );
    const fuelNeeded = (params.distanceKm * params.consumption) / 100;
    const startLiters = (params.capacity * params.startPct) / 100;
    const arriveReserve = (params.capacity * arrivePct) / 100;
    // La reserva de llegada nunca puede ser menor que tu mínimo: no tendría sentido
    // pedir "quiero llegar con el X%" y a la vez "nunca bajar de Y L" si Y > X%.
    const effectiveArriveReserve = Math.max(arriveReserve, minLiters);

    // Autonomía con el mínimo reservado (no la reserva de llegada, que puede ser mayor).
    const usableStart = Math.max(0, startLiters - minLiters);
    const startRangeKm = (usableStart / params.consumption) * 100;
    const fullUsable = Math.max(0.1, params.capacity - minLiters);
    const maxRangeKm = (fullUsable / params.consumption) * 100;

    // Llegas sin repostar si, sin parar, terminas con al menos la reserva deseada
    // (que ya incorpora tu mínimo, por si es mayor que la reserva de llegada pedida).
    const canMakeItNoStops = startLiters - fuelNeeded >= effectiveArriveReserve;

    let minStops = 0;
    if (!canMakeItNoStops) {
        // Paradas por autonomía (no quedarte tirado)…
        const rangeStops = fuelNeeded <= usableStart
            ? 0
            : Math.max(1, Math.ceil((params.distanceKm - startRangeKm) / maxRangeKm));
        // …pero si llegas por autonomía aunque sin la reserva deseada, hace falta 1 parada.
        minStops = Math.max(1, rangeStops);
    }
    const litersToBuy = Math.max(0, fuelNeeded - startLiters + effectiveArriveReserve);

    return {
        fuelNeeded,
        startLiters,
        usableStart,
        startRangeKm,
        maxRangeKm,
        canMakeItNoStops,
        minStops,
        litersToBuy,
        reserveLiters: effectiveArriveReserve,
        minLiters,
        belowMinAtStart: startLiters < minLiters,
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
        minLiters?: number; // litros mínimos entre paradas (def. SAFETY_PCT% de la capacidad)
    }
): RefuelStop[] {
    const sorted = [...stops].sort((a, b) => a.progress - b.progress);
    const arriveReserve = (params.capacity * params.arrivePct) / 100;
    const minLiters = params.minLiters ?? (params.capacity * SAFETY_PCT) / 100;
    // La última parada nunca reposta menos de lo que hace falta para no bajar del
    // mínimo, aunque la reserva de llegada pedida sea menor.
    const effectiveArriveReserve = Math.max(arriveReserve, minLiters);
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
        // En la última parada llenamos para llegar con la reserva efectiva;
        // en las intermedias, solo lo justo para llegar a la siguiente sin bajar del mínimo.
        const targetReserve = isLast ? effectiveArriveReserve : minLiters;
        const needToNext = legToNext * perKm + targetReserve;
        const fill = Math.max(0, Math.min(params.capacity, needToNext) - tank);
        tank += fill;
        out.push({ ...s, liters: fill, cost: fill * s.price });
        prev = s.progress;
    }
    return out;
}

export interface TankLevels {
    arrivalLiters: number; // combustible con el que se llega a esa parada
    departureLiters: number; // combustible con el que se sale (= llegada + repostaje, si repostas)
}

/**
 * Simula el nivel del depósito en cada parada de la ruta, en el orden en que
 * se visitan (paradas propias del usuario Y de repostaje mezcladas). El
 * consumo entre paradas solo depende de la distancia, así que una parada sin
 * repostar no afecta al cálculo de las que sí repostan: simplemente "pasa de
 * largo" con el mismo nivel de depósito con el que llegó.
 */
export function simulateTankLevels(
    points: { progress: number; isRefuel: boolean; liters?: number }[],
    params: { startLiters: number; totalDistanceKm: number; consumption: number }
): TankLevels[] {
    const perKm = params.consumption / 100;
    let tank = params.startLiters;
    let prevProgress = 0;
    return points.map((p) => {
        const legKm = (p.progress - prevProgress) * params.totalDistanceKm;
        const arrivalLiters = Math.max(0, tank - legKm * perKm);
        const departureLiters = p.isRefuel ? arrivalLiters + (p.liters ?? 0) : arrivalLiters;
        tank = departureLiters;
        prevProgress = p.progress;
        return { arrivalLiters, departureLiters };
    });
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
        return { s, price: s.price, timeCost, convenient };
    });

    const prices = enriched.map((e) => e.price);
    const times = enriched.map((e) => e.timeCost);
    const pMin = Math.min(...prices), pMax = Math.max(...prices);
    const tMin = Math.min(...times), tMax = Math.max(...times);
    const norm = (v: number, lo: number, hi: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);

    const w = PRIORITY_WEIGHTS[priority];
    const scored = enriched.map((e) => ({
        s: e.s,
        convenient: e.convenient,
        score: w.price * norm(e.price, pMin, pMax) + w.time * norm(e.timeCost, tMin, tMax),
    }));

    // Límites de progreso (0..1) donde puede ir la parada k, respecto a la posición
    // REAL de la parada anterior (prevProg; 0 = salida). Se distinguen:
    //  - hi: hasta dónde llegas con el combustible disponible desde la parada
    //    anterior. Nunca se coloca una parada fuera de tu alcance real.
    //  - hardLo: mínimo INNEGOCIABLE para que, desde aquí, los depósitos que quedan
    //    MÁS la aproximación final (reservando el combustible de llegada) alcancen el
    //    destino. Garantiza que no te quedes tirado ni te pases de largo del destino.
    //  - prefLo: preferencia de repostar en el último ~45% del depósito (no recién salido).
    // Sin datos de autonomía se reparten en tramos iguales.
    const bounds = (k: number, prevProg: number): { hardLo: number; prefLo: number; hi: number } => {
        if (fuel && fuel.maxRangeKm > 0 && fuel.totalDistanceKm > 0) {
            const D = fuel.totalDistanceKm;
            const prevKm = prevProg * D;
            const hiKm = Math.min(D, k === 0 ? fuel.startRangeKm : prevKm + fuel.maxRangeKm);
            // El último tramo debe reservar el combustible de llegada: su alcance útil
            // es arriveTopUpRangeKm (si se conoce); los intermedios, un depósito lleno.
            const lastReachKm = fuel.arriveTopUpRangeKm ?? fuel.maxRangeKm;
            const feasibleLoKm = D - lastReachKm - (stops - 1 - k) * fuel.maxRangeKm;
            const hardLoKm = Math.min(hiKm, Math.max(0, prevKm, feasibleLoKm));
            const prefLoKm = Math.min(hiKm, Math.max(hardLoKm, hiKm - fuel.maxRangeKm * 0.45));
            return { hardLo: hardLoKm / D, prefLo: prefLoKm / D, hi: hiKm / D };
        }
        return { hardLo: k / stops, prefLo: k / stops, hi: (k + 1) / stops };
    };

    const picks: CorridorStation[] = [];
    let prevProg = 0; // progreso de la última parada elegida (salida = 0)
    for (let k = 0; k < stops; k++) {
        const { hardLo, prefLo, hi } = bounds(k, prevProg);
        const available = scored.filter((x) => !picks.some((p) => p.id === x.s.id));
        // 1) preferente y factible. Las estaciones "convenient" (junto a una parada
        //    propia: repostar ahí no cuesta tiempo) entran desde el mínimo FACTIBLE,
        //    saltándose la preferencia del ~45% del tanque: no tiene sentido descartar
        //    la gasolinera de tu propia parada por pillarte "demasiado pronto".
        // 2) factible (relaja la preferencia, mantiene el mínimo innegociable para no
        //    quedarte tirado ni pasarte del destino).
        let pool = available.filter(
            (x) => x.s.progress <= hi && x.s.progress >= (x.convenient ? hardLo : prefLo)
        );
        if (pool.length === 0) pool = available.filter((x) => x.s.progress >= hardLo && x.s.progress <= hi);
        if (pool.length > 0) {
            const best = pool.reduce((a, b) => (b.score < a.score ? b : a));
            picks.push(best.s);
            prevProg = best.s.progress;
            continue;
        }
        // 3) Último recurso (corredor sin estación en el tramo factible): coge la más
        //    AVANZADA a tu alcance (<= hi) para minimizar el hueco; si ninguna es
        //    alcanzable, la más cercana. Nunca una barata al inicio que rompa el plan.
        const reachable = available.filter((x) => x.s.progress <= hi);
        const chosen = reachable.length
            ? reachable.reduce((a, b) => (b.s.progress > a.s.progress ? b : a))
            : available.reduce((a, b) => (b.s.progress < a.s.progress ? b : a), available[0]);
        if (!chosen) break;
        picks.push(chosen.s);
        prevProg = chosen.s.progress;
    }
    return picks.sort((a, b) => a.progress - b.progress);
}
