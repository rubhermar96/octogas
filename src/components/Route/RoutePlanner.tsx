import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { GasStation, FuelType } from '../../types/gasolinera';
import { MAIN_FUELS, FUEL_LABELS } from '../../lib/fuels';
import {
    geocode,
    getRouteMulti,
    findCorridorStations,
    pickStops,
    computeFuelPlan,
    allocateRefuels,
    progressOnRoute,
    type GeoResult,
    type Priority,
    type FuelPlan,
    type RefuelStop,
} from '../../lib/route';
import BrandLogo from '../Explorer/BrandLogo';
import BrandFilter, { type BrandOption } from '../Explorer/BrandFilter';
import styles from './RoutePlanner.module.css';

const ROUTE_FUELS: FuelType[] = [...MAIN_FUELS, 'glp'];

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

type StopsMode = 'auto' | '0' | '1' | '2' | '3';

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

interface RouteData {
    coords: [number, number][];
    distanceKm: number;
    durationMin: number;
    origin: { lat: number; lng: number; label: string };
    destination: { lat: number; lng: number; label: string };
    customStops: GeoResult[];
    orderedPoints: { lat: number; lng: number; label: string; type: 'wp' | 'fuel' }[];
    corridorAvg: number;
    fuelPlan: FuelPlan;
    nStops: number;
    hasToll?: boolean;
    avoidedTolls: boolean;
    recommended: PlanOption;
    tripFuelCost: number;
    baselineCost: number;
    savings: number;
    cheapPlan: PlanOption | null;
    fastPlan: PlanOption | null;
    fuel: FuelType;
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
    origin: string;
    destination: string;
    waypoints: string[];
    fuel: FuelType;
    consumption: number;
    capacity: number;
    startPct: number;
    arrivePct: number;
    priority: Priority;
    stopsMode: StopsMode;
    avoidTolls: boolean;
    brands: string[];
}

function serializeInputs(v: RouteInputs): string {
    const p = new URLSearchParams();
    p.set('o', v.origin);
    p.set('d', v.destination);
    if (v.waypoints.length) p.set('w', v.waypoints.join('~'));
    p.set('f', v.fuel);
    p.set('c', String(v.consumption));
    p.set('cap', String(v.capacity));
    p.set('s', String(v.startPct));
    p.set('a', String(v.arrivePct));
    p.set('p', v.priority);
    p.set('st', v.stopsMode);
    if (v.avoidTolls) p.set('t', '1');
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
        origin: o,
        destination: d,
        waypoints: p.get('w') ? p.get('w')!.split('~') : [],
        fuel: (p.get('f') as FuelType) || 'sp95',
        consumption: num('c', 6.5),
        capacity: num('cap', 50),
        startPct: num('s', 80),
        arrivePct: num('a', 15),
        priority: (p.get('p') as Priority) || 'cheap',
        stopsMode: (p.get('st') as StopsMode) || 'auto',
        avoidTolls: p.get('t') === '1',
        brands: p.get('b') ? p.get('b')!.split('~') : [],
    };
}

/** Enlace de Google Maps con las paradas (repostajes incluidos) como waypoints. */
function googleMapsUrl(r: RouteData): string {
    const base =
        `https://www.google.com/maps/dir/?api=1` +
        `&origin=${r.origin.lat},${r.origin.lng}` +
        `&destination=${r.destination.lat},${r.destination.lng}` +
        `&travelmode=driving`;
    const wp = r.orderedPoints.map((p) => `${p.lat},${p.lng}`).join('|');
    return wp ? `${base}&waypoints=${encodeURIComponent(wp)}` : base;
}

/** Apple Maps: encadena las paradas con "to:" (compatibilidad variable). */
function appleMapsUrl(r: RouteData): string {
    const dests = [...r.orderedPoints.map((p) => `${p.lat},${p.lng}`), `${r.destination.lat},${r.destination.lng}`];
    return `https://maps.apple.com/?saddr=${r.origin.lat},${r.origin.lng}&daddr=${encodeURIComponent(dests.join(' to:'))}&dirflg=d`;
}

/** Waze solo admite un destino: navegamos al destino final. */
function wazeUrl(r: RouteData): string {
    return `https://www.waze.com/ul?ll=${r.destination.lat},${r.destination.lng}&navigate=yes`;
}

