// Empaqueta el histórico real de precios (data-archive/) para subirlo al servidor:
// un único .tar.gz (~30 MB en vez de ~200 MB en decenas de ficheros) más su suma
// SHA-256. setup.sh lo descomprime y lo reproduce en la base de datos (replay).
//
// Uso (justo antes de desplegar, para incluir los últimos días):  npm run pack-archive
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = 'deploy-package';
const OUT = path.join(OUT_DIR, 'data-archive.tar.gz');

const snapshots = fs.readdirSync('data-archive').filter((f) => /^stations-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
if (snapshots.length === 0) {
    console.error('No hay snapshots en data-archive/ (ejecuta antes npm run refresh).');
    process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const files = ['data-archive/README.md', ...snapshots.map((f) => `data-archive/${f}`)];
const tar = spawnSync('tar', ['-czf', OUT, ...files], { stdio: 'inherit' });
if (tar.status !== 0) {
    console.error('Falló tar al crear el paquete.');
    process.exit(1);
}

const sha = createHash('sha256').update(fs.readFileSync(OUT)).digest('hex');
fs.writeFileSync(`${OUT}.sha256`, `${sha}  data-archive.tar.gz\n`);
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);

console.log(`\nPaquete listo: ${OUT} (${mb} MB)`);
console.log(`  ${snapshots.length} días de histórico real: ${snapshots[0].slice(9, 19)} → ${snapshots.at(-1).slice(9, 19)}`);
console.log(`  SHA-256: ${sha}`);
console.log(`\nSúbelo al servidor (PowerShell, cambia IP):`);
console.log(`  scp ${OUT.replace(/\\/g, '/')} ${OUT.replace(/\\/g, '/')}.sha256 octo@IP:/srv/octogas/`);
