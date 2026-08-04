import React, { useMemo, useRef, useEffect, useState } from 'react';
import type { GasStation, FuelType } from '../../types/gasolinera';
import type { SortType } from './ExplorerApp';
import { FUEL_LABELS, MAIN_FUELS, OTHER_FUELS, FUEL_ORDER } from '../../lib/fuels';
import { getDistance } from '../../lib/geo';
import { stationUrl } from '../../lib/stationUrl';
import { displayCity } from '../../lib/placeName';
import BrandLogo from './BrandLogo';
import CompareButton from './CompareButton';
import BrandFilter, { type BrandOption } from './BrandFilter';
import styles from './ExplorerSidebar.module.css';

interface ExplorerSidebarProps {
    stations: GasStation[];
    center: [number, number];
    fuelType: FuelType;
    sortType: SortType;
    selectedId: string | null;
    wide: boolean;
    brandOptions: BrandOption[];
    selectedBrands: Set<string>;
    onBrandsChange: (next: Set<string>) => void;
    onFuelTypeChange: (type: FuelType) => void;
    onSortTypeChange: (type: SortType) => void;
    onSelectStation: (id: string | null) => void;
}

const formatPrice = (price: number | null | undefined) => (price ? price.toFixed(3) : '--');

// Tope de tarjetas renderizadas a la vez (rendimiento del DOM).
const MAX_RENDER = 150;

// Al ordenar por precio, diferencias menores a esto (€/L) se consideran "el
// mismo precio" y desempatan por cercanía, para no anteponer una gasolinera
// bastante más lejana por un par de céntimos.
const PRICE_TIE_TOLERANCE = 0.02;

