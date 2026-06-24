/** Metadatos globales del sitio, reutilizados en SEO y Open Graph. */
export const SITE = {
    name: 'OCTO',
    /** Título por defecto / marca para Open Graph. */
    titleDefault: 'OCTO — Gasolineras baratas en España',
    /** Descripción por defecto (se sobreescribe por página). */
    description:
        'Compara el precio de la gasolina y el diésel en todas las gasolineras de España con datos oficiales del Ministerio. Encuentra la más barata cerca de ti y ahorra en cada repostaje.',
    /** Imagen por defecto para compartir en redes (debe existir en /public). */
    ogImage: '/images/logo-octo.png',
    locale: 'es_ES',
    twitter: '@octogas',
} as const;

/**
 * ID de editor de Google AdSense (formato ca-pub-XXXXXXXXXXXXXXXX).
 * Se lee de la variable de entorno PUBLIC_ADSENSE_ID. Mientras esté vacío,
 * los anuncios no se cargan (placeholders en su lugar).
 */
export const ADSENSE_ID: string = import.meta.env.PUBLIC_ADSENSE_ID ?? '';
