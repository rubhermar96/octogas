import React, { useMemo, useState } from "react";
import type { FuelType } from "../../types/gasolinera";
import { FUEL_LABELS, MAIN_FUELS, OTHER_FUELS, FUEL_ORDER } from "../../lib/fuels";
import { stationUrl } from "../../lib/stationUrl";
import { displayProvince, displayCity } from "../../lib/placeName";
import BrandLogo from "../Explorer/BrandLogo";
import styles from "./NationalTopFuels.module.css";

export interface TopStation {
    id: string;
    brand: string;
    address: string;
    city: string;
    province: string;
    price: number;
}

interface Props {
    /** Top 10 más baratas por combustible (solo los que tienen datos suficientes). */
    topByFuel: Partial<Record<FuelType, TopStation[]>>;
}

const fmtPrice = (p: number) => p.toFixed(3);
const isGenericBrand = (brand: string) => /^n[ºo°]/i.test(brand) || /^\d/.test(brand);

const NationalTopFuels: React.FC<Props> = ({ topByFuel }) => {
    const available = useMemo(() => FUEL_ORDER.filter((f) => (topByFuel[f]?.length ?? 0) > 0), [topByFuel]);
    const [fuel, setFuel] = useState<FuelType | null>(available[0] ?? null);
    const selected = fuel && available.includes(fuel) ? fuel : available[0] ?? null;
    const list = (selected && topByFuel[selected]) || [];

    if (!selected || list.length === 0) return null;

    const mainAvailable = MAIN_FUELS.filter((f) => available.includes(f));
    const otherAvailable = OTHER_FUELS.filter((f) => available.includes(f));

    return (
        <div className={styles.wrap}>
            <div className={styles.fuelRow}>
                <div className={styles.fuelSelector}>
                    {mainAvailable.map((f) => (
                        <button
                            key={f}
                            className={`${styles.fuelOption} ${selected === f ? styles.active : ""}`}
                            onClick={() => setFuel(f)}
                        >
                            {FUEL_LABELS[f]}
                        </button>
                    ))}
                </div>
                {otherAvailable.length > 0 && (
                    <select
                        className={`${styles.fuelSelect} ${otherAvailable.includes(selected) ? styles.fuelSelectActive : ""}`}
                        value={otherAvailable.includes(selected) ? selected : ""}
                        onChange={(e) => e.target.value && setFuel(e.target.value as FuelType)}
                        title="Otros carburantes"
                            aria-label="Otros carburantes"
                    >
                        <option value="">Otros…</option>
                        {otherAvailable.map((f) => (
                            <option key={f} value={f}>
                                {FUEL_LABELS[f]}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            <ol className={styles.list}>
                {list.map((s, i) => (
                    <li key={s.id} className={`${styles.row} ${i === 0 ? styles.first : ""}`}>
                        <span className={styles.rank}>{i + 1}</span>
                        <BrandLogo brand={s.brand} size={38} />
                        <a className={styles.info} href={stationUrl(s)} title="Ver ficha de la gasolinera">
                            <span className={styles.name}>{isGenericBrand(s.brand) ? "Gasolinera independiente" : s.brand}</span>
                            <span className={styles.addr}>
                                {displayCity(s.city)} · {displayProvince(s.province)}
                            </span>
                        </a>
                        <div className={styles.priceCol}>
                            <span className={styles.price}>{fmtPrice(s.price)}</span>
                            <span className={styles.unit}>€/L</span>
                        </div>
                    </li>
                ))}
            </ol>
        </div>
    );
};

export default NationalTopFuels;
