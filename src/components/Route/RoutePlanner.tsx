import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { GasStation, FuelType } from '../../types/gasolinera';
import { FUEL_ORDER, FUEL_LABELS } from '../../lib/fuels';
import {
    geocode,
    getRouteMulti,
    findCorridorStations,
    pickStops,
    computeFuelPlan,
    allocateRefuels,
    progressOnRoute,
    simulateTankLevels,
    type GeoResult,
    type Priority,
    type FuelPlan,
    type RefuelStop,
} from '../../lib/route';
import BrandLogo from '../Explorer/BrandLogo';
import BrandFilter, { type BrandOption } from '../Explorer/BrandFilter';
import PlaceInput, { type PlaceValue } from './PlaceInput';
import MapPicker from './MapPicker';
import { stationUrl } from '../../lib/stationUrl';
import { displayCity } from '../../lib/placeName';
import { stationIcon, StationPopup, stationMarkerStyles } from '../Map/StationMarker';
import styles from './RoutePlanner.module.css';

// Color del borde del marcador según el precio frente a la media del corredor
// (mismos umbrales que el Explorador, para que el código de color coincida).
function priceColor(price: number, corridorAvg: number): string {
    if (!corridorAvg) return '#94a3b8';
    if (price <= corridorAvg * 0.985) return '#22c55e';
    if (price >= corridorAvg * 1.015) return '#ef4444';
    return '#f59e0b';
}

const ROUTE_FUELS: FuelType[] = FUEL_ORDER;

const CONSUMPTION_PRESETS = [
    { label: 'Compacto', v: 5.5 },
    { label: 'Berlina', v: 6.5 },
    { label: 'SUV', v: 8 },
    { label: 'Furgoneta', v: 9.5 },
];

const PRIORITIES: { id: Priority; label: string }[] = [
    { id: 'cheap', label: 'Más barato' },
    { id: 'balanced', label: 'Equilibrado' },
    { id: 'fast', label: 'Más rápido' },
];

const endpointIcon = (letter: string, color: string) =>
    L.divIcon({
        className: 'octo-route-endpoint',
        html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"><span style="transform:rotate(45deg);font-weight:800;font-size:13px">${letter}</span></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26],
    });

interface PlanOption {
    picks: RefuelStop[];
    avgPrice: number;
    cost: number;
    avgDetour: number;
}

/** Parada de la ruta (propia o de repostaje) con el nivel de depósito calculado. */
interface StopCard {
    type: 'wp' | 'fuel';
    label: string;
    arrivalLiters: number;
    departureLiters: number;
    station?: RefuelStop; // solo si type === 'fuel'
    legCostToNext: number | null; // solo si type === 'wp' (null si no aplica)
    legKmToNext: number | null;
    isLastStop: boolean; // no hay más paradas después (lo siguiente es el destino)
}

type OrderedPoint = { lat: number; lng: number; label: string; type: 'wp' | 'fuel' | 'dest' };

/** Resultado completo de UNA estrategia (barata / equilibrada / rápida): sus
 *  paradas, su ruta trazada y sus cifras. Las tres se calculan a la vez para
 *  poder alternar entre ellas sin volver a pedir la ruta. */
interface PlanResult extends PlanOption {
    priority: Priority;
    coords: [number, number][];
    distanceKm: number;
    durationMin: number;
    hasToll?: boolean;
    orderedPoints: OrderedPoint[];
    stopCards: StopCard[];
    tripFuelCost: number;
    savings: number;
}

/** Datos compartidos por todas las estrategias de un mismo cálculo. */
interface RouteData {
    origin: { lat: number; lng: number; label: string };
    destination: { lat: number; lng: number; label: string };
    customStops: GeoResult[];
    corridorAvg: number;
    fuelPlan: FuelPlan;
    nStops: number;
    roundTrip: boolean;
    avoidedTolls: boolean;
    baselineCost: number;
    fuel: FuelType;
    plans: PlanResult[];
    initialPriority: Priority;
}

/** Vista "plana" = datos compartidos + la estrategia activa, con la misma forma
 *  que consumen el render y las funciones de exportar/compartir. */
interface ActiveRoute {
    origin: { lat: number; lng: number; label: string };
    destination: { lat: number; lng: number; label: string };
    customStops: GeoResult[];
    corridorAvg: number;
    fuelPlan: FuelPlan;
    nStops: number;
    roundTrip: boolean;
    avoidedTolls: boolean;
    baselineCost: number;
    fuel: FuelType;
    coords: [number, number][];
    distanceKm: number;
    durationMin: number;
    hasToll?: boolean;
    orderedPoints: OrderedPoint[];
    stopCards: StopCard[];
    recommended: PlanOption;
    tripFuelCost: number;
    savings: number;
}

