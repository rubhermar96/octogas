import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FuelType } from '../../types/gasolinera';
import { FUEL_LABELS, FUEL_ORDER } from '../../lib/fuels';
import {
    LIMITS,
    MAX_DISCOUNTS,
    deleteDiscount,
    discountLabel,
    isExpired,
    myPrice,
    saveDiscount,
    type Discount,
    type DiscountKind,
    type DiscountUnit,
} from '../../lib/discounts';
import { loadFavoriteStations, type FavoriteStation } from '../../lib/favorites';
import { useFavoriteIds } from '../Favorites/FavoriteButton';
import { useDiscounts } from './useDiscounts';
import box from '../Favorites/PriceAlerts.module.css';
import styles from './MyDiscounts.module.css';

interface Draft {
    name: string;
    kind: DiscountKind;
    unit: DiscountUnit;
    value: string;
    brands: string[];
    stations: string[];
    onlySomeFuels: boolean;
    fuels: FuelType[];
    until: string;
}

const EMPTY: Draft = { name: '', kind: 'direct', unit: 'cents', value: '', brands: [], stations: [], onlySomeFuels: false, fuels: [], until: '' };

const nf3 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const parseNumber = (s: string) => Number(s.trim().replace(',', '.'));
const dateLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const joinEs = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);
const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
const validId = (id: string | null): id is string => !!id && /^\d{1,8}$/.test(id);
/** Precio de ejemplo para la vista previa del formulario. */
const EXAMPLE = 1.8;

/**
 * Página "Mis descuentos" (/mis-descuentos/, lib/discounts.ts): la lista y una ventana
 * para crear o cambiar uno. Desde una ficha se llega con ?descuento=nuevo&gasolinera={id},
 * que abre la ventana con esa gasolinera ya marcada.
 */
