/**
 * Avisos de "Mis gasolineras": piezas comunes de la API (alta y baja de avisos) y del
 * envío (send.ts, tras cada ingesta).
 *
 * Cada aviso es de un navegador (su suscripción push): un combustible, las gasolineras
 * guardadas y qué quiere recibir: bajadas de precio (automático, según el historial de
 * cada gasolinera) y un resumen diario o semanal de la más barata.
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

// --- Aviso automático: bajadas que merecen la pena según el historial ---

const DAY = 86_400_000;
/** Días de historial con los que se compara. */
const WINDOW_DAYS = 30;
/** Días con precio conocido que hacen falta para juzgar (si no, no se avisa). */
const MIN_SAMPLES = 20;
/** "Muy por debajo de lo habitual": céntimos bajo la mediana del último mes. */
const BELOW_TYPICAL = 0.0395;
/** Entre dos avisos automáticos del mismo navegador. */
export const AUTO_COOLDOWN_MS = 3 * DAY;

/** Cambios de precio de una gasolinera en un combustible, del más antiguo al más reciente. */
export type History = { t: number; price: number }[];

/** Precio vigente en el instante `t` (el último cambio anterior), si se conoce. */
export function priceAt(history: History, t: number): number | undefined {
    let found: number | undefined;
    for (const h of history) {
        if (h.t > t) break;
        found = h.price;
    }
    return found;
}

/**
 * Lo más barato y el precio habitual (mediana de un precio por día) de los últimos 30
 * días, sin contar hoy. Sin historial suficiente, undefined: mejor no avisar que
 * comparar con dos días de datos.
 */
export function monthStats(history: History, now: number): { min: number; typical: number } | undefined {
    const start = now - WINDOW_DAYS * DAY;
    const end = now - 12 * 3600_000; // excluye el precio recién publicado
    const daily: number[] = [];
    for (let d = 1; d <= WINDOW_DAYS; d++) {
        const p = priceAt(history, now - d * DAY);
        if (p != null) daily.push(p);
    }
    if (daily.length < MIN_SAMPLES) return undefined;
    // El mínimo incluye los cambios que duraron menos de un día.
    const inWindow = history.filter((h) => h.t > start && h.t <= end).map((h) => h.price);
    const atStart = priceAt(history, start);
    const min = Math.min(...daily, ...inWindow, ...(atStart != null ? [atStart] : []));
    const sorted = [...daily].sort((a, b) => a - b);
    const m = sorted.length >> 1;
    const typical = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
    return { min, typical };
}

export interface AutoCandidate {
    stationId: string;
    price: number;
    /** 'low': el precio más bajo en 30 días; 'below': muy por debajo de lo habitual. */
    reason: "low" | "below";
    typical: number;
}

/**
 * Aviso automático: de las gasolineras guardadas, las que hoy están a su precio más bajo
 * en 30 días (al menos 1 céntimo por debajo) o 4 céntimos o más por debajo de su precio
 * habitual, y no se avisaron ya a ese precio. La mejor oportunidad (más por debajo de lo
 * habitual) primero. Las que suben más de un céntimo sobre lo avisado se olvidan.
 */
export function evaluateAuto(
    alert: { stationIds: string[]; notified: Record<string, number> },
    prices: Map<string, number>,
    histories: Map<string, History>,
    now: number
): { candidates: AutoCandidate[]; notified: Record<string, number> } {
    const notified: Record<string, number> = {};
    const candidates: AutoCandidate[] = [];
    for (const id of alert.stationIds) {
        const price = prices.get(id);
        if (price == null) continue;
        const last = alert.notified[id];
        if (last != null && price <= last + STEP) notified[id] = last;
        const stats = monthStats(histories.get(id) ?? [], now);
        if (!stats) continue;
        const low = price <= stats.min - STEP;
        const below = price <= stats.typical - BELOW_TYPICAL;
        if (!low && !below) continue;
        if (notified[id] != null && price >= notified[id] - STEP) continue;
        candidates.push({ stationId: id, price, reason: low ? "low" : "below", typical: stats.typical });
    }
    candidates.sort((a, b) => b.typical - b.price - (a.typical - a.price));
    return { candidates, notified };
}

