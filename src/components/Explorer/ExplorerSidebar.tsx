import React, { useMemo } from 'react';
import type { GasStation } from '../../types/gasolinera';
import type { FuelType, SortType } from './ExplorerApp';
import styles from './ExplorerSidebar.module.css';

interface ExplorerSidebarProps {
    stations: GasStation[];
    center: [number, number];
    fuelType: FuelType;
    sortType: SortType;
    onFuelTypeChange: (type: FuelType) => void;
    onSortTypeChange: (type: SortType) => void;
}

// Haversine formula to calculate distance between two lat/lng pairs
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c;
}

const ExplorerSidebar: React.FC<ExplorerSidebarProps> = ({ 
    stations, 
    center, 
    fuelType, 
    sortType, 
    onFuelTypeChange, 
    onSortTypeChange 
}) => {

    const sortedStations = useMemo(() => {
        const withDistances = stations.map(s => ({
            ...s,
            distanceToCenter: getDistance(center[0], center[1], s.lat, s.lng)
        }));

        return withDistances.sort((a, b) => {
            if (sortType === 'distance') {
                return a.distanceToCenter - b.distanceToCenter;
            } else {
                // Sort by price
                const priceA = a.prices[fuelType] || Infinity;
                const priceB = b.prices[fuelType] || Infinity;
                return priceA - priceB;
            }
        });
    }, [stations, center, sortType, fuelType]);

    // Format price elegantly with 3 decimals usually
    const formatPrice = (price: number | null) => {
        if (!price) return '--';
        return price.toFixed(3);
    };

    return (
        <aside className={styles.sidebar}>
            <div className={styles.header}>
                <h2 className={styles.title}>Estaciones Cercanas</h2>
                <a href="/" className={styles.backButton}>
                    <span className="material-symbols-outlined">arrow_back</span>
                    Volver
                </a>
            </div>

            <div className={styles.controls}>
                <div className={styles.controlGroup}>
                    <label className={styles.label}>Combustible Principal</label>
                    <div className={styles.fuelSelector}>
                        <button 
                            className={`${styles.fuelOption} ${fuelType === 'sp95' ? styles.selected : ''}`}
                            onClick={() => onFuelTypeChange('sp95')}
                        >
                            SP95
                        </button>
                        <button 
                            className={`${styles.fuelOption} ${fuelType === 'sp98' ? styles.selected : ''}`}
                            onClick={() => onFuelTypeChange('sp98')}
                        >
                            SP98
                        </button>
                        <button 
                            className={`${styles.fuelOption} ${fuelType === 'diesel' ? styles.selected : ''}`}
                            onClick={() => onFuelTypeChange('diesel')}
                        >
                            Diesel
                        </button>
                    </div>
                </div>

                <div className={styles.controlGroup}>
                    <label className={styles.label}>Ordenar por</label>
                    <div className={styles.sortSelector}>
                        <button 
                            className={`${styles.sortOption} ${sortType === 'distance' ? styles.selected : ''}`}
                            onClick={() => onSortTypeChange('distance')}
                        >
                            <span className="material-symbols-outlined">near_me</span>
                            Cercanía
                        </button>
                        <button 
                            className={`${styles.sortOption} ${sortType === 'price' ? styles.selected : ''}`}
                            onClick={() => onSortTypeChange('price')}
                        >
                            <span className="material-symbols-outlined">payments</span>
                            Precio
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.listContainer}>
                <div className={styles.resultsCount}>
                    {stations.length} resultados en el área visible
                </div>
                
                <div className={styles.stationList}>
                    {sortedStations.map(station => (
                        <div key={station.id} className={styles.stationCard}>
                            <div className={styles.cardHeader}>
                                <div>
                                    <h3 className={styles.stationName}>{station.name}</h3>
                                    <p className={styles.stationBrand}>{station.brand}</p>
                                </div>
                                <div className={styles.distanceBadge}>
                                    {station.distanceToCenter.toFixed(1)} km
                                </div>
                            </div>
                            
                            <p className={styles.stationAddress}>
                                {station.address}, {station.city}
                            </p>
                            
                            <div className={styles.priceGrid}>
                                <div className={`${styles.priceItem} ${fuelType === 'sp95' ? styles.highlight : ''}`}>
                                    <span className={styles.priceType}>SP95</span>
                                    <span className={styles.priceValue}>{formatPrice(station.prices.sp95)} €</span>
                                </div>
                                <div className={`${styles.priceItem} ${fuelType === 'sp98' ? styles.highlight : ''}`}>
                                    <span className={styles.priceType}>SP98</span>
                                    <span className={styles.priceValue}>{formatPrice(station.prices.sp98)} €</span>
                                </div>
                                <div className={`${styles.priceItem} ${fuelType === 'diesel' ? styles.highlight : ''}`}>
                                    <span className={styles.priceType}>Diesel</span>
                                    <span className={styles.priceValue}>{formatPrice(station.prices.diesel)} €</span>
                                </div>
                            </div>

                            <p className={styles.scheduleText}>
                                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>schedule</span>
                                {station.schedule}
                            </p>
                        </div>
                    ))}
                    
                    {sortedStations.length === 0 && (
                        <div className={styles.emptyState}>
                            <span className="material-symbols-outlined">location_off</span>
                            <p>No se encontraron gasolineras en esta zona.</p>
                            <span>Aleja el mapa para buscar en un área mayor.</span>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
};

export default ExplorerSidebar;
