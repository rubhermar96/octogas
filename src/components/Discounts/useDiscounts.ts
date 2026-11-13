import { useEffect, useState } from 'react';
import { getDiscounts, onDiscountsChange, type Discount } from '../../lib/discounts';

/** Descuentos guardados en este dispositivo, al día (lib/discounts.ts). Vacío hasta montar. */
export function useDiscounts(): Discount[] {
    const [list, setList] = useState<Discount[]>([]);
    useEffect(() => {
        setList(getDiscounts());
        return onDiscountsChange(setList);
    }, []);
    return list;
}
