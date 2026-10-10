import type { APIRoute, GetStaticPaths } from "astro";

/**
 * Fichero de verificación de IndexNow (Bing, Yandex, Seznam...): /{clave}.txt con la
 * clave dentro, que demuestra que los avisos de scripts/indexnow.mjs vienen del dueño
 * del dominio. La clave no es secreta (el protocolo exige publicarla); vive en el .env
 * del servidor (INDEXNOW_KEY, la crea deploy/refresh.sh). Sin ella, en local y en la
 * integración continua, no se genera el fichero.
 */
export const getStaticPaths: GetStaticPaths = () => {
    const key = (import.meta.env.INDEXNOW_KEY ?? process.env.INDEXNOW_KEY) as string | undefined;
    return key && /^[A-Za-z0-9-]{8,128}$/.test(key) ? [{ params: { indexnowKey: key } }] : [];
};

export const GET: APIRoute = ({ params }) =>
    new Response(params.indexnowKey, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
