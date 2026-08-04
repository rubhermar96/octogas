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
    /** id del <input> interno, para asociarlo a una <label htmlFor>. */
    id?: string;
    /** Etiqueta accesible cuando no hay <label> visible (p. ej. paradas dinámicas). */
    ariaLabel?: string;
    /** Si se pasa, muestra un botón para elegir el punto directamente en el mapa. */
    onMapPick?: () => void;
}

const PlaceInput: React.FC<Props> = ({ value, onChange, placeholder, id, ariaLabel, onMapPick }) => {
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
                id={id}
                aria-label={ariaLabel}
                className={styles.input}
                value={value.text}
                placeholder={placeholder}
                onChange={(e) => handleType(e.target.value)}
                onFocus={() => (onMapPick || results.length > 0) && setOpen(true)}
            />
            {picked && <span className={`material-symbols-outlined ${styles.check}`} aria-hidden="true">check_circle</span>}

            {open && (loading || results.length > 0 || onMapPick) && (
                <ul className={styles.dropdown}>
                    {/* Opción fija: elegir el punto exacto tocando el mapa. */}
                    {onMapPick && (
                        <li
                            className={`${styles.item} ${styles.mapOption}`}
                            onClick={() => {
                                setOpen(false);
                                onMapPick();
                            }}
                        >
                            <span className="material-symbols-outlined" aria-hidden="true">map</span>
                            <span className={styles.label}>Elegir en el mapa</span>
                        </li>
                    )}
                    {loading && <li className={styles.info}>Buscando…</li>}
                    {!loading &&
                        results.map((r, i) => (
                            <li key={i} className={styles.item} onClick={() => pick(r)}>
                                <span className="material-symbols-outlined" aria-hidden="true">place</span>
                                <span className={styles.label}>{r.label}</span>
                            </li>
                        ))}
                    {!loading && results.length === 0 && value.text.trim().length >= 3 && (
                        <li className={styles.info}>Sin resultados</li>
                    )}
                </ul>
            )}
        </div>
    );
};

export default PlaceInput;
