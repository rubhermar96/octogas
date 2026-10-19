/**
 * "Mis gasolineras": las que el usuario guarda para ver su precio de un vistazo.
 *
 * Igual que la comparación (compare.ts): array de IDs en localStorage, sin cuentas
 * ni backend, sincronizado entre islas y páginas con un CustomEvent y entre pestañas
 * con el evento storage. Aquí vive también "mi combustible", el que se destaca.
 */
import type { FuelType } from '../types/gasolinera';
import { track } from './track';

const KEY = 'octo-favorites';
const EVENT = 'octo-favorites-change';
const FUEL_KEY = 'octo-fuel';

/** Máximo de gasolineras guardadas. */
export const MAX_FAVORITES = 12;

export function getFavoriteIds(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

function save(ids: string[]): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
        // Sin almacenamiento (modo privado estricto): la lista vive solo en esta página.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: ids }));
    // Con un aviso de precio activo, la API pasa a vigilar la lista nueva (alerts.ts, que
    // solo se descarga si hay aviso).
    try {
        if (localStorage.getItem('octo-alert')) void import('./alerts').then((m) => m.syncAlertStations(ids));
    } catch {}
}

/** Guarda o quita una gasolinera. Devuelve si quedó guardada y si la lista estaba llena. */
export function toggleFavorite(id: string): { added: boolean; full: boolean } {
    const ids = getFavoriteIds();
    const idx = ids.indexOf(id);
    if (idx >= 0) {
        ids.splice(idx, 1);
        save(ids);
        track('quitar_gasolinera', { station_id: id });
        return { added: false, full: false };
    }
    if (ids.length >= MAX_FAVORITES) return { added: false, full: true };
    ids.push(id);
    save(ids);
    track('guardar_gasolinera', { station_id: id });
    return { added: true, full: false };
}

export function removeFavorite(id: string): void {
    save(getFavoriteIds().filter((x) => x !== id));
}

/** Suscribe a cambios en la lista (misma pestaña y otras pestañas). */
export function onFavoritesChange(cb: (ids: string[]) => void): () => void {
    const onEvent = (e: Event) => cb((e as CustomEvent<string[]>).detail ?? getFavoriteIds());
    const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) cb(getFavoriteIds());
    };
    window.addEventListener(EVENT, onEvent);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(EVENT, onEvent);
        window.removeEventListener('storage', onStorage);
    };
}

/** Combustible que se destaca en "Mis gasolineras" (por defecto, gasolina 95). */
export function getMyFuel(): FuelType {
    try {
        return (localStorage.getItem(FUEL_KEY) as FuelType | null) ?? 'sp95';
    } catch {
        return 'sp95';
    }
}

export function setMyFuel(fuel: FuelType): void {
    try {
        localStorage.setItem(FUEL_KEY, fuel);
    } catch {}
}

/** Datos de una gasolinera para "Mis gasolineras" (/data/estaciones/{id}.json). */
export interface FavoriteStation {
    id: string;
    name: string;
    brand: string;
    address: string;
    city: string;
    province: string;
    url: string;
    schedule: string;
    prices: Partial<Record<FuelType, number>>;
    lat: number;
    lng: number;
    /** Solo si hoy no ha publicado precios: último día (AAAA-MM-DD) en que lo hizo. */
    lastSeen?: string;
}

/** Descarga los datos de hoy de cada gasolinera guardada (las que ya no existen, fuera). */
export async function loadFavoriteStations(ids: string[]): Promise<FavoriteStation[]> {
    const res = await Promise.all(
        ids.map(async (id) => {
            try {
                const r = await fetch(`/data/estaciones/${encodeURIComponent(id)}.json`);
                return r.ok ? ((await r.json()) as FavoriteStation) : null;
            } catch {
                return null;
            }
        })
    );
    return res.filter((s): s is FavoriteStation => s !== null);
}