/** Texto resumen para compartir (WhatsApp, etc.), con enlace para reabrir en OCTO. */
function buildShareText(r: RouteData): string {
    const lines: string[] = [];
    lines.push(`🚗 Ruta OCTO: ${r.origin.label.split(',')[0]} → ${r.destination.label.split(',')[0]}`);
    lines.push(
        `📏 ${r.distanceKm.toFixed(0)} km · ⏱️ ${fmtDuration(r.durationMin)} · ⛽ ${r.fuelPlan.fuelNeeded.toFixed(0)} L (~${r.tripFuelCost.toFixed(2)} €)`
    );
    if (r.hasToll) lines.push('⚠️ Incluye peajes');
    if (r.recommended.picks.length > 0) {
        lines.push('', 'Repostajes recomendados:');
        r.recommended.picks.forEach((s, i) => {
            lines.push(
                `${i + 1}. ${s.name} (${s.city}) — ${s.price.toFixed(3)} €/L · repostar ${s.liters.toFixed(0)} L (${s.cost.toFixed(2)} €)`
            );
        });
    }
    lines.push('', `🐙 Abrir en OCTO: ${typeof window !== 'undefined' ? window.location.href : ''}`);
    lines.push(`🗺️ Google Maps: ${googleMapsUrl(r)}`);
    return lines.join('\n');
}

