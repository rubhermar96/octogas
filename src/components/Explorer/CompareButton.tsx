import React from 'react';
import { toggleCompare, MAX_COMPARE } from '../../lib/compare';
import { useCompareIds } from '../../lib/useCompare';
import styles from './CompareButton.module.css';

interface CompareButtonProps {
    stationId: string;
    /**
     * 'card' (botón con texto), 'icon' (compacto, para el popup del mapa) o
     * 'mini' (muy pequeño, para ir bajo el nombre de la estación).
     */
    variant?: 'card' | 'icon' | 'mini';
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
    const variantClass = variant === 'icon' ? styles.icon : variant === 'mini' ? styles.mini : '';

    return (
        <button
            className={`${styles.btn} ${variantClass} ${inCompare ? styles.active : ''}`}
            onClick={handleClick}
            disabled={full}
            title={full ? `Máximo ${MAX_COMPARE} gasolineras` : label}
            aria-pressed={inCompare}
        >
            <span className="material-symbols-outlined">
                {inCompare ? 'check' : 'balance'}
            </span>
            {variant === 'card' && <span>{label}</span>}
            {variant === 'mini' && <span>{inCompare ? 'Comparando' : 'Comparar'}</span>}
        </button>
    );
};

export default CompareButton;
