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
├── public/
│   └── data/               # Datos generados y servidos como estáticos
│                           #   - stations.json (todas las estaciones)
│                           #   - municipios.json (índice ligero para autocompletado)
├── src/
│   ├── components/         # Componentes React y Astro (Mapas, Botones, Tarjetas)
│   ├── layouts/            # Layouts principales de Astro (Layout.astro)
│   ├── lib/                # Utilidades compartidas (slugify, normalización de marcas)
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
| `npm run update-data` | Descarga los últimos precios del Ministerio y regenera `public/data/stations.json` y `public/data/municipios.json`. **Debe ejecutarse antes del primer `build`** (los datos están en `.gitignore`). |
| `npm run dev` | Inicia el servidor de desarrollo local en `localhost:4321`. |
| `npm run build` | Construye el sitio para producción en la carpeta `./dist/`. |
| `npm run preview` | Previsualiza el build de producción localmente. |

## 🔄 Actualización de Datos

Los precios de las gasolineras en España cambian constantemente. Para tener la aplicación actualizada con los últimos datos proporcionados por el Gobierno, ejecuta:

```bash
npm run update-data
```

Esto procesa más de 11.000 estaciones de servicio terrestres, filtra las que no tienen ubicación válida ni ningún precio, normaliza las marcas y guarda la información en `public/data/`. Los datos **no se versionan en git** (cambian a diario): se regeneran en cada despliegue o mediante una tarea programada (cron) que vuelve a ejecutar `npm run update-data`.

---
*Construido con 💚 usando Astro.*
