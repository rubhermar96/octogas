import React, { useMemo, useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.Default.css';
import styles from './MainMap.module.css';
import type { GasStation, FuelType } from '../../types/gasolinera';
import { FUEL_LABELS, FUEL_ORDER } from '../../lib/fuels';
import BrandLogo from '../Explorer/BrandLogo';
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

const StationPopup: React.FC<{ station: GasStation; fuelType: FuelType }> = ({ station, fuelType }) => {
    const availableFuels = FUEL_ORDER.filter((f) => station.prices[f] != null);
    return (
        <div className={styles.popupBody}>
            <div className={styles.popupTop}>
                <BrandLogo brand={station.brand} size={36} />
                <div>
                    <h3 className={styles.popupHeader}>{station.name}</h3>
                    <p className={styles.popupAddress}>{station.address}, {station.city}</p>
                </div>
            </div>
            <div className={styles.popupGrid}>
                {availableFuels.map((f) => (
                    <div key={f} className={`${styles.popupFuel} ${f === fuelType ? styles.popupFuelActive : ''}`}>
                        <span className={styles.popupFuelLabel}>{FUEL_LABELS[f]}</span>
                        <span className={styles.popupFuelPrice}>{station.prices[f]!.toFixed(3)}</span>
                    </div>
                ))}
            </div>
            <div className={styles.popupFooter}>
                <span>{station.schedule || 'Horario no disponible'}</span>
                <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.popupRoute}
                >
                    Cómo llegar
                </a>
            </div>
        </div>
    );
};

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
    const selectedMarkerRef = useRef<L.CircleMarker>(null);

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

    const getColor = (price: number | null) => {
        if (!price) return '#94a3b8';
        return price < averagePrice ? '#34d399' : '#fb923c';
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
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
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
                                <CircleMarker
                                    key={station.id}
                                    center={[station.lat, station.lng]}
                                    radius={6}
                                    fillOpacity={0.85}
                                    pathOptions={{
                                        color: 'white',
                                        weight: 1,
                                        fillColor: getColor(price)
                                    }}
                                    eventHandlers={{ click: () => onSelectStation?.(station.id) }}
                                >
                                    <Popup className={styles.popupContent}>
                                        <StationPopup station={station} fuelType={fuelType} />
                                    </Popup>
                                </CircleMarker>
                            );
                        })}
                </MarkerClusterGroup>

                {/* Estación seleccionada: marcador destacado, siempre visible y por encima */}
                {selectedStation && (
                    <CircleMarker
                        ref={selectedMarkerRef}
                        center={[selectedStation.lat, selectedStation.lng]}
                        radius={11}
                        fillOpacity={1}
                        pathOptions={{
                            color: '#fff',
                            weight: 3,
                            fillColor: '#34d399'
                        }}
                        eventHandlers={{ click: () => onSelectStation?.(selectedStation.id) }}
                    >
                        <Popup className={styles.popupContent} autoPan={true}>
                            <StationPopup station={selectedStation} fuelType={fuelType} />
                        </Popup>
                    </CircleMarker>
                )}
            </MapContainer>
        </div>
    );
};

export default MainMap;
