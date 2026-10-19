/**
 * Avisos de precio de "Mis gasolineras" en el navegador: suscripción push (con el
 * service worker de /sw.js) y alta, cambio o baja en la API (api/src/routes/alerts.ts).
 * Lo elegido (combustible, tipo de aviso de bajadas y resumen) se recuerda aquí para
 * enseñarlo; la API guarda además las gasolineras y avisa tras cada actualización.
 */
import type { FuelType } from '../types/gasolinera';
import { track } from './track';

const API = (import.meta.env.PUBLIC_API_BASE_URL as string | undefined) || 'http://localhost:3001';
const KEY = 'octo-alert';

export interface AlertConfig {
    fuel: FuelType;
    /** Bajadas de precio: automático (según el historial de cada gasolinera) o ninguno. */
    mode: 'auto' | 'none';
    /** Resumen de la más barata: ninguno, diario o semanal (el `digestDay`, 0 domingo … 6 sábado). */
    digest: 'none' | 'daily' | 'weekly';
    digestDay?: number;
}

export function pushSupported(): boolean {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getAlertConfig(): AlertConfig | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        // Los de la primera versión (combustible y precio máximo) pasan a automático.
        const cfg = JSON.parse(raw) as { fuel: FuelType; mode?: string; digest?: AlertConfig['digest']; digestDay?: number };
        return {
            fuel: cfg.fuel,
            mode: cfg.mode === 'none' ? 'none' : 'auto',
            digest: cfg.digest ?? 'none',
            ...(cfg.digest === 'weekly' ? { digestDay: cfg.digestDay ?? 1 } : {}),
        };
    } catch {
        return null;
    }
}

function setAlertConfig(cfg: AlertConfig | null) {
    try {
        if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
        else localStorage.removeItem(KEY);
    } catch {}
}

/** Clave pública VAPID (base64url) a los bytes que pide pushManager.subscribe. */
function keyBytes(base64url: string): Uint8Array {
    const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Suscripción push de este navegador; con `create`, la crea si no existe. */
async function getSubscription(create: boolean): Promise<PushSubscription | null> {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub || !create) return sub;
    const res = await fetch(`${API}/api/alerts/key`);
    if (!res.ok) throw new Error('Los avisos no están disponibles ahora mismo.');
    const { publicKey } = (await res.json()) as { publicKey: string };
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
}

async function send(method: 'PUT' | 'DELETE', path: string, body: unknown) {
    const res = await fetch(`${API}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.status === 429 ? 'Demasiados intentos: prueba en un minuto.' : 'No se pudo guardar el aviso.');
    return res.json();
}

/** Activa o cambia los avisos. Pide permiso de notificaciones (llamar desde un clic). */
export async function saveAlert(cfg: AlertConfig, stationIds: string[]): Promise<void> {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('permission');
    const sub = await getSubscription(true);
    if (!sub) throw new Error('No se pudo activar las notificaciones.');
    await send('PUT', '/alerts', { subscription: sub.toJSON(), ...cfg, stationIds });
    setAlertConfig(cfg);
    track('activar_aviso', { fuel: cfg.fuel, bajadas: cfg.mode, resumen: cfg.digest, gasolineras: stationIds.length });
}

/** Desactiva el aviso y la suscripción de este navegador. */
export async function deleteAlert(): Promise<void> {
    const sub = await getSubscription(false).catch(() => null);
    if (sub) {
        await send('DELETE', '/alerts', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
    }
    setAlertConfig(null);
    track('desactivar_aviso');
}

/** Tras guardar o quitar gasolineras: el aviso pasa a vigilar la lista nueva. */
export async function syncAlertStations(stationIds: string[]): Promise<void> {
    const cfg = getAlertConfig();
    if (!cfg || !pushSupported()) return;
    if (!stationIds.length) return deleteAlert();
    const sub = await getSubscription(false).catch(() => null);
    if (!sub) return setAlertConfig(null);
    await send('PUT', '/alerts', { subscription: sub.toJSON(), ...cfg, stationIds }).catch(() => {});
}
