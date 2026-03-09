import React, { useState, useMemo, useEffect, useRef } from 'react';
import styles from './MunicipalitySearch.module.css';
import gasData from '../../data/gasolineras.json';
import type { GasStation } from '../../types/gasolinera';

interface LocationItem {
    city: string;
    province: string;
}

const MunicipalitySearch: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const allStations = gasData as unknown as GasStation[];

    // Extract unique locations
    const locations = useMemo(() => {
        const uniqueSet = new Set<string>();
        const uniqueLocations: LocationItem[] = [];

        allStations.forEach(s => {
            const key = `${s.city}-${s.province}`;
            if (!uniqueSet.has(key)) {
                uniqueSet.add(key);
                uniqueLocations.push({ city: s.city, province: s.province });
            }
        });

        // Sort alphabetically by city
        return uniqueLocations.sort((a, b) => a.city.localeCompare(b.city));
    }, [allStations]);

    // Filter based on input
    const filteredLocations = useMemo(() => {
        if (!searchTerm) return [];
        const lowerSearch = searchTerm.toLowerCase();
        return locations.filter(loc => 
            loc.city.toLowerCase().includes(lowerSearch) || 
            loc.province.toLowerCase().includes(lowerSearch)
        ).slice(0, 8); // Limit to top 8 results for performance
    }, [searchTerm, locations]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (city: string, province: string) => {
        window.location.href = `/explorador?mode=municipality&prov=${encodeURIComponent(province)}&city=${encodeURIComponent(city)}`;
    };

    return (
        <div className={styles.searchWrapper} ref={wrapperRef}>
            <div className={styles.inputContainer}>
                <span className={`material-symbols-outlined ${styles.searchIcon}`}>search</span>
                <input 
                    type="text" 
                    className={styles.searchInput}
                    placeholder="Ej. Madrid, Barcelona, Valencia..." 
                    value={searchTerm}
                    onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                />
                {searchTerm && (
                    <button 
                        className={styles.clearButton}
                        onClick={() => {
                            setSearchTerm('');
                            setIsOpen(true);
                        }}
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                )}
            </div>

            {isOpen && searchTerm && (
                <ul className={styles.dropdownList}>
                    {filteredLocations.length > 0 ? (
                        filteredLocations.map((loc, idx) => (
                            <li 
                                key={idx} 
                                className={styles.dropdownItem}
                                onClick={() => handleSelect(loc.city, loc.province)}
                            >
                                <span className="material-symbols-outlined">location_on</span>
                                <div className={styles.itemText}>
                                    <span className={styles.itemCity}>{loc.city}</span>
                                    <span className={styles.itemProvince}>{loc.province}</span>
                                </div>
                            </li>
                        ))
                    ) : (
                        <li className={styles.emptyItem}>
                            No se encontraron municipios.
                        </li>
                    )}
                </ul>
            )}
        </div>
    );
};

export default MunicipalitySearch;
