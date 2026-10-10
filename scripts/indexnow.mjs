// Avisa a Bing y al resto de buscadores de IndexNow (Yandex, Seznam, Naver...) de las
// páginas que han cambiado, para que las rastreen enseguida en vez de esperar a pasar.
// Lo ejecuta deploy/refresh.sh después de cada publicación.
//
// Los precios cambian a diario, así que en rigor cambian todas las páginas; avisar de
// las ~15.000 dos veces al día sería abusar. Se avisa de:
//   - las páginas nuevas y las eliminadas (comparando con la publicación anterior);
//   - una vez al día: portada, páginas principales y provincias, más una séptima parte
//     del resto por turnos, de modo que cada página se notifica una vez por semana.
//
// Uso: node --env-file-if-exists=.env scripts/indexnow.mjs --dist <publicación>
//        [--prev <publicación anterior>] [--state <fichero>] [--dry-run]
// Necesita INDEXNOW_KEY (y que el build haya publicado /{clave}.txt). Nunca falla con
// código de error por un problema de IndexNow: la web ya está publicada.
import fs from 'node:fs';
import path from 'node:path';

// INDEXNOW_ENDPOINT solo para pruebas (un servidor falso que responda errores).
const ENDPOINT = process.env.INDEXNOW_ENDPOINT ?? 'https://api.indexnow.org/indexnow';
const MAX_PER_REQUEST = 10_000; // límite del protocolo
const ROTATION_DAYS = 7;

const args = process.argv.slice(2);
const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const dist = opt('--dist');
const prev = opt('--prev');
const stateFile = opt('--state');
const dryRun = args.includes('--dry-run');
if (!dist) {
    console.error('Uso: node scripts/indexnow.mjs --dist <carpeta> [--prev <carpeta>] [--state <fichero>] [--dry-run]');
    process.exit(2);
}
const log = (msg) => console.log(`IndexNow: ${msg}`);

/** URLs del sitemap de una publicación (sitemap-index.xml y sus sitemaps). */
function sitemapUrls(dir) {
    const index = path.join(dir, 'sitemap-index.xml');
    if (!dir || !fs.existsSync(index)) return null;
    const urls = new Set();
    for (const [, loc] of fs.readFileSync(index, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const file = path.join(dir, new URL(loc).pathname);
        if (!fs.existsSync(file)) continue;
        for (const [, u] of fs.readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(u);
    }
    return urls;
}

/**
 * Envía una tanda. Reintenta (3 intentos, esperando 20 s y 40 s) los fallos que pueden
 * ser pasajeros: red, 429 (demasiadas peticiones), 5xx y 403 (el primer envío con una
 * clave recién publicada a veces se rechaza antes de que el buscador la verifique).
 * 200 y 202 son éxito (202: recibido, la clave se verificará después).
 */
async function send(body) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        let problem;
        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(30_000),
            });
            if (res.status === 200 || res.status === 202) return true;
            problem = `respuesta ${res.status}: ${(await res.text()).slice(0, 200)}`;
            if (!(res.status === 403 || res.status === 429 || res.status >= 500)) {
                log(`AVISO: ${problem} (${body.urlList.length} URL, no se reintenta).`);
                return false;
            }
        } catch (err) {
            problem = `no se pudo contactar con ${ENDPOINT}: ${err.message}`;
        }
        log(`AVISO: intento ${attempt} de 3 fallido, ${problem}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 20_000));
    }
    return false;
}

/** Turno (0-6) de una URL: estable, para repartir el sitio entre los días de la semana. */
function turn(url) {
    let h = 2166136261;
    for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 16777619) >>> 0;
    return h % ROTATION_DAYS;
}

async function main() {
    const key = process.env.INDEXNOW_KEY;
    if (!key) return log('sin INDEXNOW_KEY, no se avisa (normal en local y en la integración continua).');
    if (!fs.existsSync(path.join(dist, `${key}.txt`))) return log(`falta /${key}.txt en la publicación; no se avisa.`);

    const current = sitemapUrls(dist);
    if (!current?.size) return log('sin sitemap en la publicación; no se avisa.');
    const before = sitemapUrls(prev) ?? new Set();
    const host = new URL([...current][0]).host;

    const added = [...current].filter((u) => !before.has(u));
    const removed = [...before].filter((u) => !current.has(u));

    // Turno diario (una vez al día aunque se publique dos veces).
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }); // AAAA-MM-DD
    let state = {};
    try {
        state = stateFile ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    } catch {}
    const daily = state.lastDaily !== today;
    const dayTurn = Math.floor(Date.parse(today) / 86_400_000) % ROTATION_DAYS;
    const isCore = (u) => /^\/(municipios\/|precios-combustible-espana\/|gasolineras-baratas\/[^/]+\/)?$/.test(new URL(u).pathname);
    const rotation = daily ? [...current].filter((u) => isCore(u) || turn(u) === dayTurn) : [];

    const urls = [...new Set([...added, ...removed, ...rotation])];
    const summary = `${added.length} nuevas, ${removed.length} eliminadas, ${rotation.length} del turno diario${daily ? '' : ' (ya hecho hoy)'}`;
    if (!urls.length) return log(`nada que avisar (${summary}).`);
    if (dryRun) return log(`[prueba] avisaría de ${urls.length} URL a ${host}: ${summary}. P. ej. ${urls.slice(0, 3).join(' ')}`);

    let ok = true;
    for (let i = 0; i < urls.length; i += MAX_PER_REQUEST) {
        if (!(await send({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls.slice(i, i + MAX_PER_REQUEST) }))) ok = false;
    }
    if (ok && daily && stateFile) fs.writeFileSync(stateFile, JSON.stringify({ ...state, lastDaily: today }) + '\n');
    log(`${ok ? 'avisadas' : 'aviso con errores:'} ${urls.length} URL de ${host} (${summary}).`);
}

main().catch((err) => log(`AVISO: ${err.message}`));
