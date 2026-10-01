import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { reverseGeocode, searchPlaces, type GeoResult } from '../../lib/route';
import styles from './MapPicker.module.css';

// Pin del punto elegido (divIcon propio: los iconos por defecto de Leaflet no
// cargan bien con el bundler y en el resto de mapas ya usamos divIcons).
const pickIcon = L.divIcon({
    className: 'octo-map-pick',
    html: `<div style="background:var(--primary,#34d399);width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
});

/** Captura los clics/toques sobre el mapa. */
const ClickCatcher: React.FC<{ onClick: (lat: number, lng: number) => void }> = ({ onClick }) => {
    useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
    return null;
};

/** Centra el mapa al elegir un resultado del buscador. */
const FlyTo: React.FC<{ target: { lat: number; lng: number } | null }> = ({ target }) => {
    const map = useMap();
    useEffect(() => {
        if (target) map.setView([target.lat, target.lng], 15);
    }, [target, map]);
    return null;
};

interface Props {
    /** Título del diálogo, p. ej. "Elegir origen en el mapa". */
    title: string;
    /** Coordenadas iniciales para centrar (si el campo ya tenía un punto). */
    initial?: { lat: number; lng: number } | null;
    onPick: (g: GeoResult) => void;
    onClose: () => void;
}

/**
 * Diálogo para elegir un punto exacto en el mapa (origen, destino o parada):
 * busca un lugar para volar hasta él y/o toca el mapa para afinar el pin.
 * Usa teselas OSM estándar (más detalle de calles y topónimos en idioma local
 * que el basemap del resto de la app) y etiqueta el punto con la dirección
 * aproximada vía geocodificación inversa (Photon).
 */
const MapPicker: React.FC<Props> = ({ title, initial, onPick, onClose }) => {
    const [point, setPoint] = useState<{ lat: number; lng: number } | null>(initial ?? null);
    const [label, setLabel] = useState('');
    const [loading, setLoading] = useState(false);
    // Buscador del diálogo (mismo autocompletado Photon que los campos del formulario).
    const [query, setQuery] = useState('');
    const [sResults, setSResults] = useState<GeoResult[]>([]);
    const [sLoading, setSLoading] = useState(false);
    const [sOpen, setSOpen] = useState(false);
    const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // ESC cierra primero los resultados del buscador; después, el diálogo.
            if (sOpen) setSOpen(false);
            else onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose, sOpen]);

    const coordsLabel = (p: { lat: number; lng: number }) =>
        `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

    const handleClick = async (lat: number, lng: number) => {
        const p = { lat, lng };
        setSOpen(false);
        setPoint(p);
        setLoading(true);
        const g = await reverseGeocode(lat, lng);
        setLabel(g?.label ?? coordsLabel(p));
        setLoading(false);
    };

    const handleSearchType = (text: string) => {
        setQuery(text);
        setSOpen(true);
        if (debounce.current) clearTimeout(debounce.current);
        if (text.trim().length < 3) {
            setSResults([]);
            setSLoading(false);
            return;
        }
        setSLoading(true);
        debounce.current = setTimeout(async () => {
            const r = await searchPlaces(text, 6);
            setSResults(r);
            setSLoading(false);
        }, 350);
    };

    // Elegir un resultado: coloca el pin ahí, vuela al lugar y deja afinar tocando.
    const pickSearchResult = (g: GeoResult) => {
        setPoint({ lat: g.lat, lng: g.lng });
        setLabel(g.label);
        setQuery(g.label);
        setFlyTarget({ lat: g.lat, lng: g.lng });
        setSOpen(false);
        setSResults([]);
    };

    const confirm = () => {
        if (!point) return;
        onPick({ lat: point.lat, lng: point.lng, label: label || coordsLabel(point) });
    };

    return (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={title}>
            <div className={styles.panel}>
                <div className={styles.head}>
                    <span className={styles.title}>{title}</span>
                    <button type="button" className={styles.close} onClick={onClose} aria-label="Cerrar">
                        <span className="material-symbols-outlined" aria-hidden="true">close</span>
                    </button>
                </div>
                <div className={styles.searchRow}>
                    <span className={`material-symbols-outlined ${styles.searchIcon}`} aria-hidden="true">search</span>
                    <input
                        className={styles.searchInput}
                        value={query}
                        placeholder="Busca un lugar y afina tocando el mapa…"
                        aria-label="Buscar lugar"
                        autoFocus
                        onChange={(e) => handleSearchType(e.target.value)}
                        onFocus={() => sResults.length > 0 && setSOpen(true)}
                    />
                    {sOpen && (sLoading || sResults.length > 0 || query.trim().length >= 3) && (
                        <ul className={styles.searchDropdown}>
                            {sLoading && <li className={styles.searchInfo}>Buscando…</li>}
                            {!sLoading &&
                                sResults.map((r, i) => (
                                    <li key={i} className={styles.searchItem} onClick={() => pickSearchResult(r)}>
                                        <span className="material-symbols-outlined" aria-hidden="true">place</span>
                                        <span className={styles.searchLabel}>{r.label}</span>
                                    </li>
                                ))}
                            {!sLoading && sResults.length === 0 && query.trim().length >= 3 && (
                                <li className={styles.searchInfo}>Sin resultados</li>
                            )}
                        </ul>
                    )}
                </div>
                <div className={styles.mapWrap}>
                    <MapContainer
                        center={initial ? [initial.lat, initial.lng] : [40.2, -3.7]}
                        zoom={initial ? 14 : 6}
                        style={{ height: '100%', width: '100%' }}
                        scrollWheelZoom={true}
                    >
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                        <ClickCatcher onClick={handleClick} />
                        <FlyTo target={flyTarget} />
                        {point && <Marker position={[point.lat, point.lng]} icon={pickIcon} title="Punto elegido" />}
                    </MapContainer>
                </div>
                <div className={styles.foot}>
                    <span className={styles.status} aria-live="polite">
                        {!point
                            ? 'Busca un lugar o toca el mapa para colocar el punto'
                            : loading
                              ? 'Buscando dirección…'
                              : label}
                    </span>
                    <div className={styles.actions}>
                        <button type="button" className={styles.cancel} onClick={onClose}>
                            Cancelar
                        </button>
                        <button
                            type="button"
                            className={styles.confirm}
                            onClick={confirm}
                            disabled={!point || loading}
                        >
                            Usar este punto
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MapPicker;
