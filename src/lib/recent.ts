/**
 * "Vistas recientemente": las últimas fichas, municipios y provincias abiertos en este
 * navegador, para volver a ellos desde el buscador de la cabecera o la fila de
 * components/Recent/RecentStrip.astro.
 *
 * Como "Mis gasolineras" (favorites.ts): en localStorage, sin cuentas ni servidor,
 * sincronizado con un CustomEvent en la misma pestaña y con el evento storage entre
 * pestañas.
 */
const KEY = 'octo-recent';
const EVENT = 'octo-recent-change';

/** Cuántas se recuerdan. */
export const MAX_RECENT = 10;

export type RecentKind = 'gasolinera' | 'municipio' | 'provincia';

export interface RecentItem {
    kind: RecentKind;
    url: string;
    title: string;
    sub: string;
    /** Gasolineras: su id, para enseñar el precio de hoy (/data/estaciones/{id}.json). */
    id?: string;
}

const KINDS = new Set<string>(['gasolinera', 'municipio', 'provincia']);

const isItem = (x: unknown): x is RecentItem => {
    const r = x as RecentItem;
    return !!r && KINDS.has(r.kind) && typeof r.url === 'string' && r.url.startsWith('/') && typeof r.title === 'string' && typeof r.sub === 'string';
};

export function getRecent(): RecentItem[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(isItem) : [];
    } catch {
        return [];
    }
}

function save(list: RecentItem[]): void {
    try {
        if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
        else localStorage.removeItem(KEY);
    } catch {
        // Sin almacenamiento (modo privado estricto): no se recuerda nada.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: list }));
}

/** Apunta una página vista (la más reciente, primero). */
export function addRecent(item: RecentItem): void {
    if (!isItem(item)) return;
    save([item, ...getRecent().filter((r) => r.url !== item.url)].slice(0, MAX_RECENT));
}

export function clearRecent(): void {
    save([]);
}

/** Suscribe a cambios en la lista (misma pestaña y otras pestañas). */
export function onRecentChange(cb: (list: RecentItem[]) => void): () => void {
    const onEvent = (e: Event) => cb((e as CustomEvent<RecentItem[]>).detail ?? getRecent());
    const onStorage = (e: StorageEvent) => {
        if (e.key === KEY || e.key === null) cb(getRecent());
    };
    window.addEventListener(EVENT, onEvent);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(EVENT, onEvent);
        window.removeEventListener('storage', onStorage);
    };
}
