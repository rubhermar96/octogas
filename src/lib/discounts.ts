/**
 * "Mis descuentos": los descuentos que tiene cada usuario (una tarjeta de empresa, el
 * Waylet de Repsol, el cheque ahorro de Carrefour...), con los que la web le enseña lo
 * que paga de verdad. Dos tipos:
 *   - directos: se descuentan del precio al pagar (cambian el precio que se enseña);
 *   - en saldo: se paga el precio entero y una parte vuelve después a un saldo. No se
 *     restan del precio: se enseñan aparte, como anotación de lo que te devuelven.
 * Cada uno es una cantidad fija por litro (o kilo) o un porcentaje, y vale para una o
 * varias marcas y/o gasolineras concretas.
 *
 * Como "Mis gasolineras" (favorites.ts): en localStorage, sin cuentas, sincronizado con
 * un CustomEvent en la misma pestaña y con el evento storage entre pestañas.
 *
 * Preparado para cuentas: cada descuento tiene un id propio (no depende del dispositivo)
 * y la fecha de su último cambio, y lo guardado lleva versión. Cuando haya cuentas, al
 * entrar por primera vez se suben los de este dispositivo y, si un descuento existe en
 * los dos sitios, se queda el que tenga el `updatedAt` más reciente.
 */
import type { FuelType } from '../types/gasolinera';
import { track } from './track';

const KEY = 'octo-discounts';
const EVENT = 'octo-discounts-change';
const VERSION = 1;

/** Máximo de descuentos guardados. */
export const MAX_DISCOUNTS = 20;

export type DiscountKind = 'direct' | 'balance';
export type DiscountUnit = 'cents' | 'percent';

export interface Discount {
    id: string;
    /** "Tarjeta de la empresa", "Waylet". */
    name: string;
    kind: DiscountKind;
    unit: DiscountUnit;
    /** Céntimos por litro (o kilo) si `unit` es 'cents'; tanto por ciento si es 'percent'. */
    value: number;
    /** Marcas a las que se aplica, con el nombre que traen los datos ("Repsol"). */
    brands: string[];
    /** Gasolineras concretas (id del Ministerio), además de las marcas. */
    stations: string[];
    /** Combustibles a los que se aplica; vacío, a todos. */
    fuels: FuelType[];
    /** Último día en que vale (AAAA-MM-DD), si caduca. */
    until?: string;
    createdAt: string;
    updatedAt: string;
}

/** Lo mínimo de una gasolinera para saber qué descuentos tiene. */
export interface DiscountTarget {
    id: string;
    brand: string;
}

/** Límites de cada cantidad (lo que se puede escribir en el formulario). */
export const LIMITS: Record<DiscountUnit, { min: number; max: number }> = {
    cents: { min: 0.1, max: 100 },
    percent: { min: 0.1, max: 50 },
};

const FUELS = new Set<string>(['sp95', 'sp95Premium', 'sp98', 'diesel', 'dieselPremium', 'dieselB', 'glp', 'gnc', 'gnl', 'hydrogen']);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

/** Descuento bien formado (lo guardado pudo cambiarse a mano o venir de otra versión). */
function parse(x: unknown): Discount | null {
    const d = x as Partial<Discount>;
    if (!d || typeof d.id !== 'string' || typeof d.name !== 'string') return null;
    if (d.kind !== 'direct' && d.kind !== 'balance') return null;
    if (d.unit !== 'cents' && d.unit !== 'percent') return null;
    const { min, max } = LIMITS[d.unit];
    if (typeof d.value !== 'number' || !(d.value >= min && d.value <= max)) return null;
    const brands = strings(d.brands);
    const stations = strings(d.stations);
    if (!brands.length && !stations.length) return null;
    return {
        id: d.id,
        name: d.name.slice(0, 60),
        kind: d.kind,
        unit: d.unit,
        value: d.value,
        brands,
        stations,
        fuels: strings(d.fuels).filter((f) => FUELS.has(f)) as FuelType[],
        ...(typeof d.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.until) ? { until: d.until } : {}),
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
        updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date().toISOString(),
    };
}

export function getDiscounts(): Discount[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(KEY);
        const data = raw ? JSON.parse(raw) : null;
        const items: unknown[] = Array.isArray(data?.items) ? data.items : [];
        return items.map(parse).filter((d): d is Discount => d !== null);
    } catch {
        return [];
    }
}

