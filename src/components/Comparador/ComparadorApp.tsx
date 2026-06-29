import React, { useEffect, useMemo, useState } from 'react';
import type { GasStation, FuelType } from '../../types/gasolinera';
import { FUEL_LABELS, FUEL_ORDER } from '../../lib/fuels';
import { getCompareIds, onCompareChange, addToCompare, removeFromCompare, clearCompare, MAX_COMPARE } from '../../lib/compare';
import BrandLogo from '../Explorer/BrandLogo';
import styles from './ComparadorApp.module.css';

const formatPrice = (price: number | null) => (price != null ? price.toFixed(3) : '--');

const ComparadorApp: React.FC = () => {
    const [allStations, setAllStations] = useState<GasStation[]>([]);
    const [ids, setIds] = useState<string[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [query, setQuery] = useState('');

    useEffect(() => {
        let cancelled = false;
        fetch('/data/stations.json')
            .then((r) => r.json())
            .then((data: GasStation[]) => {
                if (!cancelled) setAllStations(data);
            })
            .catch(() => {
                if (!cancelled) setAllStations([]);
            })
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        setIds(getCompareIds());
        return onCompareChange(setIds);
    }, []);

    const byId = useMemo(() => {
        const m = new Map<string, GasStation>();
        for (const s of allStations) m.set(s.id, s);
        return m;
    }, [allStations]);

    // Estaciones comparadas, en el orden en que se añadieron (filtra IDs huérfanos).
    const stations = useMemo(
        () => ids.map((id) => byId.get(id)).filter((s): s is GasStation => !!s),
        [ids, byId]
    );

    const canAdd = stations.length < MAX_COMPARE;

    // Buscador para añadir estaciones (nombre, marca, dirección, ciudad).
    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q.length < 3) return [];
        // Cada palabra debe aparecer (en cualquier orden): "ballenoil valladolid".
        const tokens = q.split(/\s+/).filter(Boolean);
        const selected = new Set(ids);
        const out: GasStation[] = [];
        for (const s of allStations) {
            if (selected.has(s.id)) continue;
            const hay = `${s.name} ${s.brand} ${s.address} ${s.city} ${s.province}`.toLowerCase();
            if (tokens.every((t) => hay.includes(t))) {
                out.push(s);
                if (out.length >= 12) break;
            }
        }
        return out;
    }, [query, allStations, ids]);

    // Combustibles a mostrar: solo los que tiene al menos una estación comparada.
    const fuelRows = useMemo(
        () => FUEL_ORDER.filter((f) => stations.some((s) => s.prices[f] != null)),
        [stations]
    );

    // Por cada combustible, el precio más barato entre las comparadas (para resaltar).
    const cheapestByFuel = useMemo(() => {
        const map = {} as Record<FuelType, number>;
        for (const f of fuelRows) {
            let min = Infinity;
            for (const s of stations) {
                const p = s.prices[f];
                if (p != null && p < min) min = p;
            }
            if (min !== Infinity) map[f] = min;
        }
        return map;
    }, [fuelRows, stations]);

    // Cuántos combustibles "gana" cada estación (precio más barato del grupo).
    const winsById = useMemo(() => {
        const map = new Map<string, number>();
        for (const f of fuelRows) {
            const min = cheapestByFuel[f];
            if (min == null) continue;
            for (const s of stations) {
                if (s.prices[f] === min) map.set(s.id, (map.get(s.id) ?? 0) + 1);
            }
        }
        return map;
    }, [fuelRows, stations, cheapestByFuel]);

    const handleAdd = (s: GasStation) => {
        const res = addToCompare(s.id);
        if (res.added) setQuery('');
    };

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div className={styles.headTitle}>
                    <h1 className={styles.title}>Comparador de gasolineras</h1>
                    <p className={styles.subtitle}>
                        Pon hasta {MAX_COMPARE} gasolineras una al lado de otra y compara precio a precio.
                    </p>
                </div>
            </header>

            {/* Buscador para añadir + vaciar */}
            <div className={styles.toolbar}>
                <div className={styles.searchZone}>
                    <div className={styles.searchBox}>
                    <span className="material-symbols-outlined">search</span>
                    <input
                        type="text"
                        placeholder={
                            canAdd
                                ? 'Añadir gasolinera (nombre, marca, ciudad…)'
                                : `Máximo ${MAX_COMPARE} gasolineras — quita alguna para añadir otra`
                        }
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        disabled={!canAdd}
                    />
                    {query && (
                        <button className={styles.clearSearch} onClick={() => setQuery('')} title="Limpiar">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    )}
                </div>
                {canAdd && results.length > 0 && (
                    <ul className={styles.results}>
                        {results.map((s) => (
                            <li key={s.id}>
                                <button className={styles.resultItem} onClick={() => handleAdd(s)}>
                                    <BrandLogo brand={s.brand} size={32} />
                                    <span className={styles.resultText}>
                                        <strong>{s.name}</strong>
                                        <small>{s.address}, {s.city}</small>
                                    </span>
                                    <span className={`material-symbols-outlined ${styles.addIcon}`}>add_circle</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                </div>
                {stations.length > 0 && (
                    <div className={styles.toolbarRight}>
                        <span className={styles.count}>{stations.length} / {MAX_COMPARE}</span>
                        <button className={styles.clearBtn} onClick={clearCompare} title="Vaciar comparador">
                            <span className="material-symbols-outlined">delete_sweep</span>
                            Vaciar
                        </button>
                    </div>
                )}
            </div>

            {/* Estado vacío */}
            {loaded && stations.length === 0 && (
                <div className={styles.empty}>
                    <div className={styles.emptyCard}>
                        <div className={styles.emptyIcon}>
                            <span className="material-symbols-outlined">balance</span>
                        </div>
                        <h2>Compara gasolineras lado a lado</h2>
                        <p>
                            Aún no has añadido ninguna. Junta hasta {MAX_COMPARE} y verás al instante
                            cuál es la más barata para cada combustible.
                        </p>

                        <ol className={styles.steps}>
                            <li>
                                <span className={styles.stepNum}>1</span>
                                Busca tu zona por municipio o con tu ubicación
                            </li>
                            <li>
                                <span className={styles.stepNum}>2</span>
                                Pulsa
                                <span className="material-symbols-outlined inline">balance</span>
                                Comparar en las gasolineras que te interesen
                            </li>
                            <li>
                                <span className={styles.stepNum}>3</span>
                                Vuelve aquí para verlas enfrentadas
                            </li>
                        </ol>

                        <div className={styles.emptyActions}>
                            <a className={styles.cta} href="/municipios">
                                <span className="material-symbols-outlined">search</span>
                                Buscar por municipio
                            </a>
                            <a className={styles.ctaGhost} href="/explorador?mode=location">
                                <span className="material-symbols-outlined">my_location</span>
                                Usar mi ubicación
                            </a>
                        </div>
                    </div>
                </div>
            )}

            {/* Tabla comparativa */}
            {stations.length > 0 && (
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.rowHead} />
                                {stations.map((s) => {
                                    const wins = winsById.get(s.id) ?? 0;
                                    return (
                                        <th key={s.id} className={styles.stationHead}>
                                            <button
                                                className={styles.remove}
                                                onClick={() => removeFromCompare(s.id)}
                                                title="Quitar del comparador"
                                            >
                                                <span className="material-symbols-outlined">close</span>
                                            </button>
                                            <BrandLogo brand={s.brand} size={44} />
                                            <span className={styles.stName}>{s.name}</span>
                                            <span className={styles.stMeta}>{s.address}, {s.city}</span>
                                            {wins > 0 && (
                                                <span className={styles.winBadge}>
                                                    <span className="material-symbols-outlined">trophy</span>
                                                    {wins === 1 ? 'Más barata en 1 carburante' : `Más barata en ${wins} carburantes`}
                                                </span>
                                            )}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {fuelRows.map((f) => (
                                <tr key={f}>
                                    <th className={styles.rowHead}>{FUEL_LABELS[f]}</th>
                                    {stations.map((s) => {
                                        const p = s.prices[f];
                                        const isCheapest = p != null && p === cheapestByFuel[f] && stations.length > 1;
                                        return (
                                            <td
                                                key={s.id}
                                                className={`${styles.cell} ${isCheapest ? styles.cheapest : ''} ${p == null ? styles.na : ''}`}
                                            >
                                                <span className={styles.price}>{formatPrice(p)}</span>
                                                {p != null && <span className={styles.unit}>€/L</span>}
                                                {isCheapest && <span className={styles.bestTag}>más barata</span>}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                            {/* Horario */}
                            <tr>
                                <th className={styles.rowHead}>Horario</th>
                                {stations.map((s) => (
                                    <td key={s.id} className={styles.cellInfo}>
                                        {s.schedule || '—'}
                                    </td>
                                ))}
                            </tr>
                            {/* Cómo llegar */}
                            <tr>
                                <th className={styles.rowHead} />
                                {stations.map((s) => (
                                    <td key={s.id} className={styles.cellInfo}>
                                        <a
                                            className={styles.routeLink}
                                            href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <span className="material-symbols-outlined">directions</span>
                                            Cómo llegar
                                        </a>
                                    </td>
                                ))}
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default ComparadorApp;
