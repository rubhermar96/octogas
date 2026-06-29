import { useEffect, useState } from 'react';
import { getCompareIds, onCompareChange } from './compare';

/** Devuelve los IDs en comparación y se actualiza al cambiar la lista. */
export function useCompareIds(): string[] {
    const [ids, setIds] = useState<string[]>([]);

    useEffect(() => {
        setIds(getCompareIds()); // hidratación en cliente (evita desajuste SSR)
        return onCompareChange(setIds);
    }, []);

    return ids;
}
