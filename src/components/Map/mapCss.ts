// Estilos de Leaflet y de los grupos de marcadores. Van dentro del JS del mapa (que se
// descarga aparte) en vez de en una hoja enlazada en la cabecera: así no bloquean el
// primer pintado de las 15.000 páginas que llevan mapa. Se insertan al principio del
// <head> para que los estilos de la web, que van después, sigan mandando sobre ellos.
import leafletCss from 'leaflet/dist/leaflet.css?inline';
import clusterCss from 'react-leaflet-cluster/dist/assets/MarkerCluster.css?inline';
import clusterDefaultCss from 'react-leaflet-cluster/dist/assets/MarkerCluster.Default.css?inline';

export function injectMapCss() {
    if (typeof document === 'undefined' || document.getElementById('octo-map-css')) return;
    const style = document.createElement('style');
    style.id = 'octo-map-css';
    style.textContent = leafletCss + clusterCss + clusterDefaultCss;
    document.head.insertBefore(style, document.head.querySelector('link[rel="stylesheet"], style'));
}
