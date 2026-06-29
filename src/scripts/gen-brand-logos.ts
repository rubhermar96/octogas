/**
 * Genera src/lib/brandLogos.ts a partir de los archivos de /public/brands.
 *
 * La clave es el slug de la marca (mismo `slugify` que usa el explorador) y el
 * valor es el nombre real del archivo, de modo que soporta nombres con caracteres
 * que el slug elimina (p. ej. "e.leclerc.avif" -> clave "eleclerc").
 *
 * Ejecuta: npm run gen-brands  (se lanza también antes de `build`).
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../lib/slug';

const BRANDS_DIR = fileURLToPath(new URL('../../public/brands', import.meta.url));
const OUT = fileURLToPath(new URL('../lib/brandLogos.ts', import.meta.url));

const EXTS = new Set(['.avif', '.webp', '.png', '.svg', '.jpg', '.jpeg']);

const files = readdirSync(BRANDS_DIR)
    .filter((f) => EXTS.has(extname(f).toLowerCase()))
    .sort();

const map: Record<string, string> = {};
const collisions: string[] = [];
for (const f of files) {
    const key = slugify(basename(f, extname(f)));
    if (!key) continue;
    if (map[key] && map[key] !== f) collisions.push(`  ${key}: ${map[key]} <-> ${f}`);
    map[key] = f;
}

if (collisions.length) {
    console.warn(`⚠ Colisiones de slug en /public/brands (revisa nombres):\n${collisions.join('\n')}`);
}

const body = `// AUTO-GENERADO por src/scripts/gen-brand-logos.ts — NO editar a mano.
// Mapa: slug de marca -> nombre de archivo en /public/brands.
// Regenera con: npm run gen-brands
export const BRAND_LOGO_FILES: Record<string, string> = ${JSON.stringify(map, null, 4)};
`;

writeFileSync(OUT, body);
console.log(`✓ ${Object.keys(map).length} logos de marca generados -> src/lib/brandLogos.ts`);
