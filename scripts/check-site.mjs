// Revisa la web generada (dist/) antes de publicarla. Falla (código de salida 1) si
// encuentra enlaces internos rotos o páginas sin título, sin descripción, sin h1, con
// varios h1 o con un título repetido. Lo ejecuta la integración continua tras el build.
//
// Uso: node scripts/check-site.mjs [carpeta]   (por defecto: dist)
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.argv[2] ?? 'dist');
if (!fs.existsSync(DIST)) {
    console.error(`No existe ${DIST}: ejecuta antes el build.`);
    process.exit(1);
}

const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.html')) files.push(p);
    }
})(DIST);

// ¿Existe la página o fichero al que apunta un enlace interno?
const exists = (href) => {
    const target = path.join(DIST, decodeURIComponent(href.split(/[?#]/)[0]));
    return (
        (fs.existsSync(target) && fs.statSync(target).isFile()) ||
        fs.existsSync(path.join(target, 'index.html')) ||
        fs.existsSync(target + '.html')
    );
};

const problems = new Map(); // tipo → [páginas]
const add = (kind, page) => problems.set(kind, [...(problems.get(kind) ?? []), page]);
const titles = new Map();
const checked = new Map();

for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const page = '/' + path.relative(DIST, file).split(path.sep).join('/').replace(/index\.html$/, '');

    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
    if (!title) add('sin <title>', page);
    else titles.set(title, [...(titles.get(title) ?? []), page]);

    if (!/<meta name="description" content="[^"]+"/.test(html)) add('sin meta description', page);

    const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
    if (h1 === 0) add('sin h1', page);
    if (h1 > 1) add('varios h1', page);

    for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) {
        if (href.startsWith('//')) continue;
        if (!checked.has(href)) checked.set(href, exists(href));
        if (!checked.get(href)) add(`enlace roto ${href}`, page);
    }
}
for (const [title, pages] of titles) if (pages.length > 1) add(`título repetido «${title}»`, pages.join(' · '));

console.log(`${files.length} páginas revisadas, ${checked.size} enlaces internos distintos.`);
if (problems.size === 0) {
    console.log('Sin problemas.');
    process.exit(0);
}
for (const [kind, pages] of problems) {
    console.error(`✗ ${kind}: ${pages.length} página(s), p. ej. ${pages.slice(0, 3).join(' | ')}`);
}
process.exit(1);