function save(list: Discount[]): void {
    try {
        if (list.length) localStorage.setItem(KEY, JSON.stringify({ v: VERSION, items: list }));
        else localStorage.removeItem(KEY);
    } catch {
        // Sin almacenamiento (modo privado estricto): viven solo en esta página.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: list }));
}

const newId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type DiscountInput = Omit<Discount, 'id' | 'createdAt' | 'updatedAt'>;

/** Crea un descuento o, con `id`, cambia uno que ya existe. Devuelve el guardado. */
export function saveDiscount(input: DiscountInput, id?: string): Discount {
    const list = getDiscounts();
    const now = new Date().toISOString();
    const prev = id ? list.find((d) => d.id === id) : undefined;
    if (!prev && list.length >= MAX_DISCOUNTS) throw new Error(`Puedes guardar hasta ${MAX_DISCOUNTS} descuentos.`);
    const discount = parse({ ...input, id: prev?.id ?? newId(), createdAt: prev?.createdAt ?? now, updatedAt: now });
    if (!discount) throw new Error('Revisa el descuento: falta algún dato.');
    save(prev ? list.map((d) => (d.id === prev.id ? discount : d)) : [...list, discount]);
    if (!prev) track('crear_descuento', { tipo: discount.kind, unidad: discount.unit, marcas: discount.brands.length, gasolineras: discount.stations.length });
    return discount;
}

export function deleteDiscount(id: string): void {
    save(getDiscounts().filter((d) => d.id !== id));
    track('borrar_descuento');
}

/** Suscribe a cambios en la lista (misma pestaña y otras pestañas). */
export function onDiscountsChange(cb: (list: Discount[]) => void): () => void {
    const onEvent = (e: Event) => cb((e as CustomEvent<Discount[]>).detail ?? getDiscounts());
    const onStorage = (e: StorageEvent) => {
        if (e.key === KEY || e.key === null) cb(getDiscounts());
    };
    window.addEventListener(EVENT, onEvent);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(EVENT, onEvent);
        window.removeEventListener('storage', onStorage);
    };
}

/** Hoy en AAAA-MM-DD (hora de España no importa: un día de margen da igual aquí). */
const today = () => new Date().toISOString().slice(0, 10);

export const isExpired = (d: Discount, day = today()) => !!d.until && d.until < day;

/** Los descuentos que valen hoy en esa gasolinera para ese combustible. */
export function discountsFor(list: Discount[], station: DiscountTarget, fuel: FuelType): Discount[] {
    const day = today();
    return list.filter(
        (d) =>
            !isExpired(d, day) &&
            (d.stations.includes(station.id) || d.brands.includes(station.brand)) &&
            (!d.fuels.length || d.fuels.includes(fuel))
    );
}

export interface MyPrice {
    /** Lo que se paga en el surtidor (con los descuentos directos): el precio que se enseña. */
    pay: number;
    /** Cuánto baja el precio con los descuentos directos (0 si no hay). */
    direct: number;
    /** Lo que vuelve después al saldo por litro (o kilo): solo una anotación. */
    balance: number;
    /** Los descuentos aplicados. */
    applied: Discount[];
}

/**
 * Precio con los descuentos que se apliquen. Si hay varios se suman: primero los
 * directos (los fijos y después los porcentajes, sobre lo que queda); el saldo se
 * calcula sobre lo que se paga y no se resta. Sin ninguno, `undefined`.
 */
export function myPrice(price: number, applied: Discount[]): MyPrice | undefined {
    if (!applied.length) return undefined;
    const direct = applied.filter((d) => d.kind === 'direct');
    let pay = price - direct.filter((d) => d.unit === 'cents').reduce((a, d) => a + d.value / 100, 0);
    for (const d of direct.filter((x) => x.unit === 'percent')) pay *= 1 - d.value / 100;
    pay = Math.max(0, pay);
    const balance = applied
        .filter((d) => d.kind === 'balance')
        .reduce((a, d) => a + (d.unit === 'cents' ? d.value / 100 : (pay * d.value) / 100), 0);
    return { pay, direct: price - pay, balance, applied };
}

/** Atajo: precio para mí de una gasolinera y combustible con la lista guardada. */
export const myPriceAt = (list: Discount[], station: DiscountTarget, fuel: FuelType, price: number | undefined | null) =>
    price == null ? undefined : myPrice(price, discountsFor(list, station, fuel));

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

/** "5 cént./L directo", "3 % en saldo". */
export function discountLabel(d: Pick<Discount, 'kind' | 'unit' | 'value'>): string {
    const amount = d.unit === 'cents' ? `${nf.format(d.value)} cént./L` : `${nf.format(d.value)} %`;
    return `${amount} ${d.kind === 'direct' ? 'directo' : 'en saldo'}`;
}

/** Céntimos con un decimal como mucho: 0.0545 → "5,5". */
export const shortCents = (x: number) => nf.format(Math.round(x * 1000) / 10);
const centsText = (x: number) => `${shortCents(x)} cént.`;

/** Si los descuentos directos bajan el precio (si no, se enseña el de surtidor). */
export const hasDirect = (mine: MyPrice) => mine.direct >= 0.0005;
/** Si algo vuelve al saldo. */
export const hasBalance = (mine: MyPrice) => mine.balance >= 0.0005;

/** "−5 cént. directo". */
export const directText = (mine: MyPrice) => `−${centsText(mine.direct)} directo`;
/** "+5,4 cént./L a tu saldo". */
export const balanceText = (mine: MyPrice) => `+${centsText(mine.balance)}/L a tu saldo`;

/** Todo en una línea, para títulos: "Waylet + Empresa: −5 cént. directo · +5,4 cént./L a tu saldo". */
export function bonusSummary(mine: MyPrice): string {
    const parts = [hasDirect(mine) ? directText(mine) : '', hasBalance(mine) ? balanceText(mine) : ''].filter(Boolean);
    return `${mine.applied.map((d) => d.name).join(' + ')}: ${parts.join(' · ')}`;
}
