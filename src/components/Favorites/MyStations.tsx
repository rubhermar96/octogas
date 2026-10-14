import React, { useEffect, useMemo, useState } from 'react';
import type { FuelType } from '../../types/gasolinera';
import { FUEL_LABELS, FUEL_ORDER } from '../../lib/fuels';
import { getMyFuel, loadFavoriteStations, removeFavorite, setMyFuel, type FavoriteStation } from '../../lib/favorites';
import CompareButton from '../Explorer/CompareButton';
import FavoriteButton, { useFavoriteIds } from './FavoriteButton';
import styles from './MyStations.module.css';

/** Los gases (GNC, GNL e hidrógeno) se venden por kilo. */
const unit = (f: FuelType) => (f === 'gnc' || f === 'gnl' || f === 'hydrogen' ? '€/kg' : '€/L');
const dayLabel = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

interface Props {
    /** Versión corta de la portada: hasta 4, sin selector, y nada si no hay guardadas. */
    compact?: boolean;
}

/**
 * "Mis gasolineras": precio de hoy de las guardadas, de la más barata a la más cara
 * para el combustible elegido. Los datos salen de /data/estaciones/{id}.json (uno por
 * gasolinera, generados en cada build).
 */
const MyStations: React.FC<Props> = ({ compact = false }) => {
    const ids = useFavoriteIds();
    const [ready, setReady] = useState(false);
    const [stations, setStations] = useState<FavoriteStation[]>([]);
    const [fuel, setFuel] = useState<FuelType>('sp95');

    useEffect(() => setFuel(getMyFuel()), []);

    // Descarga solo las que faltan; quitar una no vuelve a pedir nada.
    useEffect(() => {
        let cancelled = false;
        const known = new Set(stations.map((s) => s.id));
        const missing = ids.filter((id) => !known.has(id));
        (missing.length ? loadFavoriteStations(missing) : Promise.resolve([])).then((loaded) => {
            if (cancelled) return;
            setStations((prev) => [...prev, ...loaded].filter((s) => ids.includes(s.id)));
            setReady(true);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ids]);

    // Combustibles que vende alguna de las guardadas; si no vende ninguna el elegido, el primero.
    const fuels = useMemo(() => FUEL_ORDER.filter((f) => stations.some((s) => s.prices[f] != null)), [stations]);
    const shownFuel = fuels.includes(fuel) || !fuels.length ? fuel : fuels[0];
    const sorted = useMemo(
        () =>
            [...stations].sort((a, b) => (a.prices[shownFuel] ?? Infinity) - (b.prices[shownFuel] ?? Infinity)),
        [stations, shownFuel]
    );
    const gone = ready ? ids.filter((id) => !stations.some((s) => s.id === id)) : [];

    const chooseFuel = (f: FuelType) => {
        setFuel(f);
        setMyFuel(f);
    };

    if (compact && (!ready || !ids.length)) return null;

    if (!ids.length) {
        return (
            <div className={styles.empty}>
                <span className="material-symbols-outlined" aria-hidden="true">bookmark_add</span>
                <p>
                    Aún no tienes gasolineras guardadas. Busca las que sueles usar y pulsa <b>Guardar</b>: aquí
                    verás su precio de hoy nada más entrar.
                </p>
                <div className={styles.emptyActions}>
                    <a className={styles.primaryLink} href="/municipios/">Buscar mi municipio</a>
                    <a className={styles.secondaryLink} href="/explorador/?mode=location">Gasolineras cerca de mí</a>
                </div>
            </div>
        );
    }

    if (!ready) return <p className={styles.loading}>Cargando tus gasolineras…</p>;

    const list = compact ? sorted.slice(0, 4) : sorted;
    // La más barata (o las empatadas), salvo que estén todas al mismo precio.
    const min = sorted[0]?.prices[shownFuel];
    const isBest = (s: FavoriteStation) => min != null && s.prices[shownFuel] != null && s.prices[shownFuel]! - min < 0.0005;
    const markBest = sorted.length > 1 && !sorted.every(isBest);

    return (
        <div className={styles.wrap}>
            {!compact && fuels.length > 1 && (
                <div className={styles.fuels} role="group" aria-label="Mi combustible">
                    {fuels.map((f) => (
                        <button
                            key={f}
                            type="button"
                            className={`${styles.fuelBtn} ${f === shownFuel ? styles.fuelActive : ''}`}
                            aria-pressed={f === shownFuel}
                            onClick={() => chooseFuel(f)}
                        >
                            {FUEL_LABELS[f]}
                        </button>
                    ))}
                </div>
            )}

            <ul className={`${styles.grid} ${compact ? styles.compact : ''}`}>
                {list.map((s) => {
                    const p = s.prices[shownFuel];
                    const others = FUEL_ORDER.filter((f) => f !== shownFuel && s.prices[f] != null);
                    return (
                        <li key={s.id} className={`${styles.card} ${markBest && isBest(s) ? styles.best : ''}`}>
                            {markBest && isBest(s) && (
                                <span className={styles.bestTag}>La más barata de las tuyas hoy</span>
                            )}
                            <div className={styles.head}>
                                <div className={styles.names}>
                                    <a className={styles.name} href={s.url}>
                                        {s.name}
                                    </a>
                                    <span className={styles.where}>
                                        {s.brand ? `${s.address} · ` : ''}
                                        {s.city}
                                    </span>
                                </div>
                                <div className={styles.price}>
                                    {p != null ? (
                                        <>
                                            <span className={styles.priceValue}>
                                                <b>{p.toFixed(3)}</b> <small>{unit(shownFuel)}</small>
                                            </span>
                                            <span className={styles.priceFuel}>{FUEL_LABELS[shownFuel]}</span>
                                        </>
                                    ) : (
                                        <span className={styles.noFuel}>Sin {FUEL_LABELS[shownFuel]}</span>
                                    )}
                                </div>
                            </div>

                            {s.lastSeen && (
                                <p className={styles.stale}>Hoy no ha publicado precios: estos son del {dayLabel(s.lastSeen)}.</p>
                            )}

                            {!compact && others.length > 0 && (
                                <p className={styles.others}>
                                    {others.map((f) => (
                                        <span key={f}>
                                            {FUEL_LABELS[f]} <b>{s.prices[f]!.toFixed(3)}</b>
                                        </span>
                                    ))}
                                </p>
                            )}

                            {!compact && (
                                <div className={styles.actions}>
                                    <a
                                        className={styles.route}
                                        href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <span className="material-symbols-outlined" aria-hidden="true">directions</span>
                                        Cómo llegar
                                    </a>
                                    {!s.lastSeen && <CompareButton stationId={s.id} variant="mini" />}
                                    <FavoriteButton stationId={s.id} variant="mini" />
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            {gone.length > 0 && !compact && (
                <p className={styles.gone}>
                    {gone.length === 1
                        ? 'Una de tus gasolineras ya no aparece en los datos del Ministerio.'
                        : `${gone.length} de tus gasolineras ya no aparecen en los datos del Ministerio.`}{' '}
                    <button type="button" onClick={() => gone.forEach(removeFavorite)}>
                        Quitarlas de la lista
                    </button>
                </p>
            )}

            {compact && (
                <a className={styles.more} href="/mis-gasolineras/">
                    {ids.length > list.length ? `Ver las ${ids.length} y elegir combustible` : 'Ver todas y elegir combustible'}
                    <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                </a>
            )}
        </div>
    );
};

export default MyStations;
