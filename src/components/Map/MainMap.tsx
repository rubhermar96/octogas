import React, { useMemo, useState, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.Default.css';
import styles from './MainMap.module.css';
import gasData from '../../data/gasolineras.json';
import type { GasStation } from '../../types/gasolinera';
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

const LocationController = ({ onBoundsChange }: { onBoundsChange: (bounds: L.LatLngBounds, center: L.LatLng) => void }) => {
    const map = useMapEvents({
        moveend: () => {
            onBoundsChange(map.getBounds(), map.getCenter());
        },
        zoomend: () => {
            onBoundsChange(map.getBounds(), map.getCenter());
        },
        locationfound: (e) => {
            map.flyTo(e.latlng, 13);
            // We don't force bounds update here, moveend will trigger it after flyTo finishes/starts
        },
        locationerror: () => {
            // Fallback to Madrid if denied/error
            map.setView([40.4168, -3.7038], 11);
        }
    });

    // Try to locate on mount
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

    // Set initial bounds
    useEffect(() => {
        onBoundsChange(map.getBounds(), map.getCenter());
    }, [map, onBoundsChange]);

    return null;
};

interface MainMapProps {
    stations?: GasStation[];
    initialCenter?: [number, number];
    initialZoom?: number;
    disableGeolocation?: boolean;
    onBoundsChange?: (bounds: L.LatLngBounds, center: L.LatLng) => void;
    fuelType?: 'sp95' | 'sp98' | 'diesel';
}

const MainMap: React.FC<MainMapProps> = ({
    stations = gasData as unknown as GasStation[],
    initialCenter = [40.4168, -3.7038],
    initialZoom = 6,
    disableGeolocation = false,
    onBoundsChange,
    fuelType = 'sp95'
}) => {
    const [visibleStations, setVisibleStations] = useState<GasStation[]>([]);
    const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);
    const [center, setCenter] = useState<L.LatLng | null>(null);

    // Calculate average price for selected fuel type
    const averagePrice = useMemo(() => {
        const prices = stations
            .map(s => s.prices[fuelType])
            .filter((p): p is number => p !== null);

        if (prices.length === 0) return 0;
        const total = prices.reduce((acc, curr) => acc + curr, 0);
        return total / prices.length;
    }, [stations]);

    useEffect(() => {
        if (!bounds) {
            // If geolocation is disabled (e.g., dynamic page), we might want to load immediately
            // or wait for bounds from the map which should happen on mount/moveend anyway.
            if (disableGeolocation) {
                // Should we wait for bounds? Yes, bounds will be reported by LocationController (or MapEvents)
                // But without geolocation, we start at initialCenter.
                // Let's rely on bounds update.
            }
            return;
        }

        // Filter stations within bounds
        const visible = stations.filter(station =>
            bounds.contains([station.lat, station.lng])
        );
        setVisibleStations(visible);

    }, [bounds, stations]);

    const getColor = (price: number | null) => {
        if (!price) return '#94a3b8'; // slate-400 for no price
        return price < averagePrice ? '#34d399' : '#fb923c';
    };

    const handleLocalBoundsChange = (b: L.LatLngBounds, c: L.LatLng) => {
        setBounds((prevBounds) => {
            if (prevBounds && prevBounds.equals(b)) {
                return prevBounds;
            }
            return b;
        });
        
        setCenter((prevCenter) => {
            if (prevCenter && prevCenter.equals(c)) {
                return prevCenter;
            }
            return c;
        });

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

                {!disableGeolocation && <LocationController onBoundsChange={handleLocalBoundsChange} />}

                {/* When geolocation is disabled, we still need to report bounds to trigger loading */}
                {disableGeolocation && <BoundsReporter onBoundsChange={handleLocalBoundsChange} />}

                <MarkerClusterGroup
                    chunkedLoading
                    iconCreateFunction={createClusterCustomIcon}
                    showCoverageOnHover={false}
                >
                    {visibleStations.map(station => {
                        const price = station.prices[fuelType];
                        return (
                            <CircleMarker
                                key={station.id}
                                center={[station.lat, station.lng]}
                                radius={6}
                                fillOpacity={0.8}
                                pathOptions={{
                                    color: 'white',
                                    weight: 1,
                                    fillColor: getColor(price)
                                }}
                            >
                                <Popup className={styles.popupContent}>
                                    <div>
                                        <h3 className={styles.popupHeader}>{station.name}</h3>
                                        <p className={styles.popupAddress}>{station.address}, {station.city}</p>
                                        <div className={styles.popupPrice}>
                                            <span className={styles.priceValue}>
                                                {price ? price.toFixed(3) : '--'}
                                            </span>
                                            <span className={styles.priceLabel}>€/L ({fuelType.toUpperCase()})</span>
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                                            {station.schedule}
                                        </div>
                                    </div>
                                </Popup>
                            </CircleMarker>
                        )
                    })}
                </MarkerClusterGroup>
            </MapContainer>
        </div>
    );
};

export default MainMap;
