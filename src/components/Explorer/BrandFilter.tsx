import React, { useState, useMemo, useRef, useEffect } from 'react';
import styles from './BrandFilter.module.css';

export interface BrandOption {
    brand: string;
    count: number;
}

interface BrandFilterProps {
    options: BrandOption[];
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
}

const BrandFilter: React.FC<BrandFilterProps> = ({ options, selected, onChange }) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        return q ? options.filter((o) => o.brand.toLowerCase().includes(q)) : options;
    }, [options, search]);

    // Limitamos las opciones renderizadas (hay miles de independientes); el resto se encuentra buscando.
    const MAX_VISIBLE = 60;
    const visible = filtered.slice(0, MAX_VISIBLE);
    const hiddenCount = filtered.length - visible.length;

    const toggle = (brand: string) => {
        const next = new Set(selected);
        if (next.has(brand)) next.delete(brand);
        else next.add(brand);
        onChange(next);
    };

    const summary = selected.size === 0 ? 'Todas' : `${selected.size} seleccionada${selected.size > 1 ? 's' : ''}`;

    return (
        <div className={styles.wrapper} ref={wrapperRef}>
            <button type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)}>
                <span className="material-symbols-outlined">local_gas_station</span>
                <span className={styles.summary}>{summary}</span>
                <span className={`material-symbols-outlined ${styles.chevron}`}>expand_more</span>
            </button>

            {open && (
                <div className={styles.dropdown}>
                    <input
                        className={styles.search}
                        placeholder="Buscar marca…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        autoFocus
                    />
                    {selected.size > 0 && (
                        <button type="button" className={styles.clear} onClick={() => onChange(new Set())}>
                            Quitar filtro (ver todas)
                        </button>
                    )}
                    <ul className={styles.list}>
                        {visible.map((o) => (
                            <li key={o.brand} className={styles.item} onClick={() => toggle(o.brand)}>
                                <input type="checkbox" checked={selected.has(o.brand)} readOnly />
                                <span className={styles.brandName}>{o.brand}</span>
                                <span className={styles.count}>{o.count}</span>
                            </li>
                        ))}
                        {filtered.length === 0 && <li className={styles.empty}>Sin resultados</li>}
                        {hiddenCount > 0 && (
                            <li className={styles.empty}>y {hiddenCount} más… escribe para buscar</li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default BrandFilter;
