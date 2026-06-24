import React, { useState, useMemo, useEffect, useRef } from 'react';
import styles from './MunicipalitySearch.module.css';

interface LocationItem {
    city: string;
    province: string;
    provinceSlug: string;
    citySlug: string;
    count: number;
}

const MunicipalitySearch: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [locations, setLocations] = useState<LocationItem[]>([]);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Cargamos el índice ligero de municipios (~340 KB) en vez de las 11k estaciones.
    useEffect(() => {
        fetch('/data/municipios.json')
            .then((r) => r.json())
            .then((data: LocationItem[]) => setLocations(data))
            .catch(() => setLocations([]));
    }, []);

    // Filtra y ordena por relevancia: la ciudad buscada aparece antes que los
    // pueblos de su provincia, y dentro de cada grupo, las más grandes primero.
    const filteredLocations = useMemo(() => {
        if (!searchTerm) return [];
        const q = searchTerm.toLowerCase().trim();

        const score = (loc: LocationItem): number => {
            const city = loc.city.toLowerCase();
            const prov = loc.province.toLowerCase();
            if (city === q) return 0;
            if (city.startsWith(q)) return 1;
            if (city.includes(q)) return 2;
            if (prov.startsWith(q)) return 3;
            if (prov.includes(q)) return 4;
            return 99;
        };

        return locations
            .map((loc) => ({ loc, s: score(loc) }))
            .filter((x) => x.s < 99)
            .sort((a, b) => (a.s !== b.s ? a.s - b.s : b.loc.count - a.loc.count))
            .slice(0, 8)
            .map((x) => x.loc);
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
