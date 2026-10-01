/** Metadatos globales del sitio, reutilizados en SEO y Open Graph. */
export const SITE = {
    name: 'OCTO',
    /** Título por defecto / marca para Open Graph. */
    titleDefault: 'OCTO — Gasolineras baratas en España',
    /** Descripción por defecto (se sobreescribe por página). */
    description:
        'Compara el precio de la gasolina y el diésel en todas las gasolineras de España con datos oficiales del Ministerio. Encuentra la más barata cerca de ti y ahorra en cada repostaje.',
    /** Imagen por defecto para compartir en redes (debe existir en /public): 1200×630,
     *  el formato que usan WhatsApp, X, Facebook o LinkedIn para la vista previa grande. */
    ogImage: '/images/og-octo.png',
    locale: 'es_ES',
    twitter: '@octogas',
} as const;

/**
 * ID de editor de Google AdSense (formato ca-pub-XXXXXXXXXXXXXXXX).
 * Se lee de la variable de entorno PUBLIC_ADSENSE_ID. Mientras esté vacío,
 * los anuncios no se cargan y los huecos de anuncio no ocupan espacio.
 */
export const ADSENSE_ID: string = import.meta.env.PUBLIC_ADSENSE_ID ?? '';

/**
 * Código de verificación de Google Search Console: solo el valor del atributo
 * `content` de la etiqueta <meta name="google-site-verification">. Se lee de
 * PUBLIC_GOOGLE_SITE_VERIFICATION. Mientras esté vacío, no se inserta la etiqueta.
 */
export const GOOGLE_SITE_VERIFICATION: string =
    import.meta.env.PUBLIC_GOOGLE_SITE_VERIFICATION ?? '';