// --- Resumen diario o semanal ---

const madridParts = (t: number) =>
    Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" })
            .formatToParts(new Date(t))
            .map((p) => [p.type, p.value])
    );
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const madridDate = (t: number) => {
    const p = madridParts(t);
    return `${p.year}-${p.month}-${p.day}`;
};

/**
 * ¿Toca el resumen? Uno al día como mucho, en el primer refresco desde las 6:00 (hora
 * de Madrid; el temporizador refresca a las 7:00 y a las 15:00); el semanal, solo el
 * día elegido (0 domingo … 6 sábado).
 */
export function digestDue(
    alert: { digest: string; digestDay: number | null; lastDigestAt: Date | null },
    now: number
): boolean {
    if (alert.digest !== "daily" && alert.digest !== "weekly") return false;
    const p = madridParts(now);
    if (Number(p.hour) < 6) return false;
    if (alert.lastDigestAt && madridDate(alert.lastDigestAt.getTime()) === madridDate(now)) return false;
    return alert.digest === "daily" || WEEKDAYS.indexOf(p.weekday) === alert.digestDay;
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

const nf1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
/** "4 céntimos", "1 céntimo", "0,5 céntimos". */
export const centsText = (diff: number) => {
    const c = Math.round(Math.abs(diff) * 1000) / 10;
    return `${nf1.format(c)} ${c === 1 ? "céntimo" : "céntimos"}`;
};

/** Aviso automático: "Diésel a 1,659 €/L en Ballenoil (Laguna de Duero)" y el porqué. */
export function buildAutoMessage(fuel: FuelKey, c: AutoCandidate, label: string, cheapestOfYours: boolean): PushMessage {
    const under = c.typical - c.price;
    const why =
        c.reason === "low"
            ? `Su precio más bajo en 30 días${under >= STEP ? `: ${centsText(under)} menos de lo habitual` : ""}.`
            : `${centsText(under)} por debajo de su precio habitual (${priceText(fuel, c.typical)}).`;
    return {
        url: "/mis-gasolineras/",
        tag: "octo-precio",
        title: `${FUEL_NAMES[fuel]} a ${priceText(fuel, c.price)} en ${label}`,
        body: cheapestOfYours ? `${why} Es la más barata de tus gasolineras.` : why,
    };
}

/**
 * Resumen: la más barata de las guardadas para su combustible y cómo ha cambiado (desde
 * ayer o desde hace una semana). `rows`, de la más barata a la más cara.
 */
export function buildDigestMessage(
    fuel: FuelKey,
    kind: "daily" | "weekly",
    rows: { label: string; price: number; before?: number }[]
): PushMessage {
    const best = rows[0];
    const when = kind === "daily" ? "ayer" : "hace una semana";
    let change = "";
    if (best.before != null) {
        const d = best.price - best.before;
        change = Math.abs(d) < 0.0005 ? `igual que ${when}` : `${centsText(d)} ${d < 0 ? "menos" : "más"} que ${when}`;
    }
    const head = kind === "daily" ? "Hoy" : "Esta semana";
    const parts =
        rows.length === 1
            ? [`${FUEL_NAMES[fuel]}${change ? `: ${change}` : ""}.`]
            : [
                  `${FUEL_NAMES[fuel]}, la más barata de tus ${rows.length} gasolineras${change ? ` (${change})` : ""}.`,
                  `La más cara está a ${priceText(fuel, rows[rows.length - 1].price)}.`,
              ];
    return {
        url: "/mis-gasolineras/",
        tag: "octo-resumen",
        title: `${head}, ${best.label} a ${priceText(fuel, best.price)}`,
        body: parts.join(" "),
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
