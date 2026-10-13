import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type MainMapComponent from './MainMap';

// Mapa de las páginas donde queda debajo del texto (municipios y fichas). Leaflet, sus
// estilos y las teselas (~170 KB) se descargan solo al acercarse al mapa con el
// scroll: no bloquean el primer pintado ni gastan datos si no se llega a verlo. En el
// explorador, donde el mapa es la página, se usa MainMap directamente.
const MainMap = lazy(() => import('./MainMap'));

export default function LazyMainMap(props: React.ComponentProps<typeof MainMapComponent>) {
    const ref = useRef<HTMLDivElement>(null);
    const [show, setShow] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el || !('IntersectionObserver' in window)) {
            setShow(true);
            return;
        }
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setShow(true);
                    io.disconnect();
                }
            },
            { rootMargin: '400px 0px' }
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    return (
        <div ref={ref} style={{ width: '100%', height: '100%' }}>
            {show && (
                <Suspense fallback={null}>
                    <MainMap {...props} />
                </Suspense>
            )}
        </div>
    );
}
