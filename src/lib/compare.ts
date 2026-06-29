/**
 * Lista de comparación: estaciones que el usuario ha marcado para comparar.
 *
 * Se guarda en localStorage (sin backend) como un array de IDs y se sincroniza
 * entre islas (explorador, botón de comparar, página /comparador) mediante un
 * CustomEvent. También responde a cambios desde otras pestañas (evento storage).
 */
const KEY = 'octo-compare';
const EVENT = 'octo-compare-change';

/** Máximo de estaciones que se pueden comparar a la vez. */
export const MAX_COMPARE = 4;

export function getCompareIds(): string[] {
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
    localStorage.setItem(KEY, JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: ids }));
}

export function isInCompare(id: string): boolean {
    return getCompareIds().includes(id);
}

/**
 * Añade o quita una estación de la comparación.
 * Devuelve si quedó añadida y si la lista estaba llena (no se pudo añadir).
 */
export function toggleCompare(id: string): { added: boolean; full: boolean } {
    const ids = getCompareIds();
    const idx = ids.indexOf(id);
    if (idx >= 0) {
        ids.splice(idx, 1);
        save(ids);
        return { added: false, full: false };
    }
    if (ids.length >= MAX_COMPARE) {
        return { added: false, full: true };
    }
    ids.push(id);
    save(ids);
    return { added: true, full: false };
}

export function addToCompare(id: string): { added: boolean; full: boolean } {
    const ids = getCompareIds();
    if (ids.includes(id)) return { added: true, full: false };
    if (ids.length >= MAX_COMPARE) return { added: false, full: true };
    ids.push(id);
    save(ids);
    return { added: true, full: false };
}

export function removeFromCompare(id: string): void {
    save(getCompareIds().filter((x) => x !== id));
}

export function clearCompare(): void {
    save([]);
}

/** Suscribe a cambios en la lista (misma pestaña y otras pestañas). */
export function onCompareChange(cb: (ids: string[]) => void): () => void {
    const onEvent = (e: Event) => cb((e as CustomEvent<string[]>).detail ?? getCompareIds());
    const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) cb(getCompareIds());
    };
    window.addEventListener(EVENT, onEvent);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(EVENT, onEvent);
        window.removeEventListener('storage', onStorage);
    };
}
