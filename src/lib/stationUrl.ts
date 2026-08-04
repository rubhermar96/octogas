import { slugify } from './slug';
import { placeSlug } from './placeName';

/** Campos mínimos necesarios para construir la URL de una gasolinera (admite
 *  tanto un GasStation completo como un subconjunto ligero, p. ej. en tops). */
export interface StationLike {
    id: string;
    name?: string;
    brand: string;
    address: string;
    city: string;
    province: string;
}

/**
 * Slug estable y único de una ficha de gasolinera.
 * Combina marca/nombre + dirección (keywords) + id (garantiza unicidad dentro
 * del municipio aunque coincidan marca y calle).
 */
export function stationSlug(s: StationLike): string {
    const base = slugify(`${s.brand || s.name || 'gasolinera'} ${s.address || ''}`);
    return `${base}-${s.id}`.replace(/-+/g, '-');
}

/** Ruta canónica de la ficha de una gasolinera. */
export function stationUrl(s: StationLike): string {
    return `/gasolineras-baratas/${placeSlug(s.province)}/${placeSlug(s.city)}/${stationSlug(s)}`;
}

/** Ruta de la página de una provincia. */
export function provinceUrl(province: string): string {
    return `/gasolineras-baratas/${placeSlug(province)}`;
}

/** Ruta de la página de un municipio. */
export function municipioUrl(province: string, city: string): string {
    return `/gasolineras-baratas/${placeSlug(province)}/${placeSlug(city)}`;
}
