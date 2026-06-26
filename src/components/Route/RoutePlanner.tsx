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
    progressOnRoute,
    type GeoResult,
    type CorridorStation,
    type Priority,
    type FuelPlan,
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
    picks: CorridorStation[];
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
    corridorAvg: number;
    fuelPlan: FuelPlan;
    nStops: number;
    recommended: PlanOption;
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

const RoutePlanner: React.FC = () => {
    const [allStations, setAllStations] = useState<GasStation[]>([]);
    const [origin, setOrigin] = useState('');
    const [destination, setDestination] = useState('');
    const [waypoints, setWaypoints] = useState<string[]>([]);
    const [fuel, setFuel] = useState<FuelType>('sp95');
    const [consumption, setConsumption] = useState(6.5);
    const [capacity, setCapacity] = useState(50);
    const [startPct, setStartPct] = useState(80);
    const [priority, setPriority] = useState<Priority>('cheap');
    const [stopsMode, setStopsMode] = useState<StopsMode>('auto');
    const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<RouteData | null>(null);
    const feedbackRef = useRef<HTMLDivElement>(null);

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

    const buildPlan = (
        corridor: CorridorStation[],
        n: number,
        prio: Priority,
        litersToBuy: number
    ): PlanOption => {
        const picks = pickStops(corridor, n, prio);
        const avgPrice = picks.length ? picks.reduce((s, x) => s + x.price, 0) / picks.length : 0;
        const avgDetour = picks.length ? picks.reduce((s, x) => s + x.detourKm, 0) / picks.length : 0;
        const cost = n > 0 && picks.length ? litersToBuy * avgPrice : 0;
        return { picks, avgPrice, cost, avgDetour };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!origin.trim() || !destination.trim()) {
            setError('Indica origen y destino.');
            return;
        }
        setLoading(true);
        setResult(null);
        try {
            // Geocodificamos origen, destino y las paradas propias (las que no estén vacías).
            const wpQueries = waypoints.map((w) => w.trim()).filter(Boolean);
            const [a, b, ...wpGeo] = await Promise.all([
                geocode(origin),
                geocode(destination),
                ...wpQueries.map((q) => geocode(q)),
            ]);
            if (!a) throw new Error(`No se encontró el origen "${origin}".`);
            if (!b) throw new Error(`No se encontró el destino "${destination}".`);
            const customStops = wpGeo.filter((g): g is GeoResult => g != null);
            if (wpGeo.length !== customStops.length) {
                throw new Error('No se encontró alguna de las paradas indicadas.');
            }

            // Ruta base: pasa por tus paradas propias (p. ej. donde vas a comer).
            const baseRoute = await getRouteMulti([a, ...customStops, b]);
            if (!baseRoute) throw new Error('No se pudo calcular la ruta entre esos puntos.');

            const corridorRaw = findCorridorStations(allStations, baseRoute.coords, fuel);
            if (corridorRaw.length === 0) {
                throw new Error('No hay gasolineras con ese combustible cerca de la ruta.');
            }
            // Si has elegido marcas, solo repostamos en ellas.
            const corridor = selectedBrands.size
                ? corridorRaw.filter((s) => selectedBrands.has(s.brand))
                : corridorRaw;
            if (corridor.length === 0) {
                throw new Error(
                    'No hay gasolineras de las marcas elegidas cerca de la ruta. Prueba a quitar el filtro de marcas.'
                );
            }
            const corridorAvg = corridor.reduce((s, x) => s + x.price, 0) / corridor.length;

            const fuelPlan = computeFuelPlan({
                distanceKm: baseRoute.distanceKm,
                consumption,
                capacity,
                startPct,
            });

            const nStops = stopsMode === 'auto' ? fuelPlan.minStops : parseInt(stopsMode, 10);
            const litersToBuy = fuelPlan.litersToBuy;

            const recommended = buildPlan(corridor, nStops, priority, litersToBuy);
            const baselineCost = nStops > 0 ? litersToBuy * corridorAvg : 0;
            const savings = Math.max(0, baselineCost - recommended.cost);

            const cheapPlan = nStops > 0 ? buildPlan(corridor, nStops, 'cheap', litersToBuy) : null;
            const fastPlan = nStops > 0 ? buildPlan(corridor, nStops, 'fast', litersToBuy) : null;

            // Ruta final: pasa también por los repostajes recomendados (en orden a lo largo del trayecto).
            let finalRoute = baseRoute;
            if (recommended.picks.length > 0) {
                const intermediates = [
                    ...customStops.map((c) => ({
                        lat: c.lat,
                        lng: c.lng,
                        progress: progressOnRoute(baseRoute.coords, c.lat, c.lng),
                    })),
                    ...recommended.picks.map((s) => ({ lat: s.lat, lng: s.lng, progress: s.progress })),
                ].sort((x, y) => x.progress - y.progress);
                const routed = await getRouteMulti([a, ...intermediates, b]);
                if (routed) finalRoute = routed;
            }

            setResult({
                coords: finalRoute.coords,
                distanceKm: finalRoute.distanceKm,
                durationMin: finalRoute.durationMin,
                origin: a,
                destination: b,
                customStops,
                corridorAvg,
                fuelPlan,
                nStops,
                recommended,
                baselineCost,
                savings,
                cheapPlan,
                fastPlan,
                fuel,
            });
        } catch (err: any) {
            setError(err.message || 'Error al calcular la ruta.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.wrapper}>
            <div className={styles.intro}>
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
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>{result.nStops > 0 ? 'Coste repostaje' : 'Coste'}</span>
                            <span className={styles.statValue}>{result.recommended.cost.toFixed(2)} <small>€</small></span>
                        </div>
                        <div className={`${styles.stat} ${styles.savings}`}>
                            <span className={styles.statLabel}>Ahorro vs. media</span>
                            <span className={styles.statValue}>{result.savings.toFixed(2)} <small>€</small></span>
                        </div>
                    </div>

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
                                                    </div>
                                                    <div className={styles.stopPrice}>
                                                        <b>{s.price.toFixed(3)}</b>
                                                        <span className={delta <= 0 ? styles.deltaGood : styles.deltaBad}>
                                                            {delta <= 0 ? '▼' : '▲'} {Math.abs(delta).toFixed(3)} vs media
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
                                        </Popup>
                                    </CircleMarker>
                                ))}
                            </MapContainer>
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