const MyDiscounts: React.FC = () => {
    const discounts = useDiscounts();
    const favoriteIds = useFavoriteIds();
    const [brands, setBrands] = useState<string[]>([]);
    const [stations, setStations] = useState<FavoriteStation[]>([]);
    /** Gasolineras que no están entre las guardadas pero hay que poder marcar (la de la ficha). */
    const [extraIds, setExtraIds] = useState<string[]>([]);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [editingId, setEditingId] = useState<string | undefined>();
    const [brandQuery, setBrandQuery] = useState('');
    const [formError, setFormError] = useState('');
    const [message, setMessage] = useState('');
    const dialog = useRef<HTMLDialogElement>(null);

    // Marcas con página (las del buscador), de la que más gasolineras tiene a la que menos.
    useEffect(() => {
        fetch('/data/buscador/lugares.json')
            .then((r) => r.json())
            .then((d: { b?: [string, string, number][] }) => setBrands((d.b ?? []).map(([name]) => name)))
            .catch(() => setBrands([]));
    }, []);

    // Desde una ficha: ventana nueva con esa gasolinera marcada.
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (params.get('descuento') !== 'nuevo') return;
        const id = params.get('gasolinera');
        if (validId(id)) setExtraIds((x) => [...new Set([...x, id])]);
        setDraft({ ...EMPTY, stations: validId(id) ? [id] : [] });
        history.replaceState(null, '', location.pathname);
    }, []);

    // La ventana se abre y se cierra con el borrador.
    useEffect(() => {
        const d = dialog.current;
        if (!d) return;
        if (draft && !d.open) d.showModal();
        if (!draft && d.open) d.close();
    }, [draft]);

    // Datos de las gasolineras que se pueden marcar: guardadas, la de la ficha y las de los descuentos.
    const candidateIds = useMemo(
        () => [...new Set([...favoriteIds, ...extraIds, ...discounts.flatMap((d) => d.stations)])],
        [favoriteIds, extraIds, discounts]
    );
    useEffect(() => {
        const known = new Set(stations.map((s) => s.id));
        const missing = candidateIds.filter((id) => !known.has(id));
        if (missing.length) loadFavoriteStations(missing).then((loaded) => setStations((prev) => [...prev, ...loaded]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidateIds.join(',')]);
    const stationById = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
    const stationLabel = (id: string) => {
        const s = stationById.get(id);
        return s ? `${s.name}${s.brand ? `, ${s.address}` : ''} (${s.city})` : 'Gasolinera';
    };

    const open = (d?: Discount) => {
        setMessage('');
        setFormError('');
        setBrandQuery('');
        setEditingId(d?.id);
        setDraft(
            d
                ? {
                      name: d.name,
                      kind: d.kind,
                      unit: d.unit,
                      value: String(d.value).replace('.', ','),
                      brands: d.brands,
                      stations: d.stations,
                      onlySomeFuels: d.fuels.length > 0,
                      fuels: d.fuels,
                      until: d.until ?? '',
                  }
                : { ...EMPTY }
        );
    };
    const close = () => {
        setDraft(null);
        setEditingId(undefined);
    };
    const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft) return;
        try {
            const value = parseNumber(draft.value);
            const { min, max } = LIMITS[draft.unit];
            if (!draft.name.trim()) throw new Error('Ponle un nombre al descuento, por ejemplo «Tarjeta de la empresa».');
            if (!(value >= min && value <= max))
                throw new Error(draft.unit === 'cents' ? `Escribe los céntimos por litro, entre ${min} y ${max} (por ejemplo, 5).` : `Escribe un porcentaje entre ${min} y ${max} (por ejemplo, 3).`);
            if (!draft.brands.length && !draft.stations.length) throw new Error('Elige al menos una marca o una gasolinera.');
            if (draft.onlySomeFuels && !draft.fuels.length) throw new Error('Elige algún combustible o desmarca «Solo algunos combustibles».');
            saveDiscount(
                {
                    name: draft.name.trim(),
                    kind: draft.kind,
                    unit: draft.unit,
                    value,
                    brands: draft.brands,
                    stations: draft.stations,
                    fuels: draft.onlySomeFuels ? draft.fuels : [],
                    ...(draft.until ? { until: draft.until } : {}),
                },
                editingId
            );
            setMessage(editingId ? 'Descuento cambiado.' : 'Descuento guardado: ya lo ves en las fichas, en Mis gasolineras, en el comparador y en el mapa.');
            close();
        } catch (err) {
            setFormError((err as Error).message);
        }
    };

    // Marcas para elegir: las marcadas primero; sin buscar, las 12 con más gasolineras.
    const brandOptions = useMemo(() => {
        if (!draft) return [];
        const q = brandQuery.trim().toLowerCase();
        const preset = draft.stations.map((id) => stationById.get(id)?.brand).filter((b): b is string => !!b);
        const all = [...new Set([...draft.brands, ...preset, ...brands])];
        // Buscando, las marcadas siguen a la vista (para poder desmarcarlas).
        if (q) return [...new Set([...draft.brands, ...all.filter((b) => b.toLowerCase().includes(q)).slice(0, 24)])];
        return [...new Set([...draft.brands, ...preset, ...brands.slice(0, 12)])];
    }, [draft, brandQuery, brands, stationById]);

    const preview = useMemo(() => {
        if (!draft) return undefined;
        const value = parseNumber(draft.value);
        const { min, max } = LIMITS[draft.unit];
        if (!(value >= min && value <= max)) return undefined;
        const sample: Discount = { id: '', name: '', kind: draft.kind, unit: draft.unit, value, brands: [], stations: [], fuels: [], createdAt: '', updatedAt: '' };
        const p = myPrice(EXAMPLE, [sample])!;
        return draft.kind === 'direct'
            ? `Ejemplo: con el litro a ${nf3.format(EXAMPLE)} €, pagas ${nf3.format(p.pay)} €.`
            : `Ejemplo: con el litro a ${nf3.format(EXAMPLE)} €, pagas ${nf3.format(p.pay)} € y después te devuelven ${nf3.format(p.balance)} € a tu saldo.`;
    }, [draft]);

    const scopeText = (d: Discount) => joinEs([...d.brands.map((b) => `todas las ${b}`), ...d.stations.map(stationLabel)]);

    return (
        <div className={styles.wrap}>
            {discounts.length ? (
                <ul className={styles.list}>
                    {discounts.map((d) => (
                        <li key={d.id} className={`${styles.card} ${isExpired(d) ? styles.expired : ''}`}>
                            <div className={styles.cardHead}>
                                <span className={`material-symbols-outlined ${styles.cardIcon}`} aria-hidden="true">
                                    savings
                                </span>
                                <div>
                                    <h2 className={styles.cardName}>{d.name}</h2>
                                    <p className={styles.amount}>{discountLabel(d)}</p>
                                </div>
                                {isExpired(d) && <span className={styles.expiredTag}>Caducado</span>}
                            </div>
                            <dl className={styles.facts}>
                                <div>
                                    <dt>Dónde</dt>
                                    <dd>{scopeText(d)}</dd>
                                </div>
                                <div>
                                    <dt>Combustibles</dt>
                                    <dd>{d.fuels.length ? joinEs(d.fuels.map((f) => FUEL_LABELS[f])) : 'Todos'}</dd>
                                </div>
                                {d.until && (
                                    <div>
                                        <dt>{isExpired(d) ? 'Caducó' : 'Hasta'}</dt>
                                        <dd>{dateLabel(d.until)}</dd>
                                    </div>
                                )}
                            </dl>
                            <div className={box.actions}>
                                <button type="button" className={box.secondary} onClick={() => open(d)}>
                                    Cambiar
                                </button>
                                <button
                                    type="button"
                                    className={box.link}
                                    onClick={() => {
                                        if (confirm(`¿Borrar el descuento «${d.name}»?`)) {
                                            deleteDiscount(d.id);
                                            setMessage('Descuento borrado.');
                                        }
                                    }}
                                >
                                    Borrar
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className={styles.empty}>
                    <span className="material-symbols-outlined" aria-hidden="true">savings</span>
                    <p>
                        Aún no tienes descuentos. Añade los que tengas (una tarjeta de empresa, Waylet, el cheque ahorro de un
                        súper...) y verás lo que te cuesta de verdad el litro.
                    </p>
                </div>
            )}

            <div className={box.actions}>
                {discounts.length < MAX_DISCOUNTS ? (
                    <button type="button" className={box.primary} onClick={() => open()}>
                        Añadir un descuento
                    </button>
                ) : (
                    <p className={box.note}>Has llegado al máximo de {MAX_DISCOUNTS} descuentos: borra alguno para añadir otro.</p>
                )}
            </div>
            {message && (
                <p className={box.ok} role="status">
                    {message}
                </p>
            )}

            <dialog
                ref={dialog}
                className={styles.dialog}
                aria-labelledby="discount-dialog-title"
                onClose={close}
                onClick={(e) => {
                    if (e.target === dialog.current) close();
                }}
            >
                {draft && (
                    <form className={`${box.form} ${styles.panel}`} onSubmit={submit} noValidate>
                        <div className={styles.panelHead}>
                            <h2 id="discount-dialog-title">{editingId ? 'Cambiar descuento' : 'Nuevo descuento'}</h2>
                            <button type="button" className={styles.close} aria-label="Cerrar" onClick={close}>
                                <span className="material-symbols-outlined" aria-hidden="true">close</span>
                            </button>
                        </div>

                        <label className={`${box.field} ${styles.wide}`}>
                            <span>Nombre</span>
                            <input
                                className={styles.input}
                                type="text"
                                value={draft.name}
                                maxLength={60}
                                placeholder="Por ejemplo, Tarjeta de la empresa o Waylet"
                                onChange={(e) => update({ name: e.target.value })}
                            />
                        </label>

                        <fieldset className={box.group}>
                            <legend>Tipo</legend>
                            <label className={box.option}>
                                <input type="radio" name="kind" checked={draft.kind === 'direct'} onChange={() => update({ kind: 'direct' })} />
                                <span>
                                    <b>Directo</b>
                                    <small>Se descuenta del precio al pagar.</small>
                                </span>
                            </label>
                            <label className={box.option}>
                                <input type="radio" name="kind" checked={draft.kind === 'balance'} onChange={() => update({ kind: 'balance' })} />
                                <span>
                                    <b>En saldo</b>
                                    <small>
                                        Pagas el precio entero y después una parte vuelve a un saldo, como el Waylet de Repsol o el cheque ahorro de
                                        Carrefour. No cambia el precio que ves: te lo anotamos al lado.
                                    </small>
                                </span>
                            </label>
                        </fieldset>

                        <fieldset className={box.group}>
                            <legend>Cantidad</legend>
                            <div className={styles.amountRow}>
                                <input
                                    className={styles.input}
                                    type="text"
                                    inputMode="decimal"
                                    value={draft.value}
                                    placeholder={draft.unit === 'cents' ? '5' : '3'}
                                    aria-label="Cantidad"
                                    onChange={(e) => update({ value: e.target.value })}
                                />
                                <select value={draft.unit} aria-label="Unidad" onChange={(e) => update({ unit: e.target.value as DiscountUnit })}>
                                    <option value="cents">céntimos por litro</option>
                                    <option value="percent">% del precio</option>
                                </select>
                            </div>
                            {preview && <p className={box.hint}>{preview}</p>}
                        </fieldset>

                        <fieldset className={box.group}>
                            <legend>Marcas</legend>
                            <p className={box.hint}>Vale en todas sus gasolineras. Puedes elegir varias.</p>
                            <input
                                className={`${styles.input} ${styles.search}`}
                                type="search"
                                value={brandQuery}
                                placeholder="Buscar marca"
                                aria-label="Buscar marca"
                                onChange={(e) => setBrandQuery(e.target.value)}
                            />
                            <div className={styles.chips}>
                                {brandOptions.map((b) => (
                                    <button
                                        key={b}
                                        type="button"
                                        className={`${styles.chip} ${draft.brands.includes(b) ? styles.chipOn : ''}`}
                                        aria-pressed={draft.brands.includes(b)}
                                        onClick={() => update({ brands: toggle(draft.brands, b) })}
                                    >
                                        {b}
                                    </button>
                                ))}
                                {brandQuery && !brandOptions.some((b) => b.toLowerCase().includes(brandQuery.trim().toLowerCase())) && (
                                    <span className={box.hint}>No hay ninguna marca con ese nombre.</span>
                                )}
                            </div>
                        </fieldset>

                        <fieldset className={box.group}>
                            <legend>Gasolineras concretas</legend>
                            {candidateIds.length ? (
                                <>
                                    <p className={box.hint}>Además de las marcas, o si el descuento es solo de una gasolinera.</p>
                                    {candidateIds.map((id) => (
                                        <label key={id} className={box.option}>
                                            <input type="checkbox" checked={draft.stations.includes(id)} onChange={() => update({ stations: toggle(draft.stations, id) })} />
                                            <span>{stationLabel(id)}</span>
                                        </label>
                                    ))}
                                </>
                            ) : (
                                <p className={box.hint}>
                                    Aquí salen tus gasolineras guardadas. Para una que no tengas guardada, entra en su ficha y pulsa «¿Tienes un descuento aquí?».
                                </p>
                            )}
                        </fieldset>

                        <fieldset className={box.group}>
                            <legend>Combustibles</legend>
                            <label className={box.option}>
                                <input type="checkbox" checked={draft.onlySomeFuels} onChange={(e) => update({ onlySomeFuels: e.target.checked })} />
                                <span>
                                    <b>Solo algunos combustibles</b>
                                    <small>Si no, vale para todos.</small>
                                </span>
                            </label>
                            {draft.onlySomeFuels && (
                                <div className={styles.chips}>
                                    {FUEL_ORDER.map((f) => (
                                        <button
                                            key={f}
                                            type="button"
                                            className={`${styles.chip} ${draft.fuels.includes(f) ? styles.chipOn : ''}`}
                                            aria-pressed={draft.fuels.includes(f)}
                                            onClick={() => update({ fuels: toggle(draft.fuels, f) })}
                                        >
                                            {FUEL_LABELS[f]}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </fieldset>

                        <label className={box.field}>
                            <span>Caduca (opcional)</span>
                            <input className={styles.input} type="date" value={draft.until} onChange={(e) => update({ until: e.target.value })} />
                        </label>

                        {formError && (
                            <p className={box.error} role="alert">
                                {formError}
                            </p>
                        )}

                        <div className={`${box.actions} ${styles.panelFoot}`}>
                            <button type="submit" className={box.primary}>
                                {editingId ? 'Guardar cambios' : 'Guardar descuento'}
                            </button>
                            <button type="button" className={box.link} onClick={close}>
                                Cancelar
                            </button>
                        </div>
                    </form>
                )}
            </dialog>
        </div>
    );
};

export default MyDiscounts;
