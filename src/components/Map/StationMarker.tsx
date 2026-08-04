import React from 'react';
import L from 'leaflet';
import type { GasStation, FuelType } from '../../types/gasolinera';
import { FUEL_LABELS, FUEL_ORDER } from '../../lib/fuels';
import { stationUrl } from '../../lib/stationUrl';
import { displayCity } from '../../lib/placeName';
import { slugify } from '../../lib/slug';
import { BRAND_LOGO_FILES } from '../../lib/brandLogos';
import BrandLogo from '../Explorer/BrandLogo';
import CompareButton from '../Explorer/CompareButton';
import styles from './StationMarker.module.css';

/**
 * Icono de marcador con el logo de la marca y un borde de color (precio,
 * estado…), compartido por todos los mapas de OCTO (Explorador y rutas).
 * Cacheado por (logo|color|seleccionado) para no recrear iconos en cada render.
 */
const iconCache = new Map<string, L.DivIcon>();
export function stationIcon(brand: string, color: string, selected = false): L.DivIcon {
    const file = BRAND_LOGO_FILES[slugify(brand)];
    const key = `${file ?? '_'}|${color}|${selected ? 1 : 0}`;
    const cached = iconCache.get(key);
    if (cached) return cached;

    const inner = file
        ? `<img src="/brands/${file}" alt="" />`
        : `<span class="material-symbols-outlined" aria-hidden="true">local_gas_station</span>`;
    const size = selected ? 44 : 34;
    const icon = L.divIcon({
        className: 'octo-marker-icon',
        html: `<div class="octo-marker ${selected ? 'octo-marker-sel' : ''}" style="--bc:${color}">${inner}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2 + 2],
    });
    iconCache.set(key, icon);
    return icon;
}

/** Ficha emergente de una gasolinera (logo, precios, horario, comparar, cómo llegar). */
export const StationPopup: React.FC<{ station: GasStation; fuelType: FuelType }> = ({ station, fuelType }) => {
    const availableFuels = FUEL_ORDER.filter((f) => station.prices[f] != null);
    return (
        <div className={styles.popupBody}>
            <div className={styles.popupTop}>
                <BrandLogo brand={station.brand} size={38} />
                <div className={styles.popupTitleBlock}>
                    <h3 className={styles.popupHeader}>
                        <a className={styles.popupNameLink} href={stationUrl(station)}>{station.name}</a>
                    </h3>
                    <p className={styles.popupAddress}>{station.address}, {displayCity(station.city)}</p>
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
                <span className={styles.popupSchedule}>
                    <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
                    {station.schedule || 'Horario no disponible'}
                </span>
                <div className={styles.popupActions}>
                    <CompareButton stationId={station.id} variant="icon" />
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
        </div>
    );
};

export { styles as stationMarkerStyles };
