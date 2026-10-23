/**
 * Buscador de la cabecera (components/Search/SiteSearch.astro): municipios, provincias,
 * gasolineras y páginas de la web. Sin acentos ni mayúsculas ("cordoba" encuentra
 * Córdoba) y por principio de palabra ("san seb" → San Sebastián, "repsol getafe" →
 * las Repsol de Getafe). El índice (lib/searchIndex.ts) se descarga al abrirlo: primero
 * los lugares, que pesan poco, y después el completo con las gasolineras.
 */
import type { SearchIndex } from './searchIndex';
import { displayAddress } from './format';
import { stationSlug } from './stationUrl';

export type ResultKind = 'municipio' | 'provincia' | 'gasolinera' | 'pagina';

export interface SearchResult {
    kind: ResultKind;
    title: string;
    sub: string;
    url: string;
    icon: string;
}

export interface SearchGroup {
    label: string;
    items: SearchResult[];
}

interface Entry extends SearchResult {
    /** Nombre normalizado (para puntuar las coincidencias exactas o al principio). */
    name: string;
    /** Lo que se puede buscar, normalizado y con un espacio delante de cada palabra. */
    hay: string;
    /** Gasolineras: su municipio y provincia, que ayudan a afinar pero no bastan solos. */
    context?: string;
    /** Desempate: gasolineras del municipio (los grandes primero). */
    weight: number;
}

interface Prepared {
    munis: Entry[];
    provinces: Entry[];
    stations: Entry[];
}

/** Minúsculas, sin acentos y solo letras y números separados por un espacio. */
export function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

const isGenericBrand = (brand: string) => /^n[ºo°]/i.test(brand) || /^\d/.test(brand);

const result = ({ kind, title, sub, url, icon }: SearchResult): SearchResult => ({ kind, title, sub, url, icon });

// Iconos como `icon: '...'` para que scripts/update-icons.mjs los encuentre.
const page = (p: { title: string; sub: string; url: string; icon: string; words: string }): Entry => ({
    kind: 'pagina',
    title: p.title,
    sub: p.sub,
    url: p.url,
    icon: p.icon,
    name: normalize(p.title),
    hay: ` ${normalize(`${p.title} ${p.words}`)}`,
    weight: 0,
});

const PAGES: Entry[] = [
    page({ title: 'Gasolineras cerca de mí', sub: 'Mapa con tu ubicación', url: '/explorador/?mode=location', icon: 'my_location', words: 'cerca ubicacion mapa' }),
    page({ title: 'Precio medio en España', sub: 'Gasolina, diésel y su evolución', url: '/precios-combustible-espana/', icon: 'trending_up', words: 'media nacional espana evolucion gasolina diesel' }),
    page({ title: 'Gasolineras con GLP', sub: 'Autogás más barato', url: '/gasolineras-glp/', icon: 'local_gas_station', words: 'glp autogas gas licuado' }),
    page({ title: 'Gasóleo agrícola', sub: 'Gasóleo B más barato', url: '/gasoleo-agricola/', icon: 'local_gas_station', words: 'gasoleo b tractor' }),
    page({ title: 'Planificar viaje', sub: 'Las más baratas en tu ruta', url: '/rutas/', icon: 'route', words: 'ruta trayecto' }),
    page({ title: 'Comparador', sub: 'Compara gasolineras lado a lado', url: '/comparador/', icon: 'balance', words: 'comparar' }),
    page({ title: 'Mis gasolineras', sub: 'Tus guardadas y avisos de precio', url: '/mis-gasolineras/', icon: 'bookmarks', words: 'guardadas favoritas avisos' }),
];

/** Accesos rápidos del buscador vacío. */
export const QUICK_LINKS: SearchResult[] = PAGES.filter((p) =>
    ['/explorador/?mode=location', '/precios-combustible-espana/', '/rutas/', '/mis-gasolineras/'].includes(p.url)
).map(result);

function prepare(index: SearchIndex): Prepared {
    const provinces: Entry[] = index.p.map(([name, slug, alias]) => ({
        kind: 'provincia',
        title: `Provincia de ${name}`,
        sub: 'Sus gasolineras y municipios',
        url: `/gasolineras-baratas/${slug}/`,
        icon: 'map',
        name: normalize(`${name} ${alias ?? ''}`),
        hay: ` provincia ${normalize(`${name} ${alias ?? ''}`)}`,
        weight: 0,
    }));
    const munis: Entry[] = index.m.map(([name, pi, slug, count, alias]) => {
        const [provName, provSlug, provAlias] = index.p[pi];
        return {
            kind: 'municipio',
            title: name,
            sub: provName,
            url: `/gasolineras-baratas/${provSlug}/${slug}/`,
            icon: 'location_city',
            name: normalize(`${name} ${alias ?? ''}`),
            hay: ` ${normalize(`${name} ${alias ?? ''} ${provName} ${provAlias ?? ''}`)}`,
            weight: count,
        };
    });
    const stations: Entry[] = (index.s ?? []).map(([brand, address, mi, id]) => {
        const muni = munis[mi];
        const generic = isGenericBrand(brand);
        const addr = displayAddress(address);
        return {
            kind: 'gasolinera',
            title: generic ? addr : brand,
            sub: generic ? `${muni.title} (${muni.sub})` : `${addr} · ${muni.title}`,
            url: `${muni.url}${stationSlug({ id, brand, address, city: '', province: '' })}/`,
            icon: 'local_gas_station',
            name: generic ? '' : normalize(brand),
            hay: ` ${normalize(`${generic ? '' : brand} ${address}`)}`,
            context: muni.hay,
            weight: muni.weight,
        };
    });
    return { munis, provinces, stations };
}

