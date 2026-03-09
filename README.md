# Octogas 🐙⛽

Octogas es una aplicación web rápida y moderna para consultar los precios de las gasolineras en España, construida con Astro, React y Leaflet.

## 🚀 Características Principales

- **Mapa Interactivo**: Visualiza todas las gasolineras de España en un mapa interactivo (usando `react-leaflet` y `react-leaflet-cluster`).
- **Rutas Dinámicas**: Encuentra las gasolineras más baratas filtradas por provincia y municipio (`/gasolineras-baratas/[provincia]/[municipio]`).
- **Datos Oficiales**: Los precios se obtienen directamente de la API REST del Ministerio para la Transición Ecológica y el Reto Demográfico del Gobierno de España.
- **Modo Oscuro/Claro**: Interfaz adaptable a las preferencias del sistema o del usuario.
- **Rendimiento Extremo**: Construido con Astro para entregar la mínima cantidad de JavaScript posible al cliente.
- **Diseño Responsivo**: Totalmente adaptable a dispositivos móviles y de escritorio.

## 🛠️ Tecnologías Utilizadas

- **Framework**: [Astro 5](https://astro.build/)
- **UI Components**: [React 19](https://react.dev/)
- **Mapas**: [Leaflet](https://leafletjs.com/) & [React Leaflet](https://react-leaflet.js.org/)
- **Iconos**: [Lucide React](https://lucide.dev/)
- **Tipografías**: Geist Sans & Unbounded (`@fontsource`)
- **Scripting**: TypeScript (ejecutado con `tsx`)

## 📦 Estructura del Proyecto

```text
/
├── public/                 # Archivos estáticos e imágenes (logo, iconos)
├── src/
│   ├── components/         # Componentes React y Astro (Mapas, Botones, Tarjetas)
│   ├── data/               # Datos generados (gasolineras.json)
│   ├── layouts/            # Layouts principales de Astro (Layout.astro)
│   ├── pages/              # Rutas de la aplicación (index, municipio, rutas dinámicas)
│   ├── scripts/            # Scripts de utilidad (actualización de precios)
│   ├── styles/             # Hojas de estilo globales y módulos CSS
│   └── types/              # Definiciones de tipos TypeScript
├── astro.config.mjs        # Configuración de Astro
└── package.json            # Dependencias y scripts
```

## 🧞 Comandos de Desarrollo

| Comando | Acción |
| :--- | :--- |
| `npm install` | Instala todas las dependencias del proyecto. |
| `npm run update-data` | Ejecuta el script `src/scripts/update-prices.ts` para descargar los últimos precios del Ministerio y actualizar `src/data/gasolineras.json`. |
| `npm run dev` | Inicia el servidor de desarrollo local en `localhost:4321`. |
| `npm run build` | Construye el sitio para producción en la carpeta `./dist/`. |
| `npm run preview` | Previsualiza el build de producción localmente. |

## 🔄 Actualización de Datos

Los precios de las gasolineras en España cambian constantemente. Para tener la aplicación actualizada con los últimos datos proporcionados por el Gobierno, ejecuta:

```bash
npm run update-data
```

Esto procesará más de 12,000 estaciones de servicio terrestres, filtrará aquellas sin ubicación válida y guardará la información estructurada en `src/data/gasolineras.json`.

---
*Construido con 💚 usando Astro.*