const FitBounds: React.FC<{ coords: [number, number][] }> = ({ coords }) => {
    const map = useMap();
    useEffect(() => {
        if (coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
    }, [coords, map]);
    return null;
};

const fmtDuration = (min: number) => {
    const total = Math.round(min);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

// --- Parámetros de la ruta en la URL (para compartir/reabrir el planificador) ---
interface RouteInputs {
    origin: PlaceValue;
    destination: PlaceValue;
    waypoints: PlaceValue[];
    fuel: FuelType;
    consumption: number;
    capacity: number;
    startPct: number;
    arrivePct: number;
    minLiters: number;
    priority: Priority;
    avoidTolls: boolean;
    roundTrip: boolean;
    brands: string[];
}

function serializeInputs(v: RouteInputs): string {
    const p = new URLSearchParams();
    p.set('o', v.origin.text);
    p.set('d', v.destination.text);
    const wps = v.waypoints.map((w) => w.text).filter(Boolean);
    if (wps.length) p.set('w', wps.join('~'));
    p.set('f', v.fuel);
    p.set('c', String(v.consumption));
    p.set('cap', String(v.capacity));
    p.set('s', String(v.startPct));
    p.set('a', String(v.arrivePct));
    p.set('ml', String(v.minLiters));
    p.set('p', v.priority);
    if (v.avoidTolls) p.set('t', '1');
    if (v.roundTrip) p.set('rt', '1');
    if (v.brands.length) p.set('b', v.brands.join('~'));
    return p.toString();
}

function parseInputs(search: string): RouteInputs | null {
    const p = new URLSearchParams(search);
    const o = p.get('o');
    const d = p.get('d');
    if (!o || !d) return null;
    const num = (key: string, def: number) => (p.get(key) != null ? Number(p.get(key)) : def);
    return {
        origin: { text: o },
        destination: { text: d },
        waypoints: p.get('w') ? p.get('w')!.split('~').map((t) => ({ text: t })) : [],
        fuel: (p.get('f') as FuelType) || 'sp95',
        consumption: num('c', 6.5),
        capacity: num('cap', 50),
        startPct: num('s', 80),
        arrivePct: num('a', 15),
        minLiters: num('ml', 4),
        priority: (p.get('p') as Priority) || 'cheap',
        avoidTolls: p.get('t') === '1',
        roundTrip: p.get('rt') === '1',
        brands: p.get('b') ? p.get('b')!.split('~') : [],
    };
}

/** Enlace de Google Maps con las paradas (repostajes incluidos) como waypoints. */
function googleMapsUrl(r: ActiveRoute): string {
    // En ida y vuelta el destino es el origen (B va como waypoint en orderedPoints).
    const dest = r.roundTrip ? r.origin : r.destination;
    const base =
        `https://www.google.com/maps/dir/?api=1` +
        `&origin=${r.origin.lat},${r.origin.lng}` +
        `&destination=${dest.lat},${dest.lng}` +
        `&travelmode=driving`;
    const wp = r.orderedPoints.map((p) => `${p.lat},${p.lng}`).join('|');
    return wp ? `${base}&waypoints=${encodeURIComponent(wp)}` : base;
}

/** Apple Maps: encadena las paradas con "to:" (compatibilidad variable). */
function appleMapsUrl(r: ActiveRoute): string {
    const dest = r.roundTrip ? r.origin : r.destination;
    const dests = [...r.orderedPoints.map((p) => `${p.lat},${p.lng}`), `${dest.lat},${dest.lng}`];
    return `https://maps.apple.com/?saddr=${r.origin.lat},${r.origin.lng}&daddr=${encodeURIComponent(dests.join(' to:'))}&dirflg=d`;
}

/** Waze solo admite un destino: navegamos al destino final. */
function wazeUrl(r: ActiveRoute): string {
    return `https://www.waze.com/ul?ll=${r.destination.lat},${r.destination.lng}&navigate=yes`;
}

const API_BASE = (import.meta.env.PUBLIC_API_BASE_URL as string | undefined) || 'http://localhost:3001';

/** Acorta una URL con el backend propio (POST /api/shorten + GET /r/:code). Si falla
 *  (backend caído, sin red…), devuelve la URL original tal cual para no romper el share. */
async function shortenUrl(url: string): Promise<string> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${API_BASE}/api/shorten`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return url;
        const { code } = (await res.json()) as { code?: string };
        return code ? `${API_BASE}/r/${code}` : url;
    } catch {
        return url;
    }
}

/** Texto resumen para compartir (WhatsApp, etc.), con enlace para reabrir en OCTO. */
function buildShareText(r: ActiveRoute, octoUrl: string, gmapsUrl: string): string {
    const lines: string[] = [];
    lines.push(
        `🚗 Ruta OCTO: ${r.origin.label.split(',')[0]} → ${r.destination.label.split(',')[0]}${r.roundTrip ? ' (ida y vuelta)' : ''}`
    );
    lines.push(
        `📏 ${r.distanceKm.toFixed(0)} km · ⏱️ ${fmtDuration(r.durationMin)} · ⛽ ${r.fuelPlan.fuelNeeded.toFixed(0)} L (~${r.tripFuelCost.toFixed(2)} €)`
    );
    if (r.hasToll) lines.push('⚠️ Incluye peajes');
    if (r.recommended.picks.length > 0) {
        lines.push('', 'Repostajes recomendados:');
        r.recommended.picks.forEach((s, i) => {
            lines.push(
                `${i + 1}. ${s.name} (${displayCity(s.city)}) — ${s.price.toFixed(3)} €/L · repostar ${s.liters.toFixed(0)} L (${s.cost.toFixed(2)} €)`
            );
        });
    }
    lines.push('', `🐙 Abrir en OCTO: ${octoUrl}`);
    lines.push(`🗺️ Google Maps: ${gmapsUrl}`);
    return lines.join('\n');
}

async function shareRoute(r: ActiveRoute) {
    const fullOctoUrl = typeof window !== 'undefined' ? window.location.href : '';
    const [octoUrl, gmapsUrl] = await Promise.all([
        shortenUrl(fullOctoUrl),
        shortenUrl(googleMapsUrl(r)),
    ]);
    const text = buildShareText(r, octoUrl, gmapsUrl);

    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
        try {
            await nav.share({ title: 'Ruta OCTO', text, url: octoUrl });
            return;
        } catch {
            return; // el usuario canceló
        }
    }
    // Sin Web Share API (p. ej. escritorio): abrimos WhatsApp.
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

// Iconos de las plataformas (SVG inline) para botones compactos solo-icono.
const GoogleMapsIcon = () => (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path fill="#EA4335" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
        <circle cx="12" cy="9" r="2.6" fill="#fff" />
    </svg>
);

const AppleMapsIcon = () => (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#5ac85a" />
        <path d="M17 6.5l-9.5 4.2L11 12.2 12.2 16z" fill="#ff3b30" />
    </svg>
);

const WazeIcon = () => (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
            fill="#33ccff"
            d="M12 3c4.4 0 8 3 8 6.8 0 3.8-3.6 6.8-8 6.8-.6 0-1.2-.05-1.7-.16C9 17.7 7 18.6 5.2 18.6c.9-.9 1.1-2.1.9-3C4.4 14.3 4 12.6 4 9.8 4 6 7.6 3 12 3z"
        />
        <circle cx="9.6" cy="9.6" r="1" fill="#0b3d52" />
        <circle cx="14.4" cy="9.6" r="1" fill="#0b3d52" />
        <path d="M9.3 12.2c.9 1 4.5 1 5.4 0" stroke="#0b3d52" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    </svg>
);

interface PlanCtx {
    totalDistanceKm: number;
    startLiters: number;
    startRangeKm: number;
    maxRangeKm: number;
    arriveTopUpRangeKm: number;
    waypoints: { lat: number; lng: number }[];
    consumption: number;
    capacity: number;
    arrivePct: number;
    minLiters: number;
}

function buildPlan(
    corridor: ReturnType<typeof findCorridorStations>,
    n: number,
    prio: Priority,
    ctx: PlanCtx
): PlanOption {
    const raw = pickStops(corridor, n, prio, ctx.waypoints, {
        totalDistanceKm: ctx.totalDistanceKm,
        startRangeKm: ctx.startRangeKm,
        maxRangeKm: ctx.maxRangeKm,
        arriveTopUpRangeKm: ctx.arriveTopUpRangeKm,
    });
    const picks = allocateRefuels(raw, {
        totalDistanceKm: ctx.totalDistanceKm,
        consumption: ctx.consumption,
        capacity: ctx.capacity,
        startLiters: ctx.startLiters,
        arrivePct: ctx.arrivePct,
        minLiters: ctx.minLiters,
    });
    const avgPrice = picks.length ? picks.reduce((s, x) => s + x.price, 0) / picks.length : 0;
    const avgDetour = picks.length ? picks.reduce((s, x) => s + x.detourKm, 0) / picks.length : 0;
    const cost = picks.reduce((s, x) => s + x.cost, 0);
    return { picks, avgPrice, cost, avgDetour };
}

interface StopDataCtx {
    b: GeoResult;
    customStops: GeoResult[];
    baseCoords: [number, number][];
    baseDistanceKm: number;
    roundTrip: boolean;
    destText: string;
    startLiters: number;
    consumption: number;
    corridorAvg: number;
}

/** A partir de las gasolineras elegidas por una estrategia, arma la lista de
 *  puntos ordenados (paradas propias + repostajes + destino en ida y vuelta) y
 *  las tarjetas con el nivel de depósito y el gasto en cada tramo. */
function buildStopData(picks: RefuelStop[], ctx: StopDataCtx): { orderedPoints: OrderedPoint[]; stopCards: StopCard[] } {
    const wpPoints = ctx.customStops.map((c) => ({
        lat: c.lat, lng: c.lng, label: c.label.split(',')[0], type: 'wp' as const,
        progress: progressOnRoute(ctx.baseCoords, c.lat, c.lng),
    }));
    const fuelPoints = picks.map((s) => ({
        lat: s.lat, lng: s.lng, label: s.name, type: 'fuel' as const, progress: s.progress, station: s,
    }));
    const orderedPoints: OrderedPoint[] = [
        ...wpPoints,
        ...fuelPoints,
        ...(ctx.roundTrip
            ? [{ lat: ctx.b.lat, lng: ctx.b.lng, label: ctx.destText.split(',')[0], type: 'dest' as const, progress: progressOnRoute(ctx.baseCoords, ctx.b.lat, ctx.b.lng) }]
            : []),
    ]
        .sort((x, y) => x.progress - y.progress)
        .map(({ lat, lng, label, type }) => ({ lat, lng, label, type }));

    const stopPoints = [...wpPoints, ...fuelPoints].sort((x, y) => x.progress - y.progress);
    const tankLevels = simulateTankLevels(
        stopPoints.map((p) => ({ progress: p.progress, isRefuel: p.type === 'fuel', liters: p.type === 'fuel' ? p.station.liters : undefined })),
        { startLiters: ctx.startLiters, totalDistanceKm: ctx.baseDistanceKm, consumption: ctx.consumption }
    );
    const stopCards: StopCard[] = stopPoints.map((p, i) => {
        const { arrivalLiters, departureLiters } = tankLevels[i];
        const isLastStop = i === stopPoints.length - 1;
        let legCostToNext: number | null = null;
        let legKmToNext: number | null = null;
        if (p.type === 'wp') {
            const nextProgress = isLastStop ? 1 : stopPoints[i + 1].progress;
            legKmToNext = (nextProgress - p.progress) * ctx.baseDistanceKm;
            legCostToNext = legKmToNext * (ctx.consumption / 100) * ctx.corridorAvg;
        }
        return {
            type: p.type, label: p.label, arrivalLiters, departureLiters,
            station: p.type === 'fuel' ? p.station : undefined,
            legCostToNext, legKmToNext, isLastStop,
        };
    });
    return { orderedPoints, stopCards };
}

/** Etiqueta larga de una estrategia. */
function planFullLabel(p: Priority): string {
    return p === 'cheap' ? 'Más barato' : p === 'fast' ? 'Más rápido' : 'Equilibrado';
}

const RoutePlanner: React.FC = () => {
    const [allStations, setAllStations] = useState<GasStation[]>([]);
    const [origin, setOrigin] = useState<PlaceValue>({ text: '' });
    const [destination, setDestination] = useState<PlaceValue>({ text: '' });
    const [waypoints, setWaypoints] = useState<PlaceValue[]>([]);
    const [fuel, setFuel] = useState<FuelType>('sp95');
    const [consumption, setConsumption] = useState(6.5);
    const [capacity, setCapacity] = useState(50);
    const [startPct, setStartPct] = useState(80);
    const [arrivePct, setArrivePct] = useState(15);
    // Litros mínimos que no se quieren bajar ENTRE paradas (ni al llegar sin repostar).
    // Por defecto, el equivalente al margen de seguridad de siempre (8% de 50 L).
    const [minLiters, setMinLiters] = useState(4);
    const [priority, setPriority] = useState<Priority>('cheap');
    const [avoidTolls, setAvoidTolls] = useState(false);
    const [roundTrip, setRoundTrip] = useState(false);
    const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [sharing, setSharing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<RouteData | null>(null);
    // Estrategia que se está viendo (se alterna sin recalcular).
    const [selectedPriority, setSelectedPriority] = useState<Priority>('cheap');
    // Campo para el que se está eligiendo un punto en el mapa (null = cerrado).
    const [picking, setPicking] = useState<
        { kind: 'origin' } | { kind: 'destination' } | { kind: 'wp'; index: number } | null
    >(null);
    const feedbackRef = useRef<HTMLDivElement>(null);
    const autoRan = useRef(false);

    useEffect(() => {
        fetch('/data/stations.json')
            .then((r) => r.json())
            .then(setAllStations)
            .catch(() => setAllStations([]));
    }, []);

    // Al empezar a calcular o al tener resultado, llevamos la vista a esa sección.
    useEffect(() => {
        if (loading || result) {
            feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [loading, result]);

    const addWaypoint = () => setWaypoints((w) => [...w, { text: '' }]);
    const removeWaypoint = (i: number) => setWaypoints((w) => w.filter((_, idx) => idx !== i));
    const updateWaypoint = (i: number, val: PlaceValue) =>
        setWaypoints((w) => w.map((x, idx) => (idx === i ? val : x)));

    // Marcas disponibles (con conteo) para restringir dónde repostar.
    const brandOptions = useMemo<BrandOption[]>(() => {
        const counts = new Map<string, number>();
        for (const s of allStations) counts.set(s.brand, (counts.get(s.brand) ?? 0) + 1);
        return [...counts.entries()]
            .map(([brand, count]) => ({ brand, count }))
            .sort((a, b) => b.count - a.count);
    }, [allStations]);

    const currentInputs = (): RouteInputs => ({
        origin,
        destination,
        waypoints,
        fuel,
        consumption,
        capacity,
        startPct,
        arrivePct,
        minLiters,
        priority,
        avoidTolls,
        roundTrip,
        brands: [...selectedBrands],
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        runCalculation(currentInputs());
    };

    const runCalculation = async (inp: RouteInputs) => {
        setError(null);
        if (!inp.origin.text.trim() || !inp.destination.text.trim()) {
            setError('Indica origen y destino.');
            return;
        }
        setLoading(true);
        setResult(null);
        try {
            // Resolvemos cada lugar: si se eligió de la lista/mapa usamos sus coordenadas;
            // si solo se escribió texto, lo geocodificamos. Un texto "lat, lng" (punto de
            // mapa sin dirección, p. ej. al reabrir una URL compartida) se parsea directo.
            const resolve = async (pv: PlaceValue): Promise<GeoResult | null> => {
                if (pv.lat != null && pv.lng != null) return { lat: pv.lat, lng: pv.lng, label: pv.text };
                const t = pv.text.trim();
                if (!t) return null;
                const m = t.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
                if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]), label: t };
                return geocode(t);
            };
            const wpList = inp.waypoints.filter((w) => w.text.trim());
            const [a, b, ...wpGeo] = await Promise.all([
                resolve(inp.origin),
                resolve(inp.destination),
                ...wpList.map(resolve),
            ]);
            if (!a) throw new Error(`No se encontró el origen "${inp.origin.text}".`);
            if (!b) throw new Error(`No se encontró el destino "${inp.destination.text}".`);
            const customStops = wpGeo.filter((g): g is GeoResult => g != null);
            if (wpGeo.length !== customStops.length) {
                throw new Error('No se encontró alguna de las paradas indicadas.');
            }

            // Ruta base: pasa por tus paradas propias (p. ej. donde vas a comer).
            // Ida y vuelta: añadimos el regreso al origen al final.
            const basePoints = inp.roundTrip
                ? [a, ...customStops, b, a]
                : [a, ...customStops, b];
            const baseRoute = await getRouteMulti(basePoints, { avoidTolls: inp.avoidTolls });
            if (!baseRoute) throw new Error('No se pudo calcular la ruta entre esos puntos.');

            const corridorRaw = findCorridorStations(allStations, baseRoute.coords, inp.fuel);
            if (corridorRaw.length === 0) {
                throw new Error('No hay gasolineras con ese combustible cerca de la ruta.');
            }
            // Si has elegido marcas, solo repostamos en ellas.
            const brandSet = new Set(inp.brands);
            const corridor = brandSet.size
                ? corridorRaw.filter((s) => brandSet.has(s.brand))
                : corridorRaw;
            if (corridor.length === 0) {
                throw new Error(
                    'No hay gasolineras de las marcas elegidas cerca de la ruta. Prueba a quitar el filtro de marcas.'
                );
            }
            const corridorAvg = corridor.reduce((s, x) => s + x.price, 0) / corridor.length;

            const fuelPlan = computeFuelPlan({
                distanceKm: baseRoute.distanceKm,
                consumption: inp.consumption,
                capacity: inp.capacity,
                startPct: inp.startPct,
                arrivePct: inp.arrivePct, // reserva con la que quieres llegar
                minLiters: inp.minLiters, // nunca bajar de aquí entre paradas
            });

            // Las paradas de repostaje se calculan siempre automáticamente (las mínimas
            // necesarias). El usuario añade sus propias paradas con "Añadir parada".
            const nStops = fuelPlan.minStops;
            const litersToBuy = fuelPlan.litersToBuy;
            const ctx = {
                totalDistanceKm: baseRoute.distanceKm,
                startLiters: fuelPlan.startLiters,
                startRangeKm: fuelPlan.startRangeKm,
                maxRangeKm: fuelPlan.maxRangeKm,
                // Distancia máxima al destino para la última parada (alcanzar la reserva
                // efectiva de llegada, que ya incorpora el mínimo si es mayor que arrivePct).
                arriveTopUpRangeKm: (inp.capacity - fuelPlan.reserveLiters) / inp.consumption * 100,
                waypoints: customStops.map((c) => ({ lat: c.lat, lng: c.lng })),
                consumption: inp.consumption,
                capacity: inp.capacity,
                arrivePct: inp.arrivePct,
                minLiters: fuelPlan.minLiters,
            };

            const baselineCost = nStops > 0 ? litersToBuy * corridorAvg : 0;
            const stopCtx: StopDataCtx = {
                b, customStops, baseCoords: baseRoute.coords, baseDistanceKm: baseRoute.distanceKm,
                roundTrip: inp.roundTrip, destText: inp.destination.text,
                startLiters: fuelPlan.startLiters, consumption: inp.consumption, corridorAvg,
            };

            // Estrategias a calcular: las tres cuando hay repostajes; solo una si no.
            const priorities: Priority[] = nStops > 0 ? ['cheap', 'balanced', 'fast'] : ['cheap'];
            const endPoint = inp.roundTrip ? a : b;

            // Trazamos la geometría de cada estrategia. Si dos comparten las mismas
            // paradas, reutilizamos la ruta (evita llamadas de red redundantes).
            const routeCache = new Map<string, ReturnType<typeof getRouteMulti>>();
            const routeFor = (ordered: OrderedPoint[]) => {
                if (ordered.length === 0) return Promise.resolve(baseRoute);
                const key = ordered.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
                let pr = routeCache.get(key);
                if (!pr) {
                    pr = getRouteMulti([a, ...ordered.map((p) => ({ lat: p.lat, lng: p.lng })), endPoint], { avoidTolls: inp.avoidTolls });
                    routeCache.set(key, pr);
                }
                return pr;
            };

            const plans: PlanResult[] = await Promise.all(
                priorities.map(async (prio) => {
                    const opt = buildPlan(corridor, nStops, prio, ctx);
                    const { orderedPoints, stopCards } = buildStopData(opt.picks, stopCtx);
                    const routed = (await routeFor(orderedPoints)) ?? baseRoute;
                    return {
                        priority: prio,
                        ...opt,
                        coords: routed.coords,
                        distanceKm: routed.distanceKm,
                        durationMin: routed.durationMin,
                        hasToll: routed.hasToll ?? baseRoute.hasToll,
                        orderedPoints,
                        stopCards,
                        tripFuelCost: fuelPlan.fuelNeeded * (opt.avgPrice || corridorAvg),
                        savings: Math.max(0, baselineCost - opt.cost),
                    };
                })
            );

            setResult({
                origin: a,
                destination: b,
                customStops,
                corridorAvg,
                fuelPlan,
                nStops,
                roundTrip: inp.roundTrip,
                avoidedTolls: inp.avoidTolls,
                baselineCost,
                fuel: inp.fuel,
                plans,
                initialPriority: inp.priority,
            });
            setSelectedPriority(inp.priority);

            // Guardamos la ruta en la URL para poder compartirla/reabrirla en OCTO.
            history.replaceState(null, '', `${location.pathname}?${serializeInputs(inp)}`);
        } catch (err: any) {
            setError(err.message || 'Error al calcular la ruta.');
        } finally {
            setLoading(false);
        }
    };

    // Si la URL trae una ruta (al abrir un enlace compartido), rellenamos el
    // formulario y la calculamos automáticamente una sola vez.
    useEffect(() => {
        if (allStations.length === 0 || autoRan.current) return;
        const inp = parseInputs(window.location.search);
        if (!inp) return;
        autoRan.current = true;
        setOrigin(inp.origin);
        setDestination(inp.destination);
        setWaypoints(inp.waypoints);
        setFuel(inp.fuel);
        setConsumption(inp.consumption);
        setCapacity(inp.capacity);
        setStartPct(inp.startPct);
        setArrivePct(inp.arrivePct);
        setMinLiters(inp.minLiters);
        setPriority(inp.priority);
        setAvoidTolls(inp.avoidTolls);
        setRoundTrip(inp.roundTrip);
        setSelectedBrands(new Set(inp.brands));
        runCalculation(inp);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allStations]);

    // Estrategia activa "aplanada" (datos compartidos + los de la estrategia elegida).
    const active = useMemo<ActiveRoute | null>(() => {
        if (!result) return null;
        const plan = result.plans.find((p) => p.priority === selectedPriority) ?? result.plans[0];
        return {
            origin: result.origin, destination: result.destination, customStops: result.customStops,
            corridorAvg: result.corridorAvg, fuelPlan: result.fuelPlan, nStops: result.nStops,
            roundTrip: result.roundTrip, avoidedTolls: result.avoidedTolls, baselineCost: result.baselineCost,
            fuel: result.fuel,
            coords: plan.coords, distanceKm: plan.distanceKm, durationMin: plan.durationMin, hasToll: plan.hasToll,
            orderedPoints: plan.orderedPoints, stopCards: plan.stopCards,
            recommended: { picks: plan.picks, avgPrice: plan.avgPrice, cost: plan.cost, avgDetour: plan.avgDetour },
            tripFuelCost: plan.tripFuelCost, savings: plan.savings,
        };
    }, [result, selectedPriority]);

    // Todas las geometrías juntas (para encuadrar el mapa con todas las alternativas
    // visibles). Solo cambia al recalcular, no al alternar de estrategia.
    const allRouteCoords = useMemo(() => (result ? result.plans.flatMap((p) => p.coords) : []), [result]);

    return (
        <div className={styles.wrapper}>
            <div className={styles.intro}>
                <a href="/" className={styles.brand} title="Volver al inicio">
                    <img src="/images/logo-octo.webp" alt="OCTO" className={styles.brandLogo} width={540} height={201} />
                </a>
                <h1>Planificador de viajes</h1>
                <p>
                    Indica tu trayecto, tu coche y tu depósito, y calculamos dónde y cuánto repostar
                    para gastar lo menos posible.
                </p>
            </div>

            <form className={styles.form} onSubmit={handleSubmit}>
                <div className={styles.row}>
                    <div className={styles.field}>
                        <label htmlFor="route-origin">Origen</label>
                        <PlaceInput
                            id="route-origin"
                            value={origin}
                            onChange={setOrigin}
                            placeholder="Ciudad, dirección, hotel…"
                            onMapPick={() => setPicking({ kind: 'origin' })}
                        />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="route-destination">Destino</label>
                        <PlaceInput
                            id="route-destination"
                            value={destination}
                            onChange={setDestination}
                            placeholder="Ciudad, dirección, restaurante…"
                            onMapPick={() => setPicking({ kind: 'destination' })}
                        />
                    </div>
                </div>

                <div className={styles.field} role="group" aria-labelledby="route-wp-label">
                    <span className={styles.fieldLabel} id="route-wp-label">Paradas en la ruta (opcional)</span>
                    {waypoints.map((w, i) => (
                        <div key={i} className={styles.wpRow}>
                            <span className="material-symbols-outlined" aria-hidden="true">place</span>
                            <div className={styles.wpInput}>
                                <PlaceInput
                                    value={w}
                                    onChange={(v) => updateWaypoint(i, v)}
                                    placeholder="Restaurante, hotel, pueblo…"
                                    ariaLabel={`Parada ${i + 1}`}
                                    onMapPick={() => setPicking({ kind: 'wp', index: i })}
                                />
                            </div>
                            <button type="button" className={styles.wpRemove} onClick={() => removeWaypoint(i)} title="Quitar parada" aria-label="Quitar parada">
                                <span className="material-symbols-outlined" aria-hidden="true">close</span>
                            </button>
                        </div>
                    ))}
                    <button type="button" className={styles.addWp} onClick={addWaypoint}>
                        <span className="material-symbols-outlined" aria-hidden="true">add</span>
                        Añadir parada
                    </button>
                </div>

                <div className={styles.row}>
                    <div className={styles.field}>
                        <label htmlFor="route-fuel">Combustible</label>
                        <select id="route-fuel" className={styles.select} value={fuel} onChange={(e) => setFuel(e.target.value as FuelType)}>
                            {ROUTE_FUELS.map((f) => (
                                <option key={f} value={f}>{FUEL_LABELS[f]}</option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="route-consumption">Consumo (L/100km)</label>
                        <input
                            id="route-consumption"
                            className={styles.input}
                            type="number"
                            min="2"
                            max="30"
                            step="0.1"
                            value={consumption}
                            onChange={(e) => setConsumption(parseFloat(e.target.value) || 0)}
                        />
                        <div className={styles.presets}>
                            {CONSUMPTION_PRESETS.map((p) => (
                                <button type="button" key={p.label} className={`${styles.preset} ${consumption === p.v ? styles.active : ''}`} onClick={() => setConsumption(p.v)}>
                                    {p.label} · {p.v}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className={styles.field} role="group" aria-labelledby="route-brands-label">
                    <span className={styles.fieldLabel} id="route-brands-label">Repostar solo en estas marcas (opcional)</span>
                    <BrandFilter options={brandOptions} selected={selectedBrands} onChange={setSelectedBrands} />
                </div>

                <div className={styles.row}>
                    <div className={styles.field}>
                        <label htmlFor="route-capacity">Capacidad del depósito (L)</label>
                        <input
                            id="route-capacity"
                            className={styles.input}
                            type="number"
                            min="10"
                            max="200"
                            step="1"
                            value={capacity}
                            onChange={(e) => setCapacity(parseFloat(e.target.value) || 0)}
                        />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="route-startpct">Combustible al salir: {startPct}%</label>
                        <input
                            id="route-startpct"
                            className={styles.range}
                            type="range"
                            min="0"
                            max="100"
                            step="5"
                            value={startPct}
                            onChange={(e) => setStartPct(parseInt(e.target.value, 10))}
                        />
                        <span className={styles.hint}>
                            ≈ {((capacity * startPct) / 100).toFixed(0)} L en el depósito
                        </span>
                    </div>
                </div>

                <div className={styles.field}>
                    <label htmlFor="route-minliters">Litros mínimos en el depósito</label>
                    <input
                        id="route-minliters"
                        className={styles.input}
                        type="number"
                        min="0"
                        max={capacity}
                        step="1"
                        value={minLiters}
                        onChange={(e) => setMinLiters(parseFloat(e.target.value) || 0)}
                    />
                    <span className={styles.hint}>
                        {consumption > 0
                            ? `≈ ${((minLiters / consumption) * 100).toFixed(0)} km de margen — nunca bajaremos de ahí entre repostajes`
                            : 'Nunca bajaremos de ahí entre repostajes'}
                    </span>
                </div>

                <div className={styles.field}>
                    <label htmlFor="route-arrivepct">Quiero llegar con al menos: {arrivePct}%</label>
                    <input
                        id="route-arrivepct"
                        className={styles.range}
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={arrivePct}
                        onChange={(e) => setArrivePct(parseInt(e.target.value, 10))}
                    />
                    <span className={styles.hint}>
                        ≈ {((capacity * arrivePct) / 100).toFixed(0)} L de reserva al llegar al destino
                    </span>
                </div>

                <div className={styles.field}>
                    <span className={styles.fieldLabel} id="route-priority-label">Prioridad</span>
                    <div className={styles.segmented} role="group" aria-labelledby="route-priority-label">
                        {PRIORITIES.map((p) => (
                            <button type="button" key={p.id} className={`${styles.segment} ${priority === p.id ? styles.active : ''}`} onClick={() => setPriority(p.id)}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <span className={styles.hint}>
                        Calculamos automáticamente las paradas de repostaje mínimas necesarias. Para paradas propias (comer, dormir…), usa «Añadir parada» arriba.
                    </span>
                </div>

                <div className={styles.toggleRow}>
                    <label className={styles.toggle}>
                        <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
                        <span className="material-symbols-outlined" aria-hidden="true">sync_alt</span>
                        Ida y vuelta
                    </label>
                    <label className={styles.toggle}>
                        <input type="checkbox" checked={avoidTolls} onChange={(e) => setAvoidTolls(e.target.checked)} />
                        <span className="material-symbols-outlined" aria-hidden="true">toll</span>
                        Evitar peajes
                    </label>
                </div>

                {error && <div className={styles.error}>{error}</div>}

                <button className={styles.submit} type="submit" disabled={loading || allStations.length === 0}>
                    <span className="material-symbols-outlined" aria-hidden="true">route</span>
                    {loading ? 'Calculando…' : 'Calcular ruta'}
                </button>
            </form>

            <div ref={feedbackRef}>
            {loading && (
                <div className={styles.loadingPanel}>
                    <div className={styles.spinner} />
                    <p>Calculando tu ruta y los mejores repostajes…</p>
                </div>
            )}

            {result && active && !loading && (
                <div className={styles.results}>
                    {/* Selector de estrategia: alterna sin recalcular (estilo Google Maps). */}
                    {result.plans.length > 1 && (
                        <div className={styles.planTabs} role="tablist" aria-label="Estrategia de repostaje">
                            {result.plans.map((p) => (
                                <button
                                    key={p.priority}
                                    type="button"
                                    role="tab"
                                    aria-selected={p.priority === selectedPriority}
                                    className={`${styles.planTab} ${p.priority === selectedPriority ? styles.planTabActive : ''}`}
                                    onClick={() => setSelectedPriority(p.priority)}
                                >
                                    <span className={styles.planTabName}>{planFullLabel(p.priority)}</span>
                                    <span className={styles.planTabCost}>{p.cost.toFixed(2)} €</span>
                                    <span className={styles.planTabMeta}>{fmtDuration(p.durationMin)} · {p.distanceKm.toFixed(0)} km</span>
                                </button>
                            ))}
                        </div>
                    )}

                    <div className={styles.statsBar}>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Distancia</span>
                            <span className={styles.statValue}>{active.distanceKm.toFixed(0)} <small>km</small></span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Duración</span>
                            <span className={styles.statValue}>{fmtDuration(active.durationMin)}</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Combustible</span>
                            <span className={styles.statValue}>{active.fuelPlan.fuelNeeded.toFixed(1)} <small>L</small></span>
                        </div>
                        <div className={`${styles.stat} ${styles.tripCost}`}>
                            <span className={styles.statLabel}>Coste del viaje</span>
                            <span className={styles.statValue}>{active.tripFuelCost.toFixed(2)} <small>€</small></span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>{active.nStops > 0 ? 'Coste repostaje' : 'Coste'}</span>
                            <span className={styles.statValue}>{active.recommended.cost.toFixed(2)} <small>€</small></span>
                        </div>
                        <div className={`${styles.stat} ${styles.savings}`}>
                            <span className={styles.statLabel}>Ahorro vs. media</span>
                            <span className={styles.statValue}>{active.savings.toFixed(2)} <small>€</small></span>
                        </div>
                    </div>

                    {/* Aviso de peajes */}
                    {active.hasToll === true && (
                        <div className={styles.tollWarn}>
                            <span className="material-symbols-outlined" aria-hidden="true">toll</span>
                            <span>
                                Esta ruta incluye <b>peajes</b>.
                                {active.avoidedTolls && ' No se han podido evitar todos en este trayecto.'}
                                {' '}El coste de peaje no se incluye en las cifras.
                            </span>
                        </div>
                    )}
                    {active.hasToll === false && active.avoidedTolls && (
                        <div className={styles.tollOk}>
                            <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
                            <span>Ruta <b>sin peajes</b>.</span>
                        </div>
                    )}

                    {/* Análisis del depósito */}
                    <div className={styles.tankBox}>
                        <span className="material-symbols-outlined" aria-hidden="true">local_gas_station</span>
                        <div>
                            {active.fuelPlan.canMakeItNoStops ? (
                                <p>
                                    <b>Llegas sin repostar.</b> Sales con ~{active.fuelPlan.startLiters.toFixed(0)} L
                                    (autonomía ~{active.fuelPlan.startRangeKm.toFixed(0)} km) y el viaje consume{' '}
                                    {active.fuelPlan.fuelNeeded.toFixed(1)} L. Llegarías con ~
                                    {(active.fuelPlan.usableStart - active.fuelPlan.fuelNeeded + active.fuelPlan.reserveLiters).toFixed(0)} L.
                                </p>
                            ) : (
                                <p>
                                    Con tu salida (~{active.fuelPlan.startLiters.toFixed(0)} L) recorres ~
                                    {active.fuelPlan.startRangeKm.toFixed(0)} km. Necesitas{' '}
                                    <b>al menos {active.fuelPlan.minStops} parada{active.fuelPlan.minStops > 1 ? 's' : ''}</b> para
                                    llegar (autonomía con depósito lleno ~{active.fuelPlan.maxRangeKm.toFixed(0)} km).
                                </p>
                            )}
                            {active.fuelPlan.belowMinAtStart && (
                                <p className={styles.warn}>
                                    Sales con ~{active.fuelPlan.startLiters.toFixed(0)} L, ya por debajo de tu
                                    mínimo de {active.fuelPlan.minLiters.toFixed(0)} L. Sube el combustible de
                                    salida o baja el mínimo para respetarlo desde el principio.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className={styles.resultsGrid}>
                        <div>
                            {active.stopCards.length > 0 ? (
                                <>
                                    <h2 className={styles.stopsTitle}>
                                        {active.nStops > 0
                                            ? `Repostajes · ${planFullLabel(selectedPriority)}`
                                            : 'Paradas de tu ruta'}
                                    </h2>
                                    <div className={styles.stopsList}>
                                        {active.stopCards.map((p, i) => {
                                            if (p.type === 'fuel' && p.station) {
                                                const s = p.station;
                                                const delta = s.price - active.corridorAvg;
                                                return (
                                                    <div key={`fuel-${s.id}`} className={styles.stopCard}>
                                                        <div className={styles.stopCardTop}>
                                                            <div className={styles.stopNum}>{i + 1}</div>
                                                            <BrandLogo brand={s.brand} size={34} />
                                                            <div className={styles.stopInfo}>
                                                                <a className={styles.stopName} href={stationUrl(s)} title="Ver ficha de la gasolinera">{s.name}</a>
                                                                <div className={styles.stopMeta}>
                                                                    {displayCity(s.city)} · desvío {s.detourKm.toFixed(1)} km
                                                                </div>
                                                            </div>
                                                            <div className={styles.stopPrice}>
                                                                <b>{s.price.toFixed(3)}</b>
                                                                <span>€/L</span>
                                                                <span className={delta <= 0 ? styles.deltaGood : styles.deltaBad}>
                                                                    {delta <= 0 ? '▼' : '▲'} {Math.abs(delta).toFixed(3)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className={styles.stopStats}>
                                                            <div className={styles.statChip}>
                                                                <span className="material-symbols-outlined" aria-hidden="true">water_drop</span>
                                                                Llegas con <b>{p.arrivalLiters.toFixed(0)} L</b>
                                                            </div>
                                                            <div className={`${styles.statChip} ${styles.statChipAccent}`}>
                                                                <span className="material-symbols-outlined" aria-hidden="true">local_gas_station</span>
                                                                Repostas <b>{s.liters.toFixed(0)} L</b> · {s.cost.toFixed(2)} €
                                                            </div>
                                                            <div className={styles.statChip}>
                                                                <span className="material-symbols-outlined" aria-hidden="true">north_east</span>
                                                                Sales con <b>{p.departureLiters.toFixed(0)} L</b>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return (
                                                <div key={`wp-${i}`} className={styles.stopCard}>
                                                    <div className={styles.stopCardTop}>
                                                        <div className={styles.stopNum}>{i + 1}</div>
                                                        <div className={styles.wpIcon}>
                                                            <span className="material-symbols-outlined" aria-hidden="true">place</span>
                                                        </div>
                                                        <div className={styles.stopInfo}>
                                                            <span className={styles.stopName}>{p.label}</span>
                                                            <div className={styles.stopMeta}>Parada sin repostar</div>
                                                        </div>
                                                    </div>
                                                    <div className={styles.stopStats}>
                                                        <div className={styles.statChip}>
                                                            <span className="material-symbols-outlined" aria-hidden="true">water_drop</span>
                                                            Llegas con <b>{p.arrivalLiters.toFixed(0)} L</b>
                                                        </div>
                                                        <div className={`${styles.statChip} ${styles.statChipAccent}`}>
                                                            <span className="material-symbols-outlined" aria-hidden="true">local_gas_station</span>
                                                            Gasto en gasolina {p.isLastStop ? 'hasta el destino' : 'hasta la siguiente parada'}: <b>{p.legCostToNext?.toFixed(2)} €</b>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : (
                                <div className={styles.noStops}>
                                    <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
                                    <p>Sin paradas en este viaje.</p>
                                </div>
                            )}
                        </div>

                        <div className={styles.mapColumn}>
                        <div className={styles.exportBar}>
                            <a
                                className={styles.icoBtn}
                                href={googleMapsUrl(active)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir en Google Maps" aria-label="Abrir en Google Maps"
                            >
                                <span className={styles.ico} style={{ '--ico': 'url(/icons/googlemaps.svg)', '--icoColor': '#4285F4' } as React.CSSProperties} />
                            </a>
                            <a
                                className={styles.icoBtn}
                                href={appleMapsUrl(active)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir en Apple Maps" aria-label="Abrir en Apple Maps"
                            >
                                <span className={styles.ico} style={{ '--ico': 'url(/icons/apple.svg)', '--icoColor': 'var(--text)' } as React.CSSProperties} />
                            </a>
                            <a
                                className={styles.icoBtn}
                                href={wazeUrl(active)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir en Waze (solo destino final)" aria-label="Abrir en Waze"
                            >
                                <span className={styles.ico} style={{ '--ico': 'url(/icons/waze.svg)', '--icoColor': '#33CCFF' } as React.CSSProperties} />
                            </a>
                            <button
                                type="button"
                                className={styles.icoBtn}
                                onClick={async () => {
                                    setSharing(true);
                                    try {
                                        await shareRoute(active);
                                    } finally {
                                        setSharing(false);
                                    }
                                }}
                                disabled={sharing}
                                title="Compartir ruta" aria-label="Compartir ruta"
                            >
                                <span className={`material-symbols-outlined ${styles.shareIco}`} aria-hidden="true">
                                    {sharing ? 'hourglass_top' : 'ios_share'}
                                </span>
                            </button>
                        </div>
                        <div className={styles.mapBox}>
                            {/* OSM estándar: más calles y topónimos en idioma local que CARTO
                                (útil para reconocer el sitio exacto de cada parada). */}
                            <MapContainer center={[active.origin.lat, active.origin.lng]} zoom={7} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
                                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                <FitBounds coords={allRouteCoords} />
                                {/* Rutas alternativas (grises, por debajo); al pulsarlas se seleccionan. */}
                                {result.plans
                                    .filter((p) => p.priority !== selectedPriority)
                                    .map((p) => (
                                        <Polyline
                                            key={p.priority}
                                            positions={p.coords}
                                            pathOptions={{ color: '#94a3b8', weight: 5, opacity: 0.55 }}
                                            eventHandlers={{ click: () => setSelectedPriority(p.priority) }}
                                        />
                                    ))}
                                {/* Ruta seleccionada (azul, por encima). */}
                                <Polyline positions={active.coords} pathOptions={{ color: '#2563eb', weight: 6, opacity: 0.9 }} />
                                <Marker position={[active.origin.lat, active.origin.lng]} icon={endpointIcon('A', '#0ea5e9')} />
                                <Marker position={[active.destination.lat, active.destination.lng]} icon={endpointIcon('B', '#ef4444')} />
                                {active.customStops.map((c, i) => (
                                    <Marker key={`wp-${i}`} position={[c.lat, c.lng]} icon={endpointIcon('P', '#a855f7')}>
                                        <Popup>Parada: {c.label.split(',')[0]}</Popup>
                                    </Marker>
                                ))}
                                {active.recommended.picks.map((s) => (
                                    <Marker
                                        key={s.id}
                                        position={[s.lat, s.lng]}
                                        icon={stationIcon(s.brand, priceColor(s.price, active.corridorAvg), true)}
                                    >
                                        <Popup className={stationMarkerStyles.popupContent}>
                                            <StationPopup station={s} fuelType={active.fuel} />
                                        </Popup>
                                    </Marker>
                                ))}
                            </MapContainer>
                        </div>
                        </div>
                    </div>

                    {/* Comparativa de estrategias: a todo el ancho, debajo del mapa.
                        Cada fila es clicable para seleccionar esa estrategia. */}
                    {result.plans.length > 1 && (
                        <div className={styles.compare}>
                            <h3>Comparativa de estrategias</h3>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Estrategia</th>
                                        <th>Precio medio</th>
                                        <th>Rango de precio</th>
                                        <th>Gasolineras</th>
                                        <th>Desvío medio</th>
                                        <th>Coste</th>
                                        <th>Ahorro vs. media</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.plans.map((p) => (
                                        <CompareRow
                                            key={p.priority}
                                            label={planFullLabel(p.priority)}
                                            plan={p}
                                            baselineCost={result.baselineCost}
                                            selected={p.priority === selectedPriority}
                                            onSelect={() => setSelectedPriority(p.priority)}
                                        />
                                    ))}
                                    <tr className={styles.baselineRow}>
                                        <td>Repostar a precio medio</td>
                                        <td>{result.corridorAvg.toFixed(3)} €</td>
                                        <td>—</td>
                                        <td>—</td>
                                        <td>—</td>
                                        <td>{result.baselineCost.toFixed(2)} €</td>
                                        <td>—</td>
                                    </tr>
                                </tbody>
                            </table>
                            {(() => {
                                const cheap = result.plans.find((p) => p.priority === 'cheap');
                                const fast = result.plans.find((p) => p.priority === 'fast');
                                if (!cheap || !fast || cheap.cost === fast.cost) return null;
                                return (
                                    <p className={styles.compareNote}>
                                        Optimizando el precio ahorras ~
                                        <b> {(fast.cost - cheap.cost).toFixed(2)} €</b> frente a
                                        parar en la más cómoda, a cambio de ~
                                        {(cheap.avgDetour - fast.avgDetour).toFixed(1)} km más de desvío.
                                    </p>
                                );
                            })()}
                        </div>
                    )}
                </div>
            )}
            </div>

            {/* Elegir un punto exacto en el mapa (origen / destino / parada). */}
            {picking && (() => {
                const current =
                    picking.kind === 'origin' ? origin
                    : picking.kind === 'destination' ? destination
                    : waypoints[picking.index];
                const title =
                    picking.kind === 'origin' ? 'Elegir origen en el mapa'
                    : picking.kind === 'destination' ? 'Elegir destino en el mapa'
                    : `Elegir parada ${picking.index + 1} en el mapa`;
                const apply = (v: PlaceValue) => {
                    if (picking.kind === 'origin') setOrigin(v);
                    else if (picking.kind === 'destination') setDestination(v);
                    else updateWaypoint(picking.index, v);
                };
                return (
                    <MapPicker
                        title={title}
                        initial={current?.lat != null && current?.lng != null ? { lat: current.lat, lng: current.lng } : null}
                        onPick={(g) => {
                            apply({ text: g.label, lat: g.lat, lng: g.lng });
                            setPicking(null);
                        }}
                        onClose={() => setPicking(null)}
                    />
                );
            })()}
        </div>
    );
};

const CompareRow: React.FC<{
    label: string;
    plan: PlanOption;
    baselineCost: number;
    selected?: boolean;
    onSelect?: () => void;
}> = ({ label, plan, baselineCost, selected, onSelect }) => {
    const prices = plan.picks.map((p) => p.price);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const stations = plan.picks.map((p) => p.brand || p.name).join(', ') || '—';
    const savings = baselineCost - plan.cost;
    return (
        <tr
            className={selected ? styles.compareSelected : undefined}
            onClick={onSelect}
            style={onSelect ? { cursor: 'pointer' } : undefined}
        >
            <td>{selected ? '● ' : ''}{label}</td>
            <td>{plan.avgPrice.toFixed(3)} €</td>
            <td>{minPrice === maxPrice ? `${minPrice.toFixed(3)} €` : `${minPrice.toFixed(3)}–${maxPrice.toFixed(3)} €`}</td>
            <td className={styles.compareStations}>{stations}</td>
            <td>{plan.avgDetour.toFixed(1)} km</td>
            <td>{plan.cost.toFixed(2)} €</td>
            <td className={savings >= 0 ? styles.deltaGood : styles.deltaBad}>
                {savings >= 0 ? '+' : ''}{savings.toFixed(2)} €
            </td>
        </tr>
    );
};

export default RoutePlanner;
