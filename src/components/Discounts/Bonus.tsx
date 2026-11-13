import React from 'react';
import { balanceText, bonusSummary, directText, hasBalance, hasDirect, type MyPrice } from '../../lib/discounts';
import styles from './Bonus.module.css';

interface Props {
    /** Precio de surtidor. */
    price: number;
    mine: MyPrice;
    /** Sin el desglose de lo directo (sitios estrechos). */
    compact?: boolean;
}

/**
 * Debajo de un precio con Mis descuentos. Con descuentos directos (el precio ya es el
 * bonificado): la etiqueta "Bonificado", cuánto baja y el de surtidor tachado. Con saldo:
 * una anotación de lo que te devuelven, que no cambia el precio porque se paga entero.
 */
const Bonus: React.FC<Props> = ({ price, mine, compact = false }) => (
    <span className={styles.bonus} title={bonusSummary(mine)}>
        {hasDirect(mine) && (
            <>
                <span className={styles.tag}>Bonificado</span>
                {!compact && <span className={styles.parts}>{directText(mine)}</span>}
                <span className={styles.pump}>
                    Surtidor <s>{price.toFixed(3)}</s>
                </span>
            </>
        )}
        {hasBalance(mine) && (
            <span className={styles.balance}>
                <span className="material-symbols-outlined" aria-hidden="true">savings</span>
                {balanceText(mine)}
            </span>
        )}
    </span>
);

export default Bonus;
