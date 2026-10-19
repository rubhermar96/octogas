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
/** 0 domingo … 6 sábado (como la API); en el selector, de lunes a domingo. */
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const digestText = (cfg: Pick<AlertConfig, 'digest' | 'digestDay'>) =>
    cfg.digest === 'daily' ? 'cada día por la mañana' : `cada ${DAYS[cfg.digestDay ?? 1]} por la mañana`;

type Support = 'checking' | 'ok' | 'ios' | 'none' | 'denied';

/**
 * Avisos de "Mis gasolineras" en este dispositivo (notificaciones): bajadas de precio
 * que merecen la pena (automático, según el historial de cada gasolinera) y un resumen
 * diario o semanal de la más barata. Se comprueba con cada actualización de
 * precios, dos veces al día (api/src/alerts/send.ts).
 */
const PriceAlerts: React.FC = () => {
    const ids = useFavoriteIds();
    const [support, setSupport] = useState<Support>('checking');
    const [config, setConfig] = useState<AlertConfig | null>(null);
    const [editing, setEditing] = useState(false);
    const [fuel, setFuel] = useState<FuelType>('sp95');
    const [mode, setMode] = useState<AlertConfig['mode']>('auto');
    const [digest, setDigest] = useState<AlertConfig['digest']>('none');
    const [digestDay, setDigestDay] = useState(1);
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

    const startEditing = () => {
        if (!config) return;
        setFuel(config.fuel);
        setMode(config.mode);
        setDigest(config.digest);
        setDigestDay(config.digestDay ?? 1);
        setMessage(null);
        setEditing(true);
    };

    if (!ids.length || support === 'checking') return null;

    const title = ({ icon, text }: { icon: string; text: string }) => (
        <h2>
            <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
            {text}
        </h2>
    );

    if (support === 'ios')
        return (
            <section className={styles.box}>
                {title({ icon: 'notifications', text: 'Avisos de tus gasolineras' })}
                <p className={styles.note}>
                    En iPhone, los avisos funcionan con OCTO en la pantalla de inicio: en Safari, pulsa <b>Compartir</b> y{' '}
                    <b>Añadir a pantalla de inicio</b>, ábrelo desde ese icono y actívalos aquí.
                </p>
            </section>
        );
    if (support === 'none')
        return (
            <section className={styles.box}>
                {title({ icon: 'notifications', text: 'Avisos de tus gasolineras' })}
                <p className={styles.note}>Este navegador no permite notificaciones. Prueba con Chrome, Edge, Firefox o Safari.</p>
            </section>
        );
    if (support === 'denied')
        return (
            <section className={styles.box}>
                {title({ icon: 'notifications_off', text: 'Avisos de tus gasolineras' })}
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
            if (mode === 'none' && digest === 'none') throw new Error('Elige al menos un aviso: de bajadas o el resumen.');
            const cfg: AlertConfig = { fuel, mode, digest, ...(digest === 'weekly' ? { digestDay } : {}) };
            await saveAlert(cfg, ids);
            setConfig(cfg);
            setEditing(false);
            const parts: string[] = [];
            if (mode === 'auto') parts.push('Te avisaremos cuando una de tus gasolineras tenga una bajada que merezca la pena.');
            if (digest !== 'none') parts.push(`El resumen te llegará ${digestText(cfg)}.`);
            setMessage({ kind: 'ok', text: `Avisos activados. ${parts.join(' ')}` });
        });

    if (config && !editing)
        return (
            <section className={`${styles.box} ${styles.on}`}>
                {title({ icon: 'notifications_active', text: 'Avisos activados' })}
                <ul className={styles.summary}>
                    <li>
                        Combustible: <b>{FUEL_LABELS[config.fuel]}</b>
                    </li>
                    {config.mode === 'auto' && (
                        <li>
                            Bajadas: <b>automático</b>, cuando una esté a su precio más bajo del mes o muy por debajo de lo habitual
                        </li>
                    )}
                    {config.digest !== 'none' && (
                        <li>
                            Resumen de la más barata: <b>{digestText(config)}</b>
                        </li>
                    )}
                </ul>
                <div className={styles.actions}>
                    <button type="button" className={styles.secondary} disabled={busy} onClick={startEditing}>
                        Cambiar
                    </button>
                    <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() =>
                            run(async () => {
                                await testAlert();
                                setMessage({ kind: 'ok', text: 'Enviada. Si no la ves en unos segundos, revisa los permisos de notificaciones.' });
                            })
                        }
                    >
                        Enviar aviso de prueba
                    </button>
                    <button
                        type="button"
                        className={styles.link}
                        disabled={busy}
                        onClick={() =>
                            run(async () => {
                                await deleteAlert();
                                setConfig(null);
                                setMessage({ kind: 'ok', text: 'Avisos desactivados.' });
                            })
                        }
                    >
                        Desactivar
                    </button>
                </div>
                {message && <p className={message.kind === 'ok' ? styles.ok : styles.error}>{message.text}</p>}
            </section>
        );

    return (
        <section className={styles.box}>
            {title({ icon: 'notifications', text: 'Avisos de tus gasolineras' })}
            <p className={styles.lead}>
                Te avisamos en este dispositivo. Comprobamos los precios de tus gasolineras dos veces al día.
            </p>
            <form
                className={styles.form}
                onSubmit={(e) => {
                    e.preventDefault();
                    save();
                }}
            >
                <label className={styles.field}>
                    <span>Combustible</span>
                    <select value={fuel} onChange={(e) => setFuel(e.target.value as FuelType)}>
                        {(fuels.length ? fuels : FUEL_ORDER).map((f) => (
                            <option key={f} value={f}>
                                {FUEL_LABELS[f]}
                            </option>
                        ))}
                    </select>
                </label>

                <fieldset className={styles.group}>
                    <legend>Bajadas de precio</legend>
                    <label className={styles.option}>
                        <input type="checkbox" checked={mode === 'auto'} onChange={(e) => setMode(e.target.checked ? 'auto' : 'none')} />
                        <span>
                            <b>Avisarme cuando baje</b>
                            <small>
                                Cuando una de tus gasolineras esté a su precio más bajo del último mes o muy por debajo de
                                lo habitual. Como mucho, un aviso cada tres días.
                            </small>
                        </span>
                    </label>
                </fieldset>

                <fieldset className={styles.group}>
                    <legend>Resumen de la más barata</legend>
                    <label className={styles.option}>
                        <input type="radio" name="digest" checked={digest === 'none'} onChange={() => setDigest('none')} />
                        <span>
                            <b>Sin resumen</b>
                        </span>
                    </label>
                    <label className={styles.option}>
                        <input type="radio" name="digest" checked={digest === 'daily'} onChange={() => setDigest('daily')} />
                        <span>
                            <b>Cada día, por la mañana</b>
                        </span>
                    </label>
                    <label className={styles.option}>
                        <input type="radio" name="digest" checked={digest === 'weekly'} onChange={() => setDigest('weekly')} />
                        <span>
                            <b>Cada semana</b>
                            {digest === 'weekly' && (
                                <span className={styles.inline}>
                                    el
                                    <select value={digestDay} onChange={(e) => setDigestDay(Number(e.target.value))} aria-label="Día del resumen">
                                        {WEEK_ORDER.map((d) => (
                                            <option key={d} value={d}>
                                                {DAYS[d]}
                                            </option>
                                        ))}
                                    </select>
                                    por la mañana
                                </span>
                            )}
                        </span>
                    </label>
                </fieldset>

                <div className={styles.actions}>
                    <button type="submit" className={styles.primary} disabled={busy}>
                        {busy ? 'Guardando…' : config ? 'Guardar cambios' : 'Activar avisos'}
                    </button>
                    {editing && (
                        <button type="button" className={styles.link} onClick={() => setEditing(false)}>
                            Cancelar
                        </button>
                    )}
                </div>
            </form>
            {cheapest != null && (
                <p className={styles.hint}>
                    Hoy la más barata de tus gasolineras para {FUEL_LABELS[fuel]} está a {priceText(fuel, cheapest)}.
                </p>
            )}
            {message && <p className={message.kind === 'ok' ? styles.ok : styles.error}>{message.text}</p>}
        </section>
    );
};

export default PriceAlerts;