let prepared: Prepared | null = null;
let full = false;
let loading: Promise<void> | null = null;
let notify: () => void = () => {};

/**
 * Descarga el índice (una vez por página) y llama a `onUpdate` cada vez que hay datos
 * nuevos: con los lugares y, después, con las gasolineras. Si falla, el siguiente
 * intento lo repite.
 */
export function loadSearchIndex(onUpdate: () => void): Promise<void> {
    notify = onUpdate;
    if (full) return Promise.resolve();
    loading ??= (async () => {
        const get = (file: string) =>
            fetch(`/data/buscador/${file}`).then((r) => (r.ok ? (r.json() as Promise<SearchIndex>) : Promise.reject(new Error(`HTTP ${r.status}`))));
        const all = get('gasolineras.json');
        all.catch(() => {}); // Se espera más abajo; así no sale como error sin atender.
        try {
            const places = await get('lugares.json');
            if (!full) {
                prepared = prepare(places);
                notify();
            }
        } catch {
            // Sin el pequeño, todavía puede llegar el completo.
        }
        prepared = prepare(await all);
        full = true;
        notify();
    })().finally(() => {
        loading = null;
    });
    return loading;
}

/** Qué se puede buscar ya: lugares (índice pequeño) y gasolineras (el completo). */
export const searchReady = () => ({ places: prepared !== null, stations: full });

/** Si cada palabra buscada es el principio de alguna palabra de `hay`. */
const matchesAll = (hay: string, tokens: string[]) => tokens.every((t) => hay.includes(` ${t}`));

/**
 * 0 = nombre exacto, 1 = el nombre empieza por lo buscado, 2 = todas las palabras en el
 * nombre, 3 = alguna en el nombre y el resto en la provincia ("getafe madrid"), -1 = no.
 */
function placeScore(e: Entry, q: string, tokens: string[]): number {
    if (!matchesAll(e.hay, tokens)) return -1;
    if (e.name === q) return 0;
    if (e.name.startsWith(q)) return 1;
    const name = ` ${e.name}`;
    if (matchesAll(name, tokens)) return 2;
    return tokens.some((t) => name.includes(` ${t}`)) ? 3 : -1;
}

/**
 * 0 = marca y lugar ("repsol getafe"), 1 = marca, 2 = dirección y lugar ("mayor getafe"),
 * 3 = dirección, -1 = no. Algo de la propia gasolinera tiene que coincidir (solo con el
 * municipio ya sale el municipio) y, con una sola palabra, la marca: si no, "madrid"
 * sacaría calles de Madrid de toda España.
 */
function stationScore(e: Entry, tokens: string[]): number {
    const brand = ` ${e.name}`;
    let own = false;
    let brandHit = false;
    let placeHit = false;
    for (const t of tokens) {
        const inOwn = e.hay.includes(` ${t}`);
        const inPlace = (e.context ?? '').includes(` ${t}`);
        if (!inOwn && !inPlace) return -1;
        own ||= inOwn;
        placeHit ||= inPlace;
        brandHit ||= inOwn && e.name !== '' && brand.includes(` ${t}`);
    }
    if (!own) return -1;
    if (brandHit) return placeHit ? 0 : 1;
    if (tokens.length === 1) return -1;
    return placeHit ? 2 : 3;
}

// Palabras de relleno que se quitan al buscar lugares y gasolineras: "gasolineras
// baratas en Getafe" → "getafe". Las páginas sí las usan ("precio medio").
const FILLER = new Set(
    'gasolinera gasolineras gasolina diesel gasoleo gasoil combustible barata baratas barato mas cerca precio precios hoy en de del la el los las y mi'.split(' ')
);

function top(list: Entry[], scoreOf: (e: Entry) => number, limit: number): SearchResult[] {
    const scored: [Entry, number][] = [];
    for (const e of list) {
        const s = scoreOf(e);
        if (s >= 0) scored.push([e, s]);
    }
    scored.sort((a, b) => a[1] - b[1] || b[0].weight - a[0].weight || a[0].title.localeCompare(b[0].title, 'es'));
    return scored.slice(0, limit).map(([e]) => result(e));
}

/** Resultados agrupados, sin los grupos vacíos. */
export function search(query: string): SearchGroup[] {
    const q = normalize(query);
    if (!q) return [];
    const tokens = q.split(' ');
    const groups: SearchGroup[] = [];
    const add = (label: string, items: SearchResult[]) => items.length && groups.push({ label, items });
    // Las páginas, antes que los lugares si su nombre empieza por lo buscado ("glp",
    // "comparador"); si no, antes que las gasolineras.
    const pages = top(PAGES, (e) => (matchesAll(e.hay, tokens) ? (e.name.startsWith(q) ? 0 : 1) : -1), 3);
    const pagesFirst = PAGES.some((e) => e.name.startsWith(q));
    if (pagesFirst) add('Páginas', pages);
    const kept = tokens.filter((t) => !FILLER.has(t));
    const words = kept.length ? kept : tokens;
    const text = words.join(' ');
    if (prepared) {
        add('Municipios', top(prepared.munis, (e) => placeScore(e, text, words), 6));
        add('Provincias', top(prepared.provinces, (e) => placeScore(e, text, words), 2));
    }
    if (!pagesFirst) add('Páginas', pages);
    // Con una o dos letras saldrían cientos de gasolineras al azar.
    if (prepared && text.length >= 3) add('Gasolineras', top(prepared.stations, (e) => stationScore(e, words), 5));
    return groups;
}
