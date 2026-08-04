import React, { useMemo, useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.Default.css';
import styles from './MainMap.module.css';
import type { GasStation, FuelType } from '../../types/gasolinera';
import { stationIcon, StationPopup } from './StationMarker';
import L from 'leaflet';

// Fix for default marker icon in react-leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon.src,
    shadowUrl: iconShadow.src,
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Icono "estás aquí" (punto azul con halo pulsante).
const userLocationIcon = L.divIcon({
    className: 'octo-user-loc',
    html: '<span class="octo-user-pulse"></span><span class="octo-user-dot"></span>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
});

const createClusterCustomIcon = (cluster: any) => {
    const count = cluster.getChildCount();
    let size = 'small';
    if (count > 10) size = 'medium';
    if (count > 50) size = 'large';

    return L.divIcon({
        html: `<span>${count}</span>`,
        className: `${styles.clusterIcon} ${size === 'small' ? styles.clusterSmall :
            size === 'medium' ? styles.clusterMedium :
                styles.clusterLarge
            }`,
        iconSize: L.point(40, 40, true),
    });
};

const LocationController = ({ onBoundsChange, onLocate }: {
    onBoundsChange: (bounds: L.LatLngBounds, center: L.LatLng) => void;
    onLocate: (pos: [number, number]) => void;
}) => {
    const map = useMapEvents({
        moveend: () => {
            onBoundsChange(map.getBounds(), map.getCenter());
        },
        zoomend: () => {
            onBoundsChange(map.getBounds(), map.getCenter());
        },
        locationfound: (e) => {
            onLocate([e.latlng.lat, e.latlng.lng]);
            map.flyTo(e.latlng, 13);
        },
        locationerror: () => {
            map.setView([40.4168, -3.7038], 11);
        }
    });

    useEffect(() => {
        map.locate({ setView: false, enableHighAccuracy: true });
    }, [map]);

    return null;
};

const BoundsReporter = ({ onBoundsChange }: { onBoundsChange: (bounds: L.LatLngBounds, center: L.LatLng) => void }) => {
    const map = useMapEvents({
        moveend: () => {
            onBoundsChange(map.getBounds(), map.getCenter());
        },
        zoomend: () => {
            onBoundsChange(map.getBounds(), map.getCenter());
        }
    });

    useEffect(() => {
        onBoundsChange(map.getBounds(), map.getCenter());
    }, [map, onBoundsChange]);

    return null;
};

// Vuela a la estación seleccionada desde el listado (solo si el mapa es visible).
const SelectionController = ({ station, active }: { station: GasStation | null; active: boolean }) => {
    const map = useMap();
    const wasVisible = useRef(map.getSize().x > 0);

    const focus = () => {
        if (station && active && map.getSize().x > 0) {
            map.flyTo([station.lat, station.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
        }
    };

    useEffect(() => {
        // Evita operar sobre un mapa oculto (tamaño 0) -> evita crash en móvil.
        focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [station, active, map]);

    // Cuando el mapa pasa de oculto a visible (p. ej. "Ver mapa" en móvil), enfocamos.
    useMapEvents({
        resize: () => {
            const visible = map.getSize().x > 0;
            if (visible && !wasVisible.current) focus();
            wasVisible.current = visible;
        },
    });

    return null;
};

// Reajusta el mapa cuando el contenedor cambia de tamaño (divisor arrastrable).
const ResizeHandler = () => {
    const map = useMap();
    useEffect(() => {
        const container = map.getContainer();
        const observer = new ResizeObserver(() => {
            map.invalidateSize();
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [map]);
    return null;
};

interface MainMapProps {
    stations?: GasStation[];
    initialCenter?: [number, number];
    initialZoom?: number;
    disableGeolocation?: boolean;
    onBoundsChange?: (bounds: L.LatLngBounds, center: L.LatLng) => void;
    fuelType?: FuelType;
    selectedId?: string | null;
    onSelectStation?: (id: string | null) => void;
    /** Si el mapa está visible. Cuando es false, no se vuela/abre popup (evita crash con mapa oculto). */
    active?: boolean;
}

const MainMap: React.FC<MainMapProps> = ({
    stations = [],
    initialCenter = [40.4168, -3.7038],
    initialZoom = 6,
    disableGeolocation = false,
    onBoundsChange,
    fuelType = 'sp95',
    selectedId = null,
    onSelectStation,
    active = true
}) => {
    const [visibleStations, setVisibleStations] = useState<GasStation[]>([]);
    const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);
    const [userPos, setUserPos] = useState<[number, number] | null>(null);
    const selectedMarkerRef = useRef<L.Marker>(null);

    const averagePrice = useMemo(() => {
        const prices = stations
            .map(s => s.prices[fuelType])
            .filter((p): p is number => p !== null);

        if (prices.length === 0) return 0;
        const total = prices.reduce((acc, curr) => acc + curr, 0);
        return total / prices.length;
    }, [stations, fuelType]);

    useEffect(() => {
        if (!bounds) return;
        const visible = stations.filter(station =>
            bounds.contains([station.lat, station.lng])
        );
        setVisibleStations(visible);
    }, [bounds, stations]);

    const selectedStation = useMemo(
        () => stations.find((s) => s.id === selectedId) ?? null,
        [stations, selectedId]
    );

    // Al seleccionar una estación (con el mapa visible), abrimos su popup.
    useEffect(() => {
        if (active && selectedStation && selectedMarkerRef.current) {
            selectedMarkerRef.current.openPopup();
        }
    }, [selectedStation, active]);

    // Color del borde según el precio relativo a la media de la zona.
    const getColor = (price: number | null | undefined) => {
        if (!price || !averagePrice) return '#94a3b8'; // sin dato
        if (price <= averagePrice * 0.985) return '#22c55e'; // barata
        if (price >= averagePrice * 1.015) return '#ef4444'; // cara
        return '#f59e0b'; // en la media
    };

    const handleLocalBoundsChange = (b: L.LatLngBounds, c: L.LatLng) => {
        setBounds((prevBounds) => (prevBounds && prevBounds.equals(b) ? prevBounds : b));
        if (onBoundsChange) {
            onBoundsChange(b, c);
        }
    };

    return (
        <div className={styles.mapContainer}>
            <MapContainer
                center={initialCenter}
                zoom={initialZoom}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={true}
            >
                {/* OSM estándar: el mismo basemap que el planificador de rutas
                    (más calles/lugares y topónimos en idioma local que CARTO). */}
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <ResizeHandler />
                <SelectionController station={selectedStation} active={active} />

                {!disableGeolocation && <LocationController onBoundsChange={handleLocalBoundsChange} onLocate={setUserPos} />}
                {disableGeolocation && <BoundsReporter onBoundsChange={handleLocalBoundsChange} />}

                {userPos && (
                    <Marker position={userPos} icon={userLocationIcon} zIndexOffset={1000}>
                        <Popup className={styles.popupContent}>
                            <strong>Estás aquí</strong>
                        </Popup>
                    </Marker>
                )}

                <MarkerClusterGroup
                    chunkedLoading
                    iconCreateFunction={createClusterCustomIcon}
                    showCoverageOnHover={false}
                >
                    {visibleStations
                        .filter((station) => station.id !== selectedId)
                        .map(station => {
                            const price = station.prices[fuelType];
                            return (
                                <Marker
                                    key={station.id}
                                    position={[station.lat, station.lng]}
                                    icon={stationIcon(station.brand, getColor(price), false)}
                                    eventHandlers={{ click: () => onSelectStation?.(station.id) }}
                                >
                                    <Popup className={styles.popupContent}>
                                        <StationPopup station={station} fuelType={fuelType} />
                                    </Popup>
                                </Marker>
                            );
                        })}
                </MarkerClusterGroup>

                {/* Estación seleccionada: marcador destacado, siempre visible y por encima */}
                {selectedStation && (
                    <Marker
                        ref={selectedMarkerRef}
                        position={[selectedStation.lat, selectedStation.lng]}
                        icon={stationIcon(selectedStation.brand, getColor(selectedStation.prices[fuelType]), true)}
                        zIndexOffset={1000}
                        eventHandlers={{ click: () => onSelectStation?.(selectedStation.id) }}
                    >
                        <Popup className={styles.popupContent} autoPan={true}>
                            <StationPopup station={selectedStation} fuelType={fuelType} />
                        </Popup>
                    </Marker>
                )}
            </MapContainer>
        </div>
    );
};

export default MainMap;
