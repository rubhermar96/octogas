import React, { useState, useMemo } from 'react';
import type { GasStation, FuelType } from '../../types/gasolinera';
import { FUEL_LABELS } from '../../lib/fuels';
import BrandLogo from '../Explorer/BrandLogo';
import styles from './MunicipioTop.module.css';

interface Props {
    stations: GasStation[];
    explorerUrl: string;
}

const CANDIDATE_FUELS: FuelType[] = ['sp95', 'sp98', 'diesel', 'glp'];

const MunicipioTop: React.FC<Props> = ({ stations, explorerUrl }) => {
    // Solo ofrecemos combustibles que existen en el municipio.
    const fuels = useMemo(
        () => CANDIDATE_FUELS.filter((f) => stations.some((s) => s.prices[f] != null)),
        [stations]
    );
    const [fuel, setFuel] = useState<FuelType>(fuels[0] ?? 'sp95');

    const top = useMemo(() => {
        return stations
            .filter((s) => s.prices[fuel] != null)
            .sort((a, b) => (a.prices[fuel] as number) - (b.prices[fuel] as number))
            .slice(0, 10);
    }, [stations, fuel]);

    return (
        <section className={styles.wrapper}>
            <div className={styles.head}>
                <h2>Top 10 más baratas</h2>
                <div className={styles.fuelSelector}>
                    {fuels.map((f) => (
                        <button
                            key={f}
                            className={`${styles.fuelBtn} ${fuel === f ? styles.active : ''}`}
                            onClick={() => setFuel(f)}
                        >
                            {FUEL_LABELS[f]}
                        </button>
                    ))}
                </div>
            </div>

            <ol className={styles.list}>
                {top.map((s, i) => (
                    <li key={s.id} className={styles.row}>
                        <span className={styles.rank}>{i + 1}</span>
                        <BrandLogo brand={s.brand} size={36} />
                        <div className={styles.info}>
                            <span className={styles.name}>{s.name}</span>
                            <span className={styles.addr}>
                                {s.address}, {s.city}
                            </span>
                        </div>
                        <div className={styles.priceCol}>
                            <span className={styles.price}>{(s.prices[fuel] as number).toFixed(3)}</span>
                            <span className={styles.unit}>€/L</span>
                        </div>
                        <a
                            className={styles.go}
                            href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Cómo llegar"
                        >
                            <span className="material-symbols-outlined">directions</span>
                        </a>
                    </li>
                ))}
            </ol>

            <a className={styles.cta} href={explorerUrl}>
                <span className="material-symbols-outlined">explore</span>
                Ver todas y explorar el municipio en el mapa
            </a>
        </section>
    );
};

export default MunicipioTop;
