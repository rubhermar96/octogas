/**
 * Acciones que se miden en Google Analytics 4, además de las visitas: guardar una
 * gasolinera, compararla, activar avisos o instalar la app. Solo envía algo si el
 * usuario aceptó las cookies de Analytics (ConsentBanner.astro carga entonces gtag);
 * si no, no hace nada.
 */
type Gtag = (command: 'event', name: string, params?: Record<string, string | number | boolean>) => void;

export function track(name: string, params?: Record<string, string | number | boolean>): void {
    if (typeof window === 'undefined') return;
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (typeof gtag === 'function') gtag('event', name, params);
}
