import type { GasStation } from '../types/gasolinera';
import { slugify } from './slug';

/**
 * Slug estable y único de una ficha de gasolinera.
 * Combina marca/nombre + dirección (keywords) + id (garantiza unicidad dentro
 * del municipio aunque coincidan marca y calle).
 */
export function stationSlug(s: GasStation): string {
    const base = slugify(`${s.brand || s.name || 'gasolinera'} ${s.address || ''}`);
    return `${base}-${s.id}`.replace(/-+/g, '-');
}

/** Ruta canónica de la ficha de una gasolinera. */
export function stationUrl(s: GasStation): string {
    return `/gasolineras-baratas/${slugify(s.province)}/${slugify(s.city)}/${stationSlug(s)}`;
}

/** Ruta de la página de una provincia. */
export function provinceUrl(province: string): string {
    return `/gasolineras-baratas/${slugify(province)}`;
}

/** Ruta de la página de un municipio. */
export function municipioUrl(province: string, city: string): string {
    return `/gasolineras-baratas/${slugify(province)}/${slugify(city)}`;
}