const ExplorerSidebar: React.FC<ExplorerSidebarProps> = ({
    stations,
    center,
    fuelType,
    sortType,
    selectedId,
    wide,
    brandOptions,
    selectedBrands,
    onBrandsChange,
    onFuelTypeChange,
    onSortTypeChange,
    onSelectStation,
}) => {
    const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [controlsHidden, setControlsHidden] = useState(false);
    const lastScrollTop = useRef(0);

    // Los filtros se ocultan al bajar (más sitio para la lista) y SOLO vuelven
    // a aparecer si el usuario pulsa el botón "Filtros" (no al volver a subir,
    // para que no salten solos mientras se hace scroll). Se compara con la
    // posición anterior (no con un valor absoluto): así, al mostrar los filtros
    // con el botón estando ya desplazados hacia abajo, no se ocultan de nuevo
    // solos por seguir "por debajo" del umbral sin haber vuelto a bajar.
    const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const st = e.currentTarget.scrollTop;
        const scrollingDown = st > lastScrollTop.current;
        if (scrollingDown && st > 60) setControlsHidden(true);
        lastScrollTop.current = st;
    };

    const sortedStations = useMemo(() => {
        const withDistances = stations.map((s) => ({
            ...s,
            distanceToCenter: getDistance(center[0], center[1], s.lat, s.lng),
        }));

        return withDistances.sort((a, b) => {
            if (sortType === 'distance') {
                return a.distanceToCenter - b.distanceToCenter;
            }
            const priceA = a.prices[fuelType] || Infinity;
            const priceB = b.prices[fuelType] || Infinity;
            // Precios prácticamente iguales (dentro de la tolerancia): gana la más cercana.
            const bucketA = Math.round(priceA / PRICE_TIE_TOLERANCE);
            const bucketB = Math.round(priceB / PRICE_TIE_TOLERANCE);
            if (bucketA !== bucketB) return priceA - priceB;
            return a.distanceToCenter - b.distanceToCenter;
        });
    }, [stations, center, sortType, fuelType]);

    // Cuando se selecciona una estación (desde el mapa), la traemos a la vista.
    useEffect(() => {
        if (selectedId && cardRefs.current[selectedId]) {
            cardRefs.current[selectedId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [selectedId]);

    return (
        <aside className={styles.sidebar}>
            <div className={styles.header}>
                <a href="/" className={styles.brand} title="Volver al inicio">
                    <img src="/images/logo-octo.webp" alt="OCTO" className={styles.brandLogo} width={540} height={201} />
                    <span className={styles.title}>Estaciones</span>
                </a>
            </div>

            <div className={`${styles.controls} ${controlsHidden ? styles.controlsHidden : ''}`}>
                <div className={styles.controlGroup} role="group" aria-labelledby="explorer-fuel-label">
                    <span className={styles.label} id="explorer-fuel-label">Combustible Principal</span>
                    <div className={styles.fuelRow}>
                        <div className={styles.fuelSelector}>
                            {MAIN_FUELS.map((f) => (
                                <button
                                    key={f}
                                    className={`${styles.fuelOption} ${fuelType === f ? styles.selected : ''}`}
                                    onClick={() => onFuelTypeChange(f)}
                                >
                                    {FUEL_LABELS[f]}
                                </button>
                            ))}
                        </div>
                        <select
                            className={`${styles.fuelSelect} ${OTHER_FUELS.includes(fuelType) ? styles.fuelSelectActive : ''}`}
                            value={OTHER_FUELS.includes(fuelType) ? fuelType : ''}
                            onChange={(e) => e.target.value && onFuelTypeChange(e.target.value as FuelType)}
                            title="Otros carburantes"
                        >
                            <option value="">Otros…</option>
                            {OTHER_FUELS.map((f) => (
                                <option key={f} value={f}>
                                    {FUEL_LABELS[f]}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className={styles.controlGroup} role="group" aria-labelledby="explorer-brands-label">
                    <span className={styles.label} id="explorer-brands-label">Marcas</span>
                    <BrandFilter
                        options={brandOptions}
                        selected={selectedBrands}
                        onChange={onBrandsChange}
                    />
                </div>

                <div className={styles.controlGroup} role="group" aria-labelledby="explorer-sort-label">
                    <span className={styles.label} id="explorer-sort-label">Ordenar por</span>
                    <div className={styles.sortSelector}>
                        <button
                            className={`${styles.sortOption} ${sortType === 'distance' ? styles.selected : ''}`}
                            onClick={() => onSortTypeChange('distance')}
                        >
                            <span className="material-symbols-outlined" aria-hidden="true">near_me</span>
                            Cercanía
                        </button>
                        <button
                            className={`${styles.sortOption} ${sortType === 'price' ? styles.selected : ''}`}
                            onClick={() => onSortTypeChange('price')}
                        >
                            <span className="material-symbols-outlined" aria-hidden="true">payments</span>
                            Precio
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.listContainer} onScroll={handleListScroll}>
                {controlsHidden && (
                    <button className={styles.showFiltersBtn} onClick={() => setControlsHidden(false)}>
                        <span className="material-symbols-outlined" aria-hidden="true">tune</span>
                        Filtros
                    </button>
                )}
                <div className={`${styles.stationList} ${wide ? styles.stationListWide : ''}`}>
                    {sortedStations.slice(0, MAX_RENDER).map((station) => {
                        const isSelected = station.id === selectedId;
                        const availableFuels = FUEL_ORDER.filter((f) => station.prices[f] != null);
                        const mainPrice = station.prices[fuelType];

                        return (
                            <div
                                key={station.id}
                                ref={(el) => {
                                    cardRefs.current[station.id] = el;
                                }}
                                className={`${styles.stationCard} ${isSelected ? styles.selectedCard : ''}`}
                                onClick={() => onSelectStation(station.id)}
                            >
                                <div className={styles.cardHeader}>
                                    <div className={styles.brandRow}>
                                        <BrandLogo brand={station.brand} size={40} />
                                        <div className={styles.nameBlock}>
                                            <h3 className={styles.stationName}>
                                                <a
                                                    className={styles.nameLink}
                                                    href={stationUrl(station)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    title="Ver ficha de la gasolinera"
                                                >
                                                    {station.name}
                                                </a>
                                            </h3>
                                            <CompareButton stationId={station.id} variant="mini" />
                                        </div>
                                    </div>
                                    <div className={styles.priceTag}>
                                        <span className={styles.priceMain}>{formatPrice(mainPrice)}</span>
                                        <span className={styles.priceUnit}>€/L · {FUEL_LABELS[fuelType]}</span>
                                    </div>
                                </div>

                                <p className={styles.stationAddress}>
                                    <span className="material-symbols-outlined" aria-hidden="true">location_on</span>
                                    {station.address}, {displayCity(station.city)}
                                    {station.postalCode ? ` (${station.postalCode})` : ''}
                                </p>

                                <div className={styles.priceGrid}>
                                    {availableFuels.map((f) => (
                                        <div
                                            key={f}
                                            className={`${styles.priceItem} ${fuelType === f ? styles.highlight : ''}`}
                                        >
                                            <span className={styles.priceType}>{FUEL_LABELS[f]}</span>
                                            <span className={styles.priceValue}>{formatPrice(station.prices[f])}</span>
                                        </div>
                                    ))}
                                </div>

                                <div className={styles.cardFooter}>
                                    <span className={styles.metaItem}>
                                        <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
                                        {station.schedule || 'Horario no disponible'}
                                    </span>
                                    <div className={styles.footerRight}>
                                        <span className={styles.distanceBadge}>
                                            {station.distanceToCenter.toFixed(1)} km
                                        </span>
                                        <a
                                            className={styles.routeLink}
                                            href={`https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            title="Cómo llegar"
                                        >
                                            <span className="material-symbols-outlined" aria-hidden="true">directions</span>
                                            Cómo llegar
                                        </a>
                                    </div>
                                </div>

                                {station.saleType === 'R' && (
                                    <span className={styles.restrictedTag}>Venta restringida (cooperativa/flota)</span>
                                )}
                            </div>
                        );
                    })}

                    {sortedStations.length === 0 && (
                        <div className={styles.emptyState}>
                            <span className="material-symbols-outlined" aria-hidden="true">location_off</span>
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
