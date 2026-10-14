import React, { useEffect, useState } from 'react';
import { getFavoriteIds, onFavoritesChange, toggleFavorite, MAX_FAVORITES } from '../../lib/favorites';
import styles from './FavoriteButton.module.css';

export type FavoriteVariant = 'icon' | 'mini' | 'large';

/** IDs guardados, actualizados al cambiar la lista (en cliente; vacío al renderizar). */
export function useFavoriteIds(): string[] {
    const [ids, setIds] = useState<string[]>([]);
    useEffect(() => {
        setIds(getFavoriteIds());
        return onFavoritesChange(setIds);
    }, []);
    return ids;
}

/**
 * Guarda o quita una gasolinera de "Mis gasolineras". 'icon' para el popup del mapa,
 * 'mini' bajo el nombre en el listado del explorador, 'large' en la ficha.
 */
const FavoriteButton: React.FC<{ stationId: string; variant?: FavoriteVariant }> = ({ stationId, variant = 'mini' }) => {
    const ids = useFavoriteIds();
    const saved = ids.includes(stationId);

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (toggleFavorite(stationId).full) {
            alert(`Puedes guardar hasta ${MAX_FAVORITES} gasolineras. Quita alguna en Mis gasolineras.`);
        }
    };

    return (
        <button
            type="button"
            className={`${styles.btn} ${styles[variant]} ${saved ? styles.active : ''}`}
            onClick={handleClick}
            title={saved ? 'Guardada en Mis gasolineras' : 'Guardar en Mis gasolineras'}
            aria-label={saved ? 'Quitar de Mis gasolineras' : 'Guardar en Mis gasolineras'}
            aria-pressed={saved}
        >
            <span className="material-symbols-outlined" aria-hidden="true">
                {saved ? 'bookmark_added' : 'bookmark_add'}
            </span>
            {variant !== 'icon' && <span>{saved ? 'Guardada' : 'Guardar'}</span>}
        </button>
    );
};

export default FavoriteButton;
