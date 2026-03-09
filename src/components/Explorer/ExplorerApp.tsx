import React, { useState, useEffect, useMemo } from 'react';
import MainMap from '../Map/MainMap';
import ExplorerSidebar from './ExplorerSidebar';
import styles from './ExplorerApp.module.css';
import type { GasStation } from '../../types/gasolinera';
import gasData from '../../data/gasolineras.json';
import L from 'leaflet';

export type FuelType = 'sp95' | 'sp98' | 'diesel';
export type SortType = 'distance' | 'price';

const ExplorerApp: React.FC = () => {
    const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
    const [mapCenter, setMapCenter] = useState<[number, number]>([40.4168, -3.7038]);
    const [initialCenter, setInitialCenter] = useState<[number, number]>([40.4168, -3.7038]);
    const [initialZoom, setInitialZoom] = useState<number>(6);
    const [fuelType, setFuelType] = useState<FuelType>('sp95');
    const [sortType, setSortType] = useState<SortType>('distance');
    const [isInitialized, setIsInitialized] = useState(false);
    const [disableGeolocation, setDisableGeolocation] = useState(true);

    const allStations = gasData as unknown as GasStation[];

    useEffect(() => {
        // Parse URL params
        const params = new URLSearchParams(window.location.search);
        const mode = params.get('mode');
        const searchProv = params.get('prov');
        const searchCity = params.get('city');

        if (mode === 'location') {
            if ("geolocation" in navigator) {
                setDisableGeolocation(false);
                setIsInitialized(true);
            } else {
                setInitialZoom(6);
                setDisableGeolocation(true);
                setIsInitialized(true);
            }
        } else if (mode === 'municipality' && searchProv && searchCity) {
            // Find a station in that city to get coords
            const stationInCity = allStations.find(s => 
                s.province === searchProv && s.city === searchCity
            );
            
            if (stationInCity) {
                const center: [number, number] = [stationInCity.lat, stationInCity.lng];
                setInitialCenter(center);
                setMapCenter(center);
                setInitialZoom(13); // Zoom in close to municipality
            }
            setDisableGeolocation(true);
            setIsInitialized(true);
        } else {
            // Default 
            setDisableGeolocation(true);
            setIsInitialized(true);
        }
    }, [allStations]);

    // Handle map movement to update center for distance sorting and visible stations list
    const handleBoundsChange = (bounds: L.LatLngBounds, center: L.LatLng) => {
        setMapBounds((prev) => prev && prev.equals(bounds) ? prev : bounds);
        setMapCenter((prev) => prev[0] === center.lat && prev[1] === center.lng ? prev : [center.lat, center.lng]);
    };

    // Filter stations strictly by map bounds (or just proximity? Usually bounds)
    const visibleStations = useMemo(() => {
        if (!mapBounds) return [];
        return allStations.filter(s => mapBounds.contains([s.lat, s.lng]));
    }, [allStations, mapBounds]);

    return (
        <div className={styles.appContainer}>
            {isInitialized ? (
                <>
                    <ExplorerSidebar 
                        stations={visibleStations}
                        center={mapCenter}
                        fuelType={fuelType}
                        sortType={sortType}
                        onFuelTypeChange={setFuelType}
                        onSortTypeChange={setSortType}
                    />
                    <div className={styles.mapArea}>
                        <MainMap 
                            stations={allStations} 
                            initialCenter={initialCenter}
                            initialZoom={initialZoom}
                            onBoundsChange={handleBoundsChange}
                            fuelType={fuelType}
                            disableGeolocation={disableGeolocation}
                        />
                    </div>
                </>
            ) : (
                <div className={styles.loading}>Cargando mapa...</div>
            )}
        </div>
    );
};

export default ExplorerApp;
