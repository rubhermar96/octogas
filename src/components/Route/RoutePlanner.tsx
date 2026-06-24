import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { GasStation, FuelType } from '../../types/gasolinera';
import { MAIN_FUELS, FUEL_LABELS } from '../../lib/fuels';
import {
    geocode,
    getRoute,
    findCorridorStations,
    pickStops,
    type CorridorStation,
    type Priority,
} from '../../lib/route';
import BrandLogo from '../Explorer/BrandLogo';
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

const endpointIcon = (letter: string, color: string) =>
    L.divIcon({
        className: 'octo-route-endpoint',
        html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"><span style="transform:rotate(45deg);font-weight:800;font-size:13px">${letter}</span></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26],
    });

interface RouteData {
    coords: [number, number][];
    distanceKm: number;
    durationMin: number;
    origin: { lat: number; lng: number; label: string };
    destination: { lat: number; lng: number; label: string };
    stops: CorridorStation[];
    corridor: CorridorStation[];
    fuelNeeded: number;
    estimatedCost: number;
    savings: number;
    corridorAvg: number;
    fuel: FuelType;
}

const FitBounds: React.FC<{ coords: [number, number][] }> = ({ coords }) => {
    const map = useMap();
    useEffect(() => {
        if (coords.length) {
            map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
        }
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
    const [fuel, setFuel] = useState<FuelType>('sp95');
    const [consumption, setConsumption] = useState(6.5);
    const [priority, setPriority] = useState<Priority>('cheap');
    const [stops, setStops] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<RouteData | null>(null);

    useEffect(() => {
        fetch('/data/stations.json')
            .then((r) => r.json())
            .then(setAllStations)
            .catch(() => setAllStations([]));
    }, []);

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
            const [a, b] = await Promise.all([geocode(origin), geocode(destination)]);
            if (!a) throw new Error(`No se encontró el origen "${origin}".`);
            if (!b) throw new Error(`No se encontró el destino "${destination}".`);

            const route = await getRoute(a, b);
            if (!route) throw new Error('No se pudo calcular la ruta entre esos puntos.');

            const corridor = findCorridorStations(allStations, route.coords, fuel);
            if (corridor.length === 0) {
                throw new Error('No hay gasolineras con ese combustible cerca de la ruta.');
            }
            const picked = pickStops(corridor, stops, priority);

            const fuelNeeded = (route.distanceKm * consumption) / 100;
            const pickedAvg = picked.reduce((s, x) => s + x.price, 0) / picked.length;
            const corridorAvg = corridor.reduce((s, x) => s + x.price, 0) / corridor.length;
            const estimatedCost = fuelNeeded * pickedAvg;
            const savings = Math.max(0, (corridorAvg - pickedAvg) * fuelNeeded);

            setResult({
                coords: route.coords,
                distanceKm: route.distanceKm,
                durationMin: route.durationMin,
                origin: a,
                destination: b,
                stops: picked,
                corridor,
                fuelNeeded,
                estimatedCost,
                savings,
                corridorAvg,
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
                    Indica tu origen y destino, tu coche y consumo, y te decimos dónde repostar por
                    el camino para gastar lo menos posible.
                </p>
            </div>

            <form className={styles.form} onSubmit={handleSubmit}>
                <div className={styles.row}>
                    <div className={styles.field}>
                        <label>Origen</label>
                        <input
                            className={styles.input}
                            placeholder="Ej. Madrid"
                            value={origin}
                            onChange={(e) => setOrigin(e.target.value)}
                        />
                    </div>
                    <div className={styles.field}>
                        <label>Destino</label>
                        <input
                            className={styles.input}
                            placeholder="Ej. Valencia"
                            value={destination}
                            onChange={(e) => setDestination(e.target.value)}
                        />
                    </div>
                </div>

                <div className={styles.row}>
                    <div className={styles.field}>
                        <label>Combustible</label>
                        <select
                            className={styles.select}
                            value={fuel}
                            onChange={(e) => setFuel(e.target.value as FuelType)}
                        >
                            {ROUTE_FUELS.map((f) => (
                                <option key={f} value={f}>
                                    {FUEL_LABELS[f]}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.field}>
                        <label>Consumo: {consumption.toFixed(1)} L/100km</label>
                        <div className={styles.presets}>
                            {CONSUMPTION_PRESETS.map((p) => (
                                <button
                                    type="button"
                                    key={p.label}
                                    className={`${styles.preset} ${consumption === p.v ? styles.active : ''}`}
                                    onClick={() => setConsumption(p.v)}
                                >
                                    {p.label} · {p.v}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className={styles.row}>
                    <div className={styles.field}>
                        <label>Prioridad</label>
                        <div className={styles.segmented}>
                            {PRIORITIES.map((p) => (
                                <button
                                    type="button"
                                    key={p.id}
                                    className={`${styles.segment} ${priority === p.id ? styles.active : ''}`}
                                    onClick={() => setPriority(p.id)}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className={styles.field}>
                        <label>Paradas para repostar</label>
                        <div className={styles.segmented}>
                            {[1, 2, 3].map((n) => (
                                <button
                                    type="button"
                                    key={n}
                                    className={`${styles.segment} ${stops === n ? styles.active : ''}`}
                                    onClick={() => setStops(n)}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {error && <div className={styles.error}>{error}</div>}

                <button className={styles.submit} type="submit" disabled={loading || allStations.length === 0}>
                    <span className="material-symbols-outlined">route</span>
                    {loading ? 'Calculando…' : 'Calcular ruta'}
                </button>
            </form>

            {result && (
                <div className={styles.results}>
                    <div className={styles.statsBar}>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Distancia</span>
                            <span className={styles.statValue}>
                                {result.distanceKm.toFixed(0)} <small>km</small>
                            </span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Duración</span>
                            <span className={styles.statValue}>{fmtDuration(result.durationMin)}</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Combustible</span>
                            <span className={styles.statValue}>
                                {result.fuelNeeded.toFixed(1)} <small>L</small>
                            </span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Coste estimado</span>
                            <span className={styles.statValue}>
                                {result.estimatedCost.toFixed(2)} <small>€</small>
                            </span>
                        </div>
                        <div className={`${styles.stat} ${styles.savings}`}>
                            <span className={styles.statLabel}>Ahorro vs. media</span>
                            <span className={styles.statValue}>
                                {result.savings.toFixed(2)} <small>€</small>
                            </span>
                        </div>
                    </div>

                    <div className={styles.resultsGrid}>
                        <div className={styles.stopsList}>
                            <h2 className={styles.stopsTitle}>Repostajes recomendados</h2>
                            {result.stops.map((s, i) => (
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
                                        <span>€/L {FUEL_LABELS[result.fuel]}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className={styles.mapBox}>
                            <MapContainer
                                center={[result.origin.lat, result.origin.lng]}
                                zoom={7}
                                style={{ height: '100%', width: '100%' }}
                                scrollWheelZoom={true}
                            >
                                <TileLayer
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                                />
                                <FitBounds coords={result.coords} />
                                <Polyline positions={result.coords} pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.8 }} />

                                <Marker position={[result.origin.lat, result.origin.lng]} icon={endpointIcon('A', '#0ea5e9')} />
                                <Marker position={[result.destination.lat, result.destination.lng]} icon={endpointIcon('B', '#ef4444')} />

                                {result.stops.map((s) => (
                                    <CircleMarker
                                        key={s.id}
                                        center={[s.lat, s.lng]}
                                        radius={9}
                                        pathOptions={{ color: '#fff', weight: 3, fillColor: '#34d399', fillOpacity: 1 }}
                                    >
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
    );
};

export default RoutePlanner;
