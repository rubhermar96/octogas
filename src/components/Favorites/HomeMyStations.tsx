import React from 'react';
import MyStations from './MyStations';
import { useFavoriteIds } from './FavoriteButton';

interface Props {
    /** Clases de la portada (Home.module.css) para que la sección sea como las demás. */
    sectionClass: string;
    innerClass: string;
    headClass: string;
    eyebrowClass: string;
    titleClass: string;
}

/** "Mis gasolineras" en la portada: solo aparece si hay alguna guardada. */
const HomeMyStations: React.FC<Props> = ({ sectionClass, innerClass, headClass, eyebrowClass, titleClass }) => {
    const ids = useFavoriteIds();
    if (!ids.length) return null;
    return (
        <section className={sectionClass} id="mis-gasolineras">
            <div className={innerClass}>
                <div className={headClass}>
                    <span className={eyebrowClass}>Guardadas en este dispositivo</span>
                    <h2 className={titleClass}>Mis gasolineras hoy</h2>
                </div>
                <MyStations compact />
            </div>
        </section>
    );
};

export default HomeMyStations;
