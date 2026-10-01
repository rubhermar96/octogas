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
 * Titular de la web, para los textos legales. El RGPD obliga a identificar al
 * responsable del tratamiento de datos (nombre y forma de contacto). El NIF y el
 * domicilio los exige la LSSI cuando la web es una actividad económica —p. ej. al
 * activar publicidad—; mientras no la haya, no se muestran.
 */
export const OWNER = {
    /** Nombre y apellidos (o razón social). */
    name: '',
    /** Solo se muestran con publicidad activa. */
    nif: '',
    address: '',
    email: 'contactaocto@gmail.com',
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
