import React, { useEffect, useMemo, useState } from 'react';
import type { FuelType } from '../../types/gasolinera';
import { FUEL_LABELS, FUEL_ORDER } from '../../lib/fuels';
import { getMyFuel, loadFavoriteStations, type FavoriteStation } from '../../lib/favorites';
import { deleteAlert, getAlertConfig, pushSupported, saveAlert, testAlert, type AlertConfig } from '../../lib/alerts';
import { useFavoriteIds } from './FavoriteButton';
import styles from './PriceAlerts.module.css';

const nf3 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const unit = (f: FuelType) => (f === 'gnc' || f === 'gnl' || f === 'hydrogen' ? '€/kg' : '€/L');
const priceText = (f: FuelType, n: number) => `${nf3.format(n)} ${unit(f)}`;
/** "1,65", "1.65" o "1,649" → número. */
const parsePrice = (s: string) => Number(s.trim().replace(',', '.'));

type Support = 'checking' | 'ok' | 'ios' | 'none' | 'denied';

/**
 * "Avísame cuando baje": notificación en el móvil u ordenador cuando alguna de las
 * gasolineras guardadas tenga el combustible elegido a ese precio o menos (se comprueba
 * con cada actualización de precios, dos veces al día).
 */
const PriceAlerts: React.FC = () => {
    const ids = useFavoriteIds();
    const [support, setSupport] = useState<Support>('checking');
    const [config, setConfig] = useState<AlertConfig | null>(null);
    const [editing, setEditing] = useState(false);
    const [fuel, setFuel] = useState<FuelType>('sp95');
    const [price, setPrice] = useState('');
    const [stations, setStations] = useState<FavoriteStation[]>([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    useEffect(() => {
        const standalone =
            matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (!pushSupported()) setSupport(ios && !standalone ? 'ios' : 'none');
        else setSupport(Notification.permission === 'denied' ? 'denied' : 'ok');
        const cfg = getAlertConfig();
        setConfig(cfg);
        setFuel(cfg?.fuel ?? getMyFuel());
    }, []);

    // Precios de hoy de las guardadas, para proponer un precio y para el resumen.
    useEffect(() => {
        if (ids.length) loadFavoriteStations(ids).then(setStations);
        else setStations([]);
    }, [ids.join(',')]);

    const fuels = useMemo(() => FUEL_ORDER.filter((f) => stations.some((s) => s.prices[f] != null)), [stations]);
    const cheapest = useMemo(() => {
        const prices = stations.map((s) => s.prices[fuel]).filter((p): p is number => p != null);
        return prices.length ? Math.min(...prices) : undefined;
    }, [stations, fuel]);

    // Precio propuesto para un aviso nuevo: un céntimo por debajo de la más barata de hoy,
    // redondeado. Al cambiar uno activo se parte de lo que tenía.
    useEffect(() => {
        if (config) return;
        if (cheapest != null) setPrice((Math.floor((cheapest - 0.01) * 100) / 100).toFixed(2).replace('.', ','));
    }, [cheapest, config]);

    const startEditing = () => {
        if (!config) return;
        setFuel(config.fuel);
        setPrice(config.maxPrice.toFixed(3).replace(/0$/, '').replace('.', ','));
        setMessage(null);
        setEditing(true);
    };

    if (!ids.length || support === 'checking') return null;

    const intro = (
        <p className={styles.lead}>
            Te avisamos en este dispositivo cuando alguna de tus gasolineras tenga tu combustible a ese precio o menos.
            Comprobamos los precios dos veces al día.
        </p>
    );

    if (support === 'ios')
        return (
            <section className={styles.box}>
                <h2>Avisos de precio</h2>
                {intro}
                <p className={styles.note}>
                    En iPhone, los avisos funcionan con OCTO en la pantalla de inicio: en Safari, pulsa <b>Compartir</b> y{' '}
                    <b>Añadir a pantalla de inicio</b>, ábrelo desde ese icono y actívalos aquí.
                </p>
            </section>
        );
    if (support === 'none')
        return (
            <section className={styles.box}>
                <h2>Avisos de precio</h2>
                <p className={styles.note}>Este navegador no permite notificaciones. Prueba con Chrome, Edge, Firefox o Safari.</p>
            </section>
        );
    if (support === 'denied')
        return (
            <section className={styles.box}>
                <h2>Avisos de precio</h2>
                <p className={styles.note}>
                    Las notificaciones de OCTO están bloqueadas en este navegador. Para recibir avisos, permítelas en los
                    ajustes del sitio (el candado junto a la dirección) y vuelve a esta página.
                </p>
            </section>
        );

    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        setMessage(null);
        try {
            await fn();
        } catch (err) {
            const text = (err as Error).message;
            if (text === 'permission') {
                if (Notification.permission === 'denied') setSupport('denied');
                setMessage({ kind: 'error', text: 'Sin permiso para notificaciones no podemos avisarte.' });
            } else setMessage({ kind: 'error', text: text || 'Algo ha fallado. Inténtalo de nuevo.' });
        } finally {
            setBusy(false);
        }
    };

    const save = () =>
        run(async () => {
            const maxPrice = parsePrice(price);
            if (!(maxPrice >= 0.3 && maxPrice <= 30)) throw new Error('Escribe un precio válido, por ejemplo 1,65.');
            const cfg = { fuel, maxPrice };
            const { below } = await saveAlert(cfg, ids);
            setConfig(cfg);
            setEditing(false);
            const names = below
                .map((b) => stations.find((s) => s.id === b.stationId))
                .filter((s): s is FavoriteStation => !!s)
                .map((s) => s.name);
            setMessage({
                kind: 'ok',
                text: below.length
                    ? `Aviso activado. Ahora mismo ya ${below.length === 1 ? 'está' : 'están'} por debajo: ${names.join(', ')}. Te avisaremos cuando ${below.length === 1 ? 'baje' : 'bajen'} más o de cualquier otra.`
                    : 'Aviso activado. Te llegará una notificación cuando alguna baje a ese precio.',
            });
        });

    if (config && !editing)
        return (
            <section className={`${styles.box} ${styles.on}`}>
                <h2>
                    <span className="material-symbols-outlined" aria-hidden="true">notifications_active</span>
                    Avisos de precio activados
                </h2>
                <p className={styles.lead}>
                    Te avisaremos cuando {ids.length === 1 ? 'tu gasolinera guardada' : `alguna de tus ${ids.length} gasolineras`} tenga{' '}
                    <b>{FUEL_LABELS[config.fuel]}</b> a <b>{priceText(config.fuel, config.maxPrice)}</b> o menos.
                </p>
                <div className={styles.actions}>
                    <button type="button" className={styles.secondary} disabled={busy} onClick={startEditing}>
                        Cambiar
                    </button>
                    <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() => run(async () => {
                            await testAlert();
                            setMessage({ kind: 'ok', text: 'Enviada. Si no la ves en unos segundos, revisa los permisos de notificaciones.' });
                        })}
                    >
                        Enviar aviso de prueba
                    </button>
                    <button
                        type="button"
                        className={styles.link}
                        disabled={busy}
                        onClick={() => run(async () => {
                            await deleteAlert();
                            setConfig(null);
                            setMessage({ kind: 'ok', text: 'Avisos desactivados.' });
                        })}
                    >
                        Desactivar
                    </button>
                </div>
                {message && <p className={message.kind === 'ok' ? styles.ok : styles.error}>{message.text}</p>}
            </section>
        );

    return (
        <section className={styles.box}>
            <h2>
                <span className="material-symbols-outlined" aria-hidden="true">notifications</span>
                Avísame cuando baje
            </h2>
            {intro}
            <form
                className={styles.form}
                onSubmit={(e) => {
                    e.preventDefault();
                    save();
                }}
            >
                <label>
                    <span>Combustible</span>
                    <select value={fuel} onChange={(e) => setFuel(e.target.value as FuelType)}>
                        {(fuels.length ? fuels : FUEL_ORDER).map((f) => (
                            <option key={f} value={f}>
                                {FUEL_LABELS[f]}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>A este precio o menos ({unit(fuel)})</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="1,65"
                        aria-describedby="alert-hint"
                    />
                </label>
                <button type="submit" className={styles.primary} disabled={busy}>
                    {busy ? 'Activando…' : config ? 'Guardar cambios' : 'Activar avisos'}
                </button>
                {editing && (
                    <button type="button" className={styles.link} onClick={() => setEditing(false)}>
                        Cancelar
                    </button>
                )}
            </form>
            {cheapest != null && (
                <p className={styles.hint} id="alert-hint">
                    Hoy la más barata de tus gasolineras para {FUEL_LABELS[fuel]} está a {priceText(fuel, cheapest)}.
                </p>
            )}
            {message && <p className={message.kind === 'ok' ? styles.ok : styles.error}>{message.text}</p>}
        </section>
    );
};

export default PriceAlerts;
