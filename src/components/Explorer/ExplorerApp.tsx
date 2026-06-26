import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import MainMap from '../Map/MainMap';
import ExplorerSidebar from './ExplorerSidebar';
import styles from './ExplorerApp.module.css';
import type { GasStation, FuelType } from '../../types/gasolinera';
import { getDistance } from '../../lib/geo';
import L from 'leaflet';

export type { FuelType };
export type SortType = 'distance' | 'price';

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 320;
const WIDE_THRESHOLD = 640; // a partir de aquí, el listado pasa a 2 columnas

const ExplorerApp: React.FC = () => {
    const [allStations, setAllStations] = useState<GasStation[]>([]);
    const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
    const [mapCenter, setMapCenter] = useState<[number, number]>([40.4168, -3.7038]);
    const [initialCenter, setInitialCenter] = useState<[number, number]>([40.4168, -3.7038]);
    const [initialZoom, setInitialZoom] = useState<number>(6);
    const [fuelType, setFuelType] = useState<FuelType>('sp95');
    const [sortType, setSortType] = useState<SortType>('price');
    const [isInitialized, setIsInitialized] = useState(false);
    const [disableGeolocation, setDisableGeolocation] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [mapCollapsed, setMapCollapsed] = useState(false);

    const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_WIDTH);
    const isDragging = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Cargamos las estaciones por fetch (no se empaquetan en el bundle de JS).
    useEffect(() => {
        let cancelled = false;
        fetch('/data/stations.json')
            .then((r) => r.json())
            .then((data: GasStation[]) => {
                if (!cancelled) setAllStations(data);
            })
            .catch(() => {
                if (!cancelled) setAllStations([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Restauramos el ancho guardado del listado.
    useEffect(() => {
        const saved = Number(localStorage.getItem('octo-sidebar-width'));
        if (saved && saved >= MIN_WIDTH) setSidebarWidth(saved);
    }, []);

    useEffect(() => {
        // Esperamos a tener los datos antes de resolver el modo de la URL.
        if (allStations.length === 0) return;

        const params = new URLSearchParams(window.location.search);
        const mode = params.get('mode');
        const searchProv = params.get('prov');
        const searchCity = params.get('city');

        if (mode === 'location') {
            if ('geolocation' in navigator) {
                setDisableGeolocation(false);
            } else {
                setInitialZoom(6);
                setDisableGeolocation(true);
            }
            setMapCollapsed(false); // en modo ubicación el mapa es protagonista
            setIsInitialized(true);
        } else if (mode === 'municipality' && searchProv && searchCity) {
            const prov = searchProv.toLowerCase();
            const city = searchCity.toLowerCase();
            const stationInCity = allStations.find(
                (s) => s.province.toLowerCase() === prov && s.city.toLowerCase() === city
            );

            if (stationInCity) {
                const center: [number, number] = [stationInCity.lat, stationInCity.lng];
                setInitialCenter(center);
                setMapCenter(center);
                setInitialZoom(13);
            }
            setDisableGeolocation(true);
            setMapCollapsed(true); // por municipio: listado a pantalla completa, mapa desplegable
            setIsInitialized(true);
        } else {
            setDisableGeolocation(true);
            setMapCollapsed(true);
            setIsInitialized(true);
        }
    }, [allStations]);

    // --- Divisor arrastrable ---
    const stopDragging = useCallback(() => {
        if (!isDragging.current) return;
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setSidebarWidth((w) => {
            localStorage.setItem('octo-sidebar-width', String(w));
            return w;
        });
    }, []);

    const onDrag = useCallback((e: MouseEvent) => {
        if (!isDragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const maxWidth = rect.width - 360; // dejamos al menos 360px de mapa
        const next = Math.max(MIN_WIDTH, Math.min(e.clientX - rect.left, maxWidth));
        setSidebarWidth(next);
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', onDrag);
        window.addEventListener('mouseup', stopDragging);
        return () => {
            window.removeEventListener('mousemove', onDrag);
            window.removeEventListener('mouseup', stopDragging);
        };
    }, [onDrag, stopDragging]);

    const startDragging = () => {
        isDragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const resetWidth = () => {
        setSidebarWidth(DEFAULT_WIDTH);
        localStorage.setItem('octo-sidebar-width', String(DEFAULT_WIDTH));
    };

    // Handle map movement to update center for distance sorting and visible stations list
    const handleBoundsChange = (bounds: L.LatLngBounds, center: L.LatLng) => {
        setMapBounds((prev) => (prev && prev.equals(bounds) ? prev : bounds));
        setMapCenter((prev) =>
            prev[0] === center.lat && prev[1] === center.lng ? prev : [center.lat, center.lng]
        );
    };

    // Estaciones para el listado:
    // - mapa visible -> las que caben en el área del mapa.
    // - mapa colapsado (ancho 0, sin bounds fiables) -> por proximidad al centro.
    const RADIUS_KM = 25;
    const visibleStations = useMemo(() => {
        if (mapCollapsed || !mapBounds) {
            const [clat, clng] = mapCenter;
            return allStations.filter((s) => getDistance(clat, clng, s.lat, s.lng) <= RADIUS_KM);
        }
        return allStations.filter((s) => mapBounds.contains([s.lat, s.lng]));
    }, [allStations, mapBounds, mapCollapsed, mapCenter]);

    // Al mostrar el mapa, forzamos a Leaflet a recalcular su tamaño (evita el mapa
    // en blanco/negro cuando pasa de oculto a visible, sobre todo en móvil).
    useEffect(() => {
        if (!mapCollapsed) {
            const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
            return () => clearTimeout(t);
        }
    }, [mapCollapsed]);

    // Listado ancho (2+ columnas) cuando el mapa está colapsado o el panel es ancho.
    const isWide = mapCollapsed || sidebarWidth >= WIDE_THRESHOLD;

    return (
        <div className={`${styles.appContainer} ${mapCollapsed ? styles.collapsed : ''}`} ref={containerRef}>
            {isInitialized ? (
                <>
                    <div
                        className={styles.sidebarPanel}
                        style={mapCollapsed ? { flex: 1, width: 'auto' } : { width: sidebarWidth }}
                    >
                        <ExplorerSidebar
                            stations={visibleStations}
                            center={mapCenter}
                            fuelType={fuelType}
                            sortType={sortType}
                            selectedId={selectedId}
                            wide={isWide}
                            onFuelTypeChange={setFuelType}
                            onSortTypeChange={setSortType}
                            onSelectStation={(id) => {
                                setSelectedId(id);
                                // En escritorio, al elegir abrimos el mapa (split). En móvil NO:
                                // el usuario abre el mapa con el botón "Ver mapa" (evita el salto a pantalla negra).
                                if (id && mapCollapsed && window.matchMedia('(min-width: 769px)').matches) {
                                    setMapCollapsed(false);
                                }
                            }}
                        />
                    </div>

                    {!mapCollapsed && (
                        <div
                            className={styles.splitter}
                            onMouseDown={startDragging}
                            onDoubleClick={resetWidth}
                            role="separator"
                            aria-orientation="vertical"
                            title="Arrastra para ajustar · doble clic para restablecer"
                        >
                            <div className={styles.splitterGrip} />
                        </div>
                    )}

                    <div className={styles.mapArea} style={mapCollapsed ? { width: 0, minWidth: 0, flex: '0 0 0', overflow: 'hidden' } : undefined}>
                        {!mapCollapsed && (
                            <button
                                className={styles.hideMapBtn}
                                onClick={() => setMapCollapsed(true)}
                                title="Ocultar mapa y ampliar listado"
                            >
                                <span className="material-symbols-outlined">left_panel_close</span>
                                Ocultar mapa
                            </button>
                        )}
                        <MainMap
                            stations={allStations}
                            initialCenter={initialCenter}
                            initialZoom={initialZoom}
                            onBoundsChange={handleBoundsChange}
                            fuelType={fuelType}
                            disableGeolocation={disableGeolocation}
                            selectedId={selectedId}
                            onSelectStation={setSelectedId}
                            active={!mapCollapsed}
                        />
                    </div>

                    {mapCollapsed && (
                        <button
                            className={styles.showMapBtn}
                            onClick={() => setMapCollapsed(false)}
                            title="Mostrar mapa"
                        >
                            <span className="material-symbols-outlined">map</span>
                            <span className={styles.showMapLabel}>Ver mapa</span>
                        </button>
                    )}
                </>
            ) : (
                <div className={styles.loading}>Cargando mapa...</div>
            )}
        </div>
    );
};

export default ExplorerApp;
