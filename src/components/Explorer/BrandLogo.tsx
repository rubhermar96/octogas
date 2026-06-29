import React, { useState } from 'react';
import { brandColors } from '../../lib/brands';
import { BRAND_LOGO_FILES } from '../../lib/brandLogos';
import { slugify } from '../../lib/slug';
import styles from './BrandLogo.module.css';

interface BrandLogoProps {
    brand: string;
    size?: number;
}

/**
 * Insignia de marca. Si hay un logo real en /public/brands (registrado en
 * brandLogos.ts, generado desde la carpeta), lo muestra; si no hay logo o falla
 * la carga, muestra un icono genérico de gasolinera sobre el color de la marca.
 */
const BrandLogo: React.FC<BrandLogoProps> = ({ brand, size = 40 }) => {
    const slug = slugify(brand);
    const file = BRAND_LOGO_FILES[slug];
    const [useImage, setUseImage] = useState(!!file);
    const { bg, fg } = brandColors(brand);

    return (
        <div
            className={styles.badge}
            style={{ width: size, height: size, backgroundColor: useImage ? '#fff' : bg, color: fg }}
            title={brand}
            aria-label={brand}
        >
            {useImage && file ? (
                <img
                    src={`/brands/${file}`}
                    alt={brand}
                    className={styles.logoImg}
                    onError={() => setUseImage(false)}
                    loading="lazy"
                />
            ) : (
                <span className="material-symbols-outlined" style={{ fontSize: size * 0.58 }}>
                    local_gas_station
                </span>
            )}
        </div>
    );
};

export default BrandLogo;
