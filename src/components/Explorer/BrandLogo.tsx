import React, { useState } from 'react';
import { brandColors, brandInitials, BRANDS_WITH_LOGO } from '../../lib/brands';
import { slugify } from '../../lib/slug';
import styles from './BrandLogo.module.css';

interface BrandLogoProps {
    brand: string;
    size?: number;
}

/**
 * Insignia de marca: muestra un monograma con el color corporativo.
 * Si la marca tiene un logo real registrado en /public/brands/<slug>.<ext>
 * (webp/avif/svg/png), lo usa; si falla la carga, cae al monograma de color.
 */
const BrandLogo: React.FC<BrandLogoProps> = ({ brand, size = 40 }) => {
    const slug = slugify(brand);
    const ext = BRANDS_WITH_LOGO.get(slug);
    const [useImage, setUseImage] = useState(!!ext);
    const { bg, fg } = brandColors(brand);
    const initials = brandInitials(brand);

    return (
        <div
            className={styles.badge}
            style={{ width: size, height: size, backgroundColor: bg, color: fg, fontSize: size * 0.4 }}
            title={brand}
            aria-label={brand}
        >
            {useImage && ext ? (
                <img
                    src={`/brands/${slug}.${ext}`}
                    alt={brand}
                    className={styles.logoImg}
                    onError={() => setUseImage(false)}
                    loading="lazy"
                />
            ) : (
                <span>{initials}</span>
            )}
        </div>
    );
};

export default BrandLogo;