async function shareRoute(r: RouteData) {
    const text = buildShareText(r);
    const url = typeof window !== 'undefined' ? window.location.href : undefined;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
        try {
            await nav.share({ title: 'Ruta OCTO', text, url });
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
    waypoints: { lat: number; lng: number }[];
    consumption: number;
    capacity: number;
    arrivePct: number;
}

function buildPlan(
    corridor: ReturnType<typeof findCorridorStations>,
    n: number,
    prio: Priority,
    ctx: PlanCtx
): PlanOption {
    const raw = pickStops(corridor, n, prio, ctx.waypoints);
    const picks = allocateRefuels(raw, {
        totalDistanceKm: ctx.totalDistanceKm,
        consumption: ctx.consumption,
        capacity: ctx.capacity,
        startLiters: ctx.startLiters,
        arrivePct: ctx.arrivePct,
    });
    const avgPrice = picks.length ? picks.reduce((s, x) => s + x.price, 0) / picks.length : 0;
    const avgDetour = picks.length ? picks.reduce((s, x) => s + x.detourKm, 0) / picks.length : 0;
    const cost = picks.reduce((s, x) => s + x.cost, 0);
    return { picks, avgPrice, cost, avgDetour };
}

const RoutePlanner: React.FC = () => {
    const [allStations, setAllStations] = useState<GasStation[]>([]);
    const [origin, setOrigin] = useState('');
    const [destination, setDestination] = useState('');
    const [waypoints, setWaypoints] = useState<string[]>([]);
    const [fuel, setFuel] = useState<FuelType>('sp95');
    const [consumption, setConsumption] = useState(6.5);
    const [capacity, setCapacity] = useState(50);
    const [startPct, setStartPct] = useState(80);
    const [arrivePct, setArrivePct] = useState(15);
    const [priority, setPriority] = useState<Priority>('cheap');
    const [stopsMode, setStopsMode] = useState<StopsMode>('auto');
    const [avoidTolls, setAvoidTolls] = useState(false);
    const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<RouteData | null>(null);
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

    const addWaypoint = () => setWaypoints((w) => [...w, '']);
    const removeWaypoint = (i: number) => setWaypoints((w) => w.filter((_, idx) => idx !== i));
    const updateWaypoint = (i: number, val: string) =>
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
        priority,
        stopsMode,
        avoidTolls,
        brands: [...selectedBrands],
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        runCalculation(currentInputs());
    };

    const runCalculation = async (inp: RouteInputs) => {
        setError(null);
        if (!inp.origin.trim() || !inp.destination.trim()) {
            setError('Indica origen y destino.');
            return;
        }
        setLoading(true);
        setResult(null);
        try {
            // Geocodificamos origen, destino y las paradas propias (las que no estén vacías).
            const wpQueries = inp.waypoints.map((w) => w.trim()).filter(Boolean);
            const [a, b, ...wpGeo] = await Promise.all([
                geocode(inp.origin),
                geocode(inp.destination),
                ...wpQueries.map((q) => geocode(q)),
            ]);
            if (!a) throw new Error(`No se encontró el origen "${inp.origin}".`);
            if (!b) throw new Error(`No se encontró el destino "${inp.destination}".`);
            const customStops = wpGeo.filter((g): g is GeoResult => g != null);
            if (wpGeo.length !== customStops.length) {
                throw new Error('No se encontró alguna de las paradas indicadas.');
            }

            // Ruta base: pasa por tus paradas propias (p. ej. donde vas a comer).
            const baseRoute = await getRouteMulti([a, ...customStops, b], { avoidTolls: inp.avoidTolls });
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
                reservePct: inp.arrivePct, // queremos llegar con esta reserva
            });

            const nStops = inp.stopsMode === 'auto' ? fuelPlan.minStops : parseInt(inp.stopsMode, 10);
            const litersToBuy = fuelPlan.litersToBuy;
            const ctx = {
                totalDistanceKm: baseRoute.distanceKm,
                startLiters: fuelPlan.startLiters,
                waypoints: customStops.map((c) => ({ lat: c.lat, lng: c.lng })),
                consumption: inp.consumption,
                capacity: inp.capacity,
                arrivePct: inp.arrivePct,
            };

            const recommended = buildPlan(corridor, nStops, inp.priority, ctx);
            const baselineCost = nStops > 0 ? litersToBuy * corridorAvg : 0;
            const savings = Math.max(0, baselineCost - recommended.cost);
            // Coste de combustible de TODO el viaje (litros consumidos × precio representativo).
            const repPrice = recommended.avgPrice || corridorAvg;
            const tripFuelCost = fuelPlan.fuelNeeded * repPrice;

            const cheapPlan = nStops > 0 ? buildPlan(corridor, nStops, 'cheap', ctx) : null;
            const fastPlan = nStops > 0 ? buildPlan(corridor, nStops, 'fast', ctx) : null;

            // Puntos intermedios ordenados (paradas tuyas + repostajes) a lo largo de la ruta.
            const orderedPoints = [
                ...customStops.map((c) => ({
                    lat: c.lat,
                    lng: c.lng,
                    label: c.label.split(",")[0],
                    type: "wp" as const,
                    progress: progressOnRoute(baseRoute.coords, c.lat, c.lng),
                })),
                ...recommended.picks.map((s) => ({
                    lat: s.lat,
                    lng: s.lng,
                    label: s.name,
                    type: "fuel" as const,
                    progress: s.progress,
                })),
            ].sort((x, y) => x.progress - y.progress);

            // Ruta final: pasa también por los repostajes recomendados.
            let finalRoute = baseRoute;
            if (orderedPoints.length > 0) {
                const routed = await getRouteMulti(
                    [a, ...orderedPoints.map((p) => ({ lat: p.lat, lng: p.lng })), b],
                    { avoidTolls: inp.avoidTolls }
                );
                if (routed) finalRoute = routed;
            }

            setResult({
                coords: finalRoute.coords,
                distanceKm: finalRoute.distanceKm,
                durationMin: finalRoute.durationMin,
                origin: a,
                destination: b,
                customStops,
                orderedPoints: orderedPoints.map(({ lat, lng, label, type }) => ({ lat, lng, label, type })),
                corridorAvg,
                fuelPlan,
                nStops,
                hasToll: finalRoute.hasToll ?? baseRoute.hasToll,
                avoidedTolls: inp.avoidTolls,
                recommended,
                tripFuelCost,
                baselineCost,
                savings,
                cheapPlan,
                fastPlan,
                fuel: inp.fuel,
            });

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
        setPriority(inp.priority);
        setStopsMode(inp.stopsMode);
        setAvoidTolls(inp.avoidTolls);
        setSelectedBrands(new Set(inp.brands));
        runCalculation(inp);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allStations]);

    return (
        <div className={styles.wrapper}>
            <div className={styles.intro}>
                <a href="/" className={styles.brand} title="Volver al inicio">
                    <img src="/images/logo-octo.png" alt="OCTO" className={styles.brandLogo} />
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
                        <label>Origen</label>
                        <input className={styles.input} placeholder="Ej. Madrid" value={origin} onChange={(e) => setOrigin(e.target.value)} />
                    </div>
                    <div className={styles.field}>
                        <label>Destino</label>
                        <input className={styles.input} placeholder="Ej. Valencia" value={destination} onChange={(e) => setDestination(e.target.value)} />
                    </div>
                </div>

                <div className={styles.field}>
                    <label>Paradas en la ruta (opcional)</label>
                    {waypoints.map((w, i) => (
                        <div key={i} className={styles.wpRow}>
                            <span className="material-symbols-outlined">place</span>
                            <input
                                className={styles.input}
                                placeholder="Ej. Cuenca (parada para comer)"
                                value={w}
                                onChange={(e) => updateWaypoint(i, e.target.value)}
                            />
                            <button type="button" className={styles.wpRemove} onClick={() => removeWaypoint(i)} title="Quitar parada">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                    ))}
                    <button type="button" className={styles.addWp} onClick={addWaypoint}>
                        <span className="material-symbols-outlined">add</span>
                        Añadir parada
                    </button>
                </div>

                <div className={styles.row}>
                    <div className={styles.field}>
                        <label>Combustible</label>
                        <select className={styles.select} value={fuel} onChange={(e) => setFuel(e.target.value as FuelType)}>
                            {ROUTE_FUELS.map((f) => (
                                <option key={f} value={f}>{FUEL_LABELS[f]}</option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.field}>
                        <label>Consumo (L/100km)</label>
                        <input
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

                <div className={styles.field}>
                    <label>Repostar solo en estas marcas (opcional)</label>
                    <BrandFilter options={brandOptions} selected={selectedBrands} onChange={setSelectedBrands} />
                </div>

                <div className={styles.row}>
                    <div className={styles.field}>
                        <label>Capacidad del depósito (L)</label>
                        <input
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
                        <label>Combustible al salir: {startPct}%</label>
                        <input
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
                    <label>Quiero llegar con al menos: {arrivePct}%</label>
                    <input
                        className={styles.range}
                        type="range"
                        min="0"
                        max="50"
                        step="5"
                        value={arrivePct}
                        onChange={(e) => setArrivePct(parseInt(e.target.value, 10))}
                    />
                    <span className={styles.hint}>
                        ≈ {((capacity * arrivePct) / 100).toFixed(0)} L de reserva al llegar al destino
                    </span>
                </div>

                <div className={styles.row}>
                    <div className={styles.field}>
                        <label>Prioridad</label>
                        <div className={styles.segmented}>
                            {PRIORITIES.map((p) => (
                                <button type="button" key={p.id} className={`${styles.segment} ${priority === p.id ? styles.active : ''}`} onClick={() => setPriority(p.id)}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className={styles.field}>
                        <label>Paradas para repostar</label>
                        <div className={styles.segmented}>
                            {([['auto', 'Auto'], ['0', 'Sin paradas'], ['1', '1'], ['2', '2'], ['3', '3']] as [StopsMode, string][]).map(
                                ([val, lbl]) => (
                                    <button type="button" key={val} className={`${styles.segment} ${stopsMode === val ? styles.active : ''}`} onClick={() => setStopsMode(val)}>
                                        {lbl}
                                    </button>
                                )
                            )}
                        </div>
                    </div>
                </div>

                <label className={styles.toggle}>
                    <input type="checkbox" checked={avoidTolls} onChange={(e) => setAvoidTolls(e.target.checked)} />
                    <span className="material-symbols-outlined">toll</span>
                    Evitar peajes
                </label>

                {error && <div className={styles.error}>{error}</div>}

                <button className={styles.submit} type="submit" disabled={loading || allStations.length === 0}>
                    <span className="material-symbols-outlined">route</span>
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

            {result && !loading && (
                <div className={styles.results}>
                    <div className={styles.statsBar}>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Distancia</span>
                            <span className={styles.statValue}>{result.distanceKm.toFixed(0)} <small>km</small></span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Duración</span>
                            <span className={styles.statValue}>{fmtDuration(result.durationMin)}</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Combustible</span>
                            <span className={styles.statValue}>{result.fuelPlan.fuelNeeded.toFixed(1)} <small>L</small></span>
                        </div>
                        <div className={`${styles.stat} ${styles.tripCost}`}>
                            <span className={styles.statLabel}>Coste del viaje</span>
                            <span className={styles.statValue}>{result.tripFuelCost.toFixed(2)} <small>€</small></span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>{result.nStops > 0 ? 'Coste repostaje' : 'Coste'}</span>
                            <span className={styles.statValue}>{result.recommended.cost.toFixed(2)} <small>€</small></span>
                        </div>
                        <div className={`${styles.stat} ${styles.savings}`}>
                            <span className={styles.statLabel}>Ahorro vs. media</span>
                            <span className={styles.statValue}>{result.savings.toFixed(2)} <small>€</small></span>
                        </div>
                    </div>

                    {/* Aviso de peajes */}
                    {result.hasToll === true && (
                        <div className={styles.tollWarn}>
                            <span className="material-symbols-outlined">toll</span>
                            <span>
                                Esta ruta incluye <b>peajes</b>.
                                {result.avoidedTolls && ' No se han podido evitar todos en este trayecto.'}
                                {' '}El coste de peaje no se incluye en las cifras.
                            </span>
                        </div>
                    )}
                    {result.hasToll === false && result.avoidedTolls && (
                        <div className={styles.tollOk}>
                            <span className="material-symbols-outlined">check_circle</span>
                            <span>Ruta <b>sin peajes</b>.</span>
                        </div>
                    )}

                    {/* Análisis del depósito */}
                    <div className={styles.tankBox}>
                        <span className="material-symbols-outlined">local_gas_station</span>
                        <div>
                            {result.fuelPlan.canMakeItNoStops ? (
                                <p>
                                    <b>Llegas sin repostar.</b> Sales con ~{result.fuelPlan.startLiters.toFixed(0)} L
                                    (autonomía ~{result.fuelPlan.startRangeKm.toFixed(0)} km) y el viaje consume{' '}
                                    {result.fuelPlan.fuelNeeded.toFixed(1)} L. Llegarías con ~
                                    {(result.fuelPlan.usableStart - result.fuelPlan.fuelNeeded + result.fuelPlan.reserveLiters).toFixed(0)} L.
                                </p>
                            ) : (
                                <p>
                                    Con tu salida (~{result.fuelPlan.startLiters.toFixed(0)} L) recorres ~
                                    {result.fuelPlan.startRangeKm.toFixed(0)} km. Necesitas{' '}
                                    <b>al menos {result.fuelPlan.minStops} parada{result.fuelPlan.minStops > 1 ? 's' : ''}</b> para
                                    llegar (autonomía con depósito lleno ~{result.fuelPlan.maxRangeKm.toFixed(0)} km).
                                    {result.nStops === 0 && (
                                        <span className={styles.warn}>
                                            {' '}Has elegido <b>sin paradas</b>: te quedarías sin combustible a ~
                                            {Math.max(0, result.distanceKm - result.fuelPlan.startRangeKm).toFixed(0)} km del destino.
                                        </span>
                                    )}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className={styles.resultsGrid}>
                        <div>
                            {result.nStops > 0 ? (
                                <>
                                    <h2 className={styles.stopsTitle}>
                                        Repostajes recomendados · {priorityLabel(priority)}
                                    </h2>
                                    <div className={styles.stopsList}>
                                        {result.recommended.picks.map((s, i) => {
                                            const delta = s.price - result.corridorAvg;
                                            return (
                                                <div key={s.id} className={styles.stopCard}>
                                                    <div className={styles.stopNum}>{i + 1}</div>
                                                    <BrandLogo brand={s.brand} size={34} />
                                                    <div className={styles.stopInfo}>
                                                        <div className={styles.stopName}>{s.name}</div>
                                                        <div className={styles.stopMeta}>
                                                            {s.city} · desvío {s.detourKm.toFixed(1)} km
                                                        </div>
                                                        <div className={styles.stopRefuel}>
                                                            <span className="material-symbols-outlined">local_gas_station</span>
                                                            Repostar <b>{s.liters.toFixed(0)} L</b> · {s.cost.toFixed(2)} €
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
                                            );
                                        })}
                                    </div>

                                    {/* Comparativa de estrategias */}
                                    {result.cheapPlan && result.fastPlan && (
                                        <div className={styles.compare}>
                                            <h3>Comparativa de estrategias</h3>
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th>Estrategia</th>
                                                        <th>Precio medio</th>
                                                        <th>Desvío medio</th>
                                                        <th>Coste</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <CompareRow label="Más barato" plan={result.cheapPlan} />
                                                    <CompareRow label="Más rápido" plan={result.fastPlan} />
                                                    <tr className={styles.baselineRow}>
                                                        <td>Repostar a precio medio</td>
                                                        <td>{result.corridorAvg.toFixed(3)} €</td>
                                                        <td>—</td>
                                                        <td>{result.baselineCost.toFixed(2)} €</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                            <p className={styles.compareNote}>
                                                Optimizando el precio ahorras ~
                                                <b> {(result.fastPlan.cost - result.cheapPlan.cost).toFixed(2)} €</b> frente a
                                                parar en la más cómoda, a cambio de ~
                                                {(result.cheapPlan.avgDetour - result.fastPlan.avgDetour).toFixed(1)} km más de desvío.
                                            </p>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className={styles.noStops}>
                                    <span className="material-symbols-outlined">check_circle</span>
                                    <p>Sin paradas de repostaje en este viaje.</p>
                                </div>
                            )}
                        </div>

                        <div className={styles.mapColumn}>
                        <div className={styles.exportBar}>
                            <a
                                className={styles.icoBtn}
                                href={googleMapsUrl(result)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir en Google Maps"
                            >
                                <span className={styles.ico} style={{ '--ico': 'url(/icons/googlemaps.svg)', '--icoColor': '#4285F4' } as React.CSSProperties} />
                            </a>
                            <a
                                className={styles.icoBtn}
                                href={appleMapsUrl(result)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir en Apple Maps"
                            >
                                <span className={styles.ico} style={{ '--ico': 'url(/icons/apple.svg)', '--icoColor': 'var(--text)' } as React.CSSProperties} />
                            </a>
                            <a
                                className={styles.icoBtn}
                                href={wazeUrl(result)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir en Waze (solo destino final)"
                            >
                                <span className={styles.ico} style={{ '--ico': 'url(/icons/waze.svg)', '--icoColor': '#33CCFF' } as React.CSSProperties} />
                            </a>
                            <button
                                type="button"
                                className={styles.icoBtn}
                                onClick={() => shareRoute(result)}
                                title="Compartir ruta"
                            >
                                <span className={`material-symbols-outlined ${styles.shareIco}`}>ios_share</span>
                            </button>
                        </div>
                        <div className={styles.mapBox}>
                            <MapContainer center={[result.origin.lat, result.origin.lng]} zoom={7} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
                                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
                                <FitBounds coords={result.coords} />
                                <Polyline positions={result.coords} pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.8 }} />
                                <Marker position={[result.origin.lat, result.origin.lng]} icon={endpointIcon('A', '#0ea5e9')} />
                                <Marker position={[result.destination.lat, result.destination.lng]} icon={endpointIcon('B', '#ef4444')} />
                                {result.customStops.map((c, i) => (
                                    <Marker key={`wp-${i}`} position={[c.lat, c.lng]} icon={endpointIcon('P', '#a855f7')}>
                                        <Popup>Parada: {c.label.split(',')[0]}</Popup>
                                    </Marker>
                                ))}
                                {result.recommended.picks.map((s) => (
                                    <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#34d399', fillOpacity: 1 }}>
                                        <Popup>
                                            <strong>{s.name}</strong>
                                            <br />
                                            {s.price.toFixed(3)} €/L · {FUEL_LABELS[result.fuel]}
                                            <br />
                                            Repostar {s.liters.toFixed(0)} L · {s.cost.toFixed(2)} €
                                        </Popup>
                                    </CircleMarker>
                                ))}
                            </MapContainer>
                        </div>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    );
};

function priorityLabel(p: Priority): string {
    return p === 'cheap' ? 'más barato' : p === 'fast' ? 'más rápido' : 'equilibrado';
}

const CompareRow: React.FC<{ label: string; plan: PlanOption }> = ({ label, plan }) => (
    <tr>
        <td>{label}</td>
        <td>{plan.avgPrice.toFixed(3)} €</td>
        <td>{plan.avgDetour.toFixed(1)} km</td>
        <td>{plan.cost.toFixed(2)} €</td>
    </tr>
);

export default RoutePlanner;
