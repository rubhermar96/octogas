// Iconos de la web (Material Symbols Outlined), servidos desde nuestro propio dominio:
// antes se cargaban de Google Fonts y cada visita enviaba la IP del usuario a Google.
//
// La fuente es un subconjunto con solo los iconos que usa el código, que este script
// detecta solo (<span class="material-symbols-outlined">nombre</span>, también con
// {cond ? 'a' : 'b'} dentro, e `icon: 'nombre'` en datos).
//
//   npm run icons            Regenera la fuente (tras usar un icono nuevo) y su lista.
//   npm run icons -- --check Falla si el código usa un icono que no está en la fuente
//                            (lo ejecuta la integración continua).
import fs from 'node:fs';
import path from 'node:path';

const FONT = 'src/assets/fonts/material-symbols-outlined.woff2';
const LIST = 'src/assets/fonts/material-symbols-outlined.json';
// Google sirve woff2 solo a navegadores modernos.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function sourceFiles(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) sourceFiles(p, out);
        else if (/\.(astro|tsx|ts)$/.test(e.name)) out.push(p);
    }
    return out;
}

function usedIcons() {
    const used = new Set();
    for (const f of sourceFiles('src')) {
        const s = fs.readFileSync(f, 'utf8');
        for (const m of s.matchAll(/material-symbols-outlined[^>]*>\s*([a-z_]+)\s*</g)) used.add(m[1]);
        for (const m of s.matchAll(/material-symbols-outlined[^>]*>\s*\{([^}]*)\}/g))
            for (const q of m[1].matchAll(/['"]([a-z_]+)['"]/g)) used.add(q[1]);
        for (const m of s.matchAll(/\bicon\s*[:=]\s*['"]([a-z_]+)['"]/g)) used.add(m[1]);
    }
    return [...used].sort(); // Google exige los nombres en orden alfabético.
}

const used = usedIcons();

if (process.argv.includes('--check')) {
    const have = new Set(JSON.parse(fs.readFileSync(LIST, 'utf8')));
    const missing = used.filter((n) => !have.has(n));
    if (missing.length) {
        console.error(`::error::Iconos usados que no están en la fuente: ${missing.join(', ')}. Ejecuta: npm run icons`);
        process.exit(1);
    }
    console.log(`Iconos: los ${used.length} que usa el código están en la fuente.`);
    process.exit(0);
}

const cssUrl =
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0' +
    `&icon_names=${used.join(',')}&display=block`;
const css = await (await fetch(cssUrl, { headers: { 'user-agent': UA } })).text();
const fontUrl = css.match(/url\((https:[^)]+)\) format\('woff2'\)/)?.[1];
if (!fontUrl) {
    console.error('Google Fonts no devolvió un woff2:\n' + css.slice(0, 500));
    process.exit(1);
}
const font = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());

fs.mkdirSync(path.dirname(FONT), { recursive: true });
fs.writeFileSync(FONT, font);
fs.writeFileSync(LIST, JSON.stringify(used) + '\n');
console.log(`Fuente de iconos: ${used.length} iconos, ${(font.length / 1024).toFixed(1)} KB → ${FONT}`);
