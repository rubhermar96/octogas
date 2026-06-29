import React, { useState, useRef, useEffect } from 'react';
import { searchPlaces, type GeoResult } from '../../lib/route';
import styles from './PlaceInput.module.css';

export interface PlaceValue {
    text: string;
    lat?: number;
    lng?: number;
}

interface Props {
    value: PlaceValue;
    onChange: (v: PlaceValue) => void;
    placeholder?: string;
}

const PlaceInput: React.FC<Props> = ({ value, onChange, placeholder }) => {
    const [open, setOpen] = useState(false);
    const [results, setResults] = useState<GeoResult[]>([]);
    const [loading, setLoading] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const handleType = (text: string) => {
        onChange({ text }); // al escribir se borran las coordenadas elegidas
        setOpen(true);
        if (debounce.current) clearTimeout(debounce.current);
        if (text.trim().length < 3) {
            setResults([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        debounce.current = setTimeout(async () => {
            const r = await searchPlaces(text, 6);
            setResults(r);
            setLoading(false);
        }, 350);
    };

    const pick = (g: GeoResult) => {
        onChange({ text: g.label, lat: g.lat, lng: g.lng });
        setResults([]);
        setOpen(false);
    };

    const picked = value.lat != null && value.lng != null;

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <input
                className={styles.input}
                value={value.text}
                placeholder={placeholder}
                onChange={(e) => handleType(e.target.value)}
                onFocus={() => results.length > 0 && setOpen(true)}
            />
            {picked && <span className={`material-symbols-outlined ${styles.check}`}>check_circle</span>}

            {open && (loading || results.length > 0) && (
                <ul className={styles.dropdown}>
                    {loading && <li className={styles.info}>Buscando…</li>}
                    {!loading &&
                        results.map((r, i) => (
                            <li key={i} className={styles.item} onClick={() => pick(r)}>
                                <span className="material-symbols-outlined">place</span>
                                <span className={styles.label}>{r.label}</span>
                            </li>
                        ))}
                    {!loading && results.length === 0 && <li className={styles.info}>Sin resultados</li>}
                </ul>
            )}
        </div>
    );
};

export default PlaceInput;
