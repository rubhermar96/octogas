/**
 * Avisos de precio de "Mis gasolineras": piezas comunes de la API (alta y baja de
 * avisos) y del envío (send.ts, tras cada ingesta).
 *
 * Cada aviso es de un navegador (su suscripción push): un combustible, un precio
 * máximo y las gasolineras guardadas. Se avisa cuando alguna está a ese precio o
 * menos; no se repite hasta que baja otro céntimo o vuelve a subir por encima.
 */
import webpush from "web-push";
import { normalizePlaceName } from "../lib/placeName";
import type { FuelKey } from "../db/schema";

/** Máximo de gasolineras por aviso (las que caben en Mis gasolineras). */
export const MAX_STATIONS = 12;
/** Bajada mínima para volver a avisar de una gasolinera ya avisada. */
const STEP = 0.0095;

/**
 * Servicios de push de los navegadores (Chrome/Edge/Android, Firefox, Safari/iPhone,
 * Windows). El servidor solo envía a estos: si no, cualquiera podría usar la API para
 * hacer peticiones a direcciones arbitrarias.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "web.push.apple.com", "notify.windows.com"];

export function isPushEndpoint(raw: unknown): raw is string {
    if (typeof raw !== "string" || raw.length > 1000) return false;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    return PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

/** Claves de la suscripción: base64url de 65 bytes (p256dh) y 16 bytes (auth). */
export const isKey = (raw: unknown, min: number, max: number): raw is string =>
    typeof raw === "string" && raw.length >= min && raw.length <= max && /^[A-Za-z0-9_-]+=*$/.test(raw);

// --- Claves VAPID (identifican a OCTO ante los servicios de push) ---
// En el .env de la API; deploy/update.sh las crea la primera vez.
export function vapidPublicKey(): string | undefined {
    return process.env.VAPID_PUBLIC_KEY || undefined;
}

let configured = false;
export function configureWebPush(): boolean {
    if (configured) return true;
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) return false;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contactaocto@gmail.com", pub, priv);
    configured = true;
    return true;
}

// --- Cuándo avisar ---

export interface Evaluation {
    /** Gasolineras de las que avisar ahora, de la más barata a la más cara. */
    toNotify: { stationId: string; price: number }[];
    /** Estado nuevo de lo avisado (se guarda aunque no haya aviso). */
    notified: Record<string, number>;
}

/**
 * Con los precios de hoy (`prices`, solo de este combustible): avisa de las que están
 * al precio máximo o menos y no se avisaron ya a ese precio (o uno céntimo más bajo).
 * Las que vuelven a estar por encima se olvidan, para avisar de nuevo si bajan.
 */
export function evaluate(
    alert: { maxPrice: number; stationIds: string[]; notified: Record<string, number> },
    prices: Map<string, number>
): Evaluation {
    const notified: Record<string, number> = {};
    const toNotify: Evaluation["toNotify"] = [];
    for (const id of alert.stationIds) {
        const price = prices.get(id);
        if (price == null || price > alert.maxPrice + 0.0005) continue;
        const last = alert.notified[id];
        if (last == null || price < last - STEP) {
            toNotify.push({ stationId: id, price });
            notified[id] = price;
        } else {
            notified[id] = last;
        }
    }
    toNotify.sort((a, b) => a.price - b.price);
    return { toNotify, notified };
}

// --- Texto de la notificación ---

export const FUEL_NAMES: Record<FuelKey, string> = {
    sp95: "Gasolina 95",
    sp95Premium: "Gasolina 95 premium",
    sp98: "Gasolina 98",
    diesel: "Diésel",
    dieselPremium: "Diésel premium",
    dieselB: "Gasóleo agrícola",
    glp: "GLP",
    gnc: "GNC",
    gnl: "GNL",
    hydrogen: "Hidrógeno",
};
const unit = (f: FuelKey) => (f === "gnc" || f === "gnl" || f === "hydrogen" ? "€/kg" : "€/L");
const nf3 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
export const priceText = (f: FuelKey, n: number) => `${nf3.format(n)} ${unit(f)}`;

/** "Ballenoil (Laguna de Duero)"; sin rótulo ("Nº 10.935"), "una gasolinera de Abengibre". */
export function stationLabel(s: { brand: string; city: string }): string {
    const city = normalizePlaceName(s.city);
    return /^n[ºo°]/i.test(s.brand) || /^\d/.test(s.brand) || !s.brand ? `una gasolinera de ${city}` : `${s.brand} (${city})`;
}

export interface PushMessage {
    title: string;
    body: string;
    url: string;
    tag: string;
}

export function buildMessage(
    fuel: FuelKey,
    maxPrice: number,
    found: { label: string; price: number }[],
    total: number
): PushMessage {
    const name = FUEL_NAMES[fuel];
    const best = found[0];
    const base = { url: "/mis-gasolineras/", tag: "octo-precio" };
    if (found.length === 1)
        return {
            ...base,
            title: `${name} a ${priceText(fuel, best.price)}`,
            body: `En ${best.label}: por debajo de tu aviso de ${priceText(fuel, maxPrice)}.`,
        };
    return {
        ...base,
        title: `${name} por debajo de ${priceText(fuel, maxPrice)} en ${found.length} de tus ${total} gasolineras`,
        body: `La más barata: ${best.label}, a ${priceText(fuel, best.price)}.`,
    };
}

export interface Subscription {
    endpoint: string;
    p256dh: string;
    auth: string;
}

/** Envía una notificación. "gone": la suscripción ya no existe (hay que borrarla). */
export async function sendPush(sub: Subscription, msg: PushMessage): Promise<"ok" | "gone" | "error"> {
    try {
        await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(msg),
            { TTL: 12 * 3600, urgency: "normal", topic: msg.tag }
        );
        return "ok";
    } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return "gone";
        console.warn(`[avisos] Envío fallido (${status ?? (err as Error).message}).`);
        return "error";
    }
}
