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
import FavoriteButton from '../Favorites/FavoriteButton';
import { hasBalance, hasDirect, myPriceAt, shortCents } from '../../lib/discounts';
import { useDiscounts } from '../Discounts/useDiscounts';
import styles from './StationMarker.module.css';

/**
 * Icono de marcador con el logo de la marca y un borde de color (precio,
 * estado…), compartido por todos los mapas de OCTO (Explorador y rutas). Con
 * `label`, a su derecha, el precio del combustible elegido; con Mis descuentos,
 * debajo y en pequeño: tachado el de surtidor (`pump`, si hay descuento directo:
 * el precio va entonces en verde) y lo que vuelve al saldo (`balance`, en céntimos).
 * Cacheado por (logo|color|seleccionado|etiqueta) para no recrear iconos en cada render.
 */
const iconCache = new Map<string, L.DivIcon>();
export function stationIcon(
    brand: string,
    color: string,
    selected = false,
    label?: { text: string; pump?: string; balance?: string }
): L.DivIcon {
    const file = BRAND_LOGO_FILES[slugify(brand)];
    const key = `${file ?? '_'}|${color}|${selected ? 1 : 0}|${label ? `${label.text}|${label.pump ?? ''}|${label.balance ?? ''}` : ''}`;
    const cached = iconCache.get(key);
    if (cached) return cached;

    const inner = file
        ? `<img src="/brands/${file}" alt="" />`
        : `<span class="material-symbols-outlined" aria-hidden="true">local_gas_station</span>`;
    const size = selected ? 44 : 34;
    const icon = L.divIcon({
        className: 'octo-marker-icon',
        html:
            `<div class="octo-marker ${selected ? 'octo-marker-sel' : ''}" style="--bc:${color}">${inner}</div>` +
            (label
                ? `<span class="octo-marker-price${label.pump ? ' octo-marker-bonus' : ''}" style="--bc:${color}"><b>${label.text}</b>${
                      label.pump || label.balance
                          ? `<span class="octo-marker-sub">${label.pump ? `<s>${label.pump}</s>` : ''}${
                                label.balance
                                    ? `<span class="octo-marker-bal"><span class="material-symbols-outlined" aria-hidden="true">savings</span>${label.balance}</span>`
                                    : ''
                            }</span>`
                          : ''
                  }</span>`
                : ''),
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
    // Con Mis descuentos: lo que se paga, el de surtidor tachado si hay directos y lo que vuelve al saldo.
    const discounts = useDiscounts();
    const mineOf = (f: FuelType) => myPriceAt(discounts, station, f, station.prices[f]);
    const mines = availableFuels.map(mineOf).filter((m) => m !== undefined);
    const applied = [...new Set(mines.flatMap((m) => m.applied.map((d) => d.name)))];
    // Lo que vuelve al saldo, en palabras: el del combustible elegido (o el primero que lo tenga).
    const withBalance = [mineOf(fuelType), ...mines].find((m) => m && hasBalance(m));
    const names = applied.length > 1 ? `${applied.slice(0, -1).join(', ')} y ${applied[applied.length - 1]}` : applied[0];
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
                {availableFuels.map((f) => {
                    const mine = mineOf(f);
                    return (
                        <div key={f} className={`${styles.popupFuel} ${f === fuelType ? styles.popupFuelActive : ''}`}>
                            <span className={styles.popupFuelLabel}>{FUEL_LABELS[f]}</span>
                            <span className={styles.popupFuelPrice}>{(mine?.pay ?? station.prices[f]!).toFixed(3)}</span>
                            {mine && hasDirect(mine) && <s className={styles.popupPump}>{station.prices[f]!.toFixed(3)}</s>}
                            {mine && hasBalance(mine) && (
                                <span className={styles.popupBalance} title="Vuelve a tu saldo (céntimos por litro)">
                                    <span className="material-symbols-outlined" aria-hidden="true">savings</span>+{shortCents(mine.balance)}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
            {applied.length > 0 && (
                <p className={styles.popupDiscounts}>
                    Con <a href="/mis-descuentos/">{names}</a>
                    {withBalance && `: ${shortCents(withBalance.balance)} céntimos el litro vuelven como saldo`}.
                </p>
            )}
            <div className={styles.popupFooter}>
                <span className={styles.popupSchedule}>
                    <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
                    {station.schedule || 'Horario no disponible'}
                </span>
                <div className={styles.popupActions}>
                    <FavoriteButton stationId={station.id} variant="icon" />
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
