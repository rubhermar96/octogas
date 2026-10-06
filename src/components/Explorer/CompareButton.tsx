import React from 'react';
import { toggleCompare, MAX_COMPARE } from '../../lib/compare';
import { useCompareIds } from '../../lib/useCompare';
import styles from './CompareButton.module.css';

export type CompareVariant = 'card' | 'icon' | 'mini' | 'square' | 'large';

interface CompareButtonProps {
    stationId: string;
    /**
     * 'card' (botón con texto), 'icon' (compacto, para el popup del mapa),
     * 'mini' (muy pequeño, para ir bajo el nombre de la estación), 'square'
     * (solo icono, al final de una fila de listado) o 'large' (botón principal,
     * junto a "Cómo llegar").
     */
    variant?: CompareVariant;
}

/**
 * Botón para añadir/quitar una estación de la comparación.
 * Sincroniza su estado con el resto de islas vía localStorage + evento.
 */
const CompareButton: React.FC<CompareButtonProps> = ({ stationId, variant = 'card' }) => {
    const ids = useCompareIds();
    const inCompare = ids.includes(stationId);
    const full = !inCompare && ids.length >= MAX_COMPARE;

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        const res = toggleCompare(stationId);
        if (res.full) {
            alert(`Solo puedes comparar ${MAX_COMPARE} gasolineras a la vez. Quita alguna en el comparador.`);
        }
    };

    const label = inCompare ? 'En comparador' : 'Comparar';
    const variantClass = variant === 'card' ? '' : styles[variant];

    return (
        <button
            className={`${styles.btn} ${variantClass} ${inCompare ? styles.active : ''}`}
            onClick={handleClick}
            disabled={full}
            title={full ? `Máximo ${MAX_COMPARE} gasolineras` : label}
            aria-label={inCompare ? 'Quitar del comparador' : 'Añadir al comparador'}
            aria-pressed={inCompare}
        >
            <span className="material-symbols-outlined" aria-hidden="true">
                {inCompare ? 'check' : 'balance'}
            </span>
            {(variant === 'card' || variant === 'large') && <span>{label}</span>}
            {variant === 'mini' && <span>{inCompare ? 'Comparando' : 'Comparar'}</span>}
        </button>
    );
};

export default CompareButton;
