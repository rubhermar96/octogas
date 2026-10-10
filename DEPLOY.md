# Despliegue de OCTO en un VPS

Guía para publicar **octogas.es** en un VPS propio (recomendado: **Netcup VPS 500 G12**,
2 vCPU · 4 GB · 128 GB NVMe, con **Debian 13**; vale también Ubuntu 24.04). Todo lo que se instala en el
servidor está en [`deploy/`](deploy/).

## Cómo queda montado

```
                 ┌──────────────────────── VPS ─────────────────────────┐
 navegador ──►   │ Nginx :443 ─┬─► /var/www/octogas/current  (web estática)│
 (HTTPS)         │             └─► /api/*, /r/*  ─► API Fastify :3001      │
                 │                                    (solo 127.0.0.1)     │
                 │ PostgreSQL 18 (solo local) ◄── API, ingesta y build     │
                 │                                                          │
                 │ 07:00 y 15:00  octogas-refresh: MITECO → BD → build      │
                 │ 03:30          octogas-backup: volcado de la BD          │
                 └──────────────────────────────────────────────────────────┘
```

- La web es **estática**: Nginx sirve el HTML generado por Astro. La API solo atiende
  el acortador de enlaces (`/api/shorten`, `/r/:código`) y el histórico (`/api/stations`).
- Cada refresco genera la web en una carpeta nueva (`/var/www/octogas/releases/<fecha>`)
  y cambia el enlace `current` de golpe: nadie ve la web a medio construir y, si algo
  falla, se sigue sirviendo la versión anterior. Se guardan las 3 últimas.
- La API y PostgreSQL **no** son accesibles desde fuera: solo Nginx (puertos 80/443) y SSH.

## Antes de empezar

- Se publica la rama **`main`** (fijada en `deploy/config.env`).
- El titular de los textos legales está en `OWNER` de [`src/consts.ts`](src/consts.ts). NIF y
  domicilio solo se muestran (y hay que rellenarlos) al activar publicidad.
- **Clave SSH** en tu PC (PowerShell), si no tienes una ya:
   ```powershell
   ssh-keygen -t ed25519
   ```

## Claves y secretos

**Ninguno va al repositorio**, que es público: los `.env` están en `.gitignore` y el
historial está revisado (nunca se ha subido una clave). Los genera el propio despliegue
y no tienes que inventar ninguno salvo la contraseña de `sudo`.

| Qué | Lo crea | Dónde vive | Quién lo ve |
|---|---|---|---|
| Contraseña de la BD de producción | `provision.sh` (aleatoria) | `/etc/octogas/database-url` y los `.env` del servidor (solo root y `octo`) | Nadie: nunca sale del servidor |
| Contraseña de `sudo` de `octo` | Tú, al ejecutar `provision.sh` | Tu gestor de contraseñas | Tú |
| Tu clave SSH | `ssh-keygen` en tu PC | La privada en tu PC; la pública en el servidor | Tú |
| Clave de despliegue (GitHub → servidor) | `setup-ci.sh` (se muestra una vez) | Secreto `DEPLOY_SSH_KEY` de GitHub; no queda en el servidor | GitHub Actions |
| `DEPLOY_HOST` y `DEPLOY_KNOWN_HOSTS` | `setup-ci.sh` | Secretos de GitHub | GitHub Actions |
| Certificado HTTPS | certbot | `/etc/letsencrypt` (se renueva solo) | — |
| Verificación de Search Console | Search Console | Registro DNS `TXT` | Pública (no es un secreto) |
| Clave de IndexNow | `refresh.sh` (aleatoria, la primera vez) | `/srv/octogas/.env` (`INDEXNOW_KEY`) y publicada en `https://octogas.es/{clave}.txt` | Pública (el protocolo exige publicarla) |
| Accesos a Netcup, al registrador y a GitHub | Tú | Tu gestor de contraseñas | Tú |

- Activa la **verificación en dos pasos** en GitHub, Netcup y el registrador. Con el
  despliegue continuo, quien pueda hacer push a `main` publica en la web.
- La base de datos local de desarrollo (`octogas:octogas@localhost`) no es un secreto y
  no se usa en producción.

**Si alguno se filtra:**
- **Clave de despliegue:** vuelve a ejecutar `sudo bash /srv/octogas/deploy/setup-ci.sh`
  (sustituye la anterior) y actualiza los secretos de GitHub.
- **Contraseña de la BD:**
  `sudo -u postgres psql -c "ALTER ROLE octogas PASSWORD 'nueva'"`, cámbiala en
  `/etc/octogas/database-url`, `/srv/octogas/.env` y `/srv/octogas/api/.env`, y
  ejecuta `sudo systemctl restart octogas-api`.
- **Tu clave SSH:** quita la línea correspondiente de `/home/octo/.ssh/authorized_keys`
  y añade la nueva.

## 1. Contratar el VPS y el dominio

- **VPS:** Netcup VPS 500 G12 → imagen **Debian 13 (trixie) minimal**. Apunta la
  **IPv4**, la **IPv6**, la contraseña de root y la **huella SSH ED25519** que te envían
  (`SHA256:...`).
- **Dominio:** `octogas.es` en Dondominio o Porkbun.

## 2. DNS

En el panel del registrador (o de Cloudflare, si lo usas como DNS):

| Tipo   | Nombre | Valor                   |
|--------|--------|-------------------------|
| `A`    | `@`    | IPv4 del VPS            |
| `A`    | `www`  | IPv4 del VPS            |
| `AAAA` | `@`    | IPv6 del VPS (opcional) |
| `AAAA` | `www`  | IPv6 del VPS (opcional) |

- **Borra cualquier otro `A`/`AAAA`** que el registrador ponga por defecto (páginas de
  aparcamiento): si `octogas.es` apunta a otro sitio, el certificado HTTPS no se emite.
  `setup.sh` lo comprueba y se para avisando.
- Con **Cloudflare**, deja los registros en **"DNS only" (nube gris)** al menos hasta
  tener el certificado. Si luego activas el proxy (nube naranja), pon el SSL en
  **Full (strict)**.

Comprueba la propagación desde tu PC: `nslookup octogas.es` debe devolver la IP del VPS.

## 3. Primera conexión: preparar el servidor

Sube tu clave SSH y entra como root (PowerShell, cambia `IP` por la del VPS):

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
ssh root@IP
```

La primera vez, SSH muestra la huella del servidor (`ED25519 key fingerprint is
SHA256:...`): **compárala con la del correo de Netcup** antes de contestar `yes`. Si no
coincide, no sigas.

Ya en el servidor:

```bash
apt-get update && apt-get install -y git ca-certificates
git clone https://github.com/rubhermar96/octogas.git /srv/octogas
bash /srv/octogas/deploy/provision.sh
```

`provision.sh` (unos 5 minutos) instala Nginx, PostgreSQL 18, Node.js 22 y certbot, crea
el usuario **`octo`** (te pedirá una contraseña para `sudo`), activa firewall, fail2ban,
actualizaciones automáticas de seguridad y 4 GB de swap, y crea la base de datos con una
contraseña aleatoria (guardada en `/etc/octogas/database-url`).

Si `octo` recibe tu clave SSH, **desactiva el acceso de root y por contraseña**. Antes de
cerrar la sesión de root, comprueba en otra ventana que entras con:

```powershell
ssh octo@IP
```

## 4. Subir el histórico real de precios

El histórico se reconstruye a partir de las descargas diarias de MITECO que has ido
archivando en `data-archive/` desde el 30 de junio de 2026. **Justo antes de desplegar**
(para incluir los últimos días), desde tu PC, en la carpeta del proyecto:

```powershell
npm run pack-archive
scp deploy-package/data-archive.tar.gz deploy-package/data-archive.tar.gz.sha256 octo@IP:/srv/octogas/
```

`pack-archive` lo deja todo en un solo fichero (~30 MB en vez de ~200 MB) con su suma
SHA-256. `setup.sh` comprueba la suma (si la subida se cortó, se para y avisa),
descomprime las descargas y las reproduce en orden, cada una con su fecha
(`npm run replay`): mismo histórico que el real, comprobado con una base de datos de
prueba.

> **No subas un volcado de tu base de datos local.** Tiene precios **simulados** de
> marzo a junio (los generó `api/src/seed-history.ts` para probar la gráfica) y se
> publicarían como si fueran reales. `setup.sh` se niega a publicar cualquier precio
> anterior al 30 de junio (`REAL_HISTORY_START` en `deploy/config.env`).

## 5. Instalar y publicar

En el servidor, como `octo`:

```bash
sudo bash /srv/octogas/deploy/setup.sh
```

`setup.sh` (10-15 minutos la primera vez):

1. Crea los `.env` de la web y de la API con la URL de la BD y el dominio.
2. Instala dependencias y reconstruye el histórico real desde `data-archive/`.
3. Arranca la API (`octogas-api`).
4. Descarga los precios de hoy, los ingesta y genera la web (la primera publicación).
5. Pide el certificado HTTPS a Let's Encrypt (ejecutarlo implica aceptar sus términos) y
   configura Nginx.
6. Activa los refrescos (07:00 y 15:00) y la copia de seguridad diaria (03:30).

Comprobación final, desde tu PC:

```powershell
curl.exe -I https://octogas.es
curl.exe -I https://www.octogas.es
```

La primera debe dar `200` y la segunda `301` hacia `https://octogas.es/`.

## 6. Google Search Console

Lo más cómodo es verificar la **propiedad de dominio** con un registro DNS `TXT` (te lo
da Search Console) y enviar después el sitemap: `https://octogas.es/sitemap-index.xml`.

Si prefieres la etiqueta `<meta>`, pon su valor en `/srv/octogas/.env`
(`PUBLIC_GOOGLE_SITE_VERIFICATION=...`) y regenera la web (ver abajo).

**Bing (y Yahoo, DuckDuckGo, Ecosia, que usan su índice):** date de alta en
[Bing Webmaster Tools](https://www.bing.com/webmasters) con "Importar desde Google
Search Console": trae el dominio verificado y el sitemap en un minuto.

Además, cada publicación avisa por **IndexNow** a Bing, Yandex, Seznam y Naver de las
páginas nuevas y eliminadas y, una vez al día, de la portada, las provincias y una
séptima parte del resto por turnos (cada página, una vez por semana): ver
[`scripts/indexnow.mjs`](scripts/indexnow.mjs). Funciona solo: `refresh.sh` crea la
clave la primera vez y el build publica el fichero que la verifica. El resultado sale
en el registro del refresco (`journalctl -u octogas-refresh | grep IndexNow`).

## 7. Despliegue continuo (una vez)

A partir de aquí, cada `git push` a `main` se publica solo.
Lo hace el flujo [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml):

1. **Integración** (también en cada pull request): tipos de la web y de la API, build
   completo con los precios del día y revisión de todas las páginas generadas (enlaces
   rotos, títulos repetidos, páginas sin `h1` o sin descripción). Si algo falla, no se
   despliega.
2. **Despliegue**: GitHub entra por SSH y ejecuta
   [`deploy/ci-deploy.sh`](deploy/ci-deploy.sh) con el commit exacto que ha pasado la
   integración. Actualiza el código, reinstala dependencias si cambiaron, reinicia la API,
   comprueba que responde, regenera la web y comprueba que se sirve. **Si algo falla,
   vuelve solo al commit y a la publicación anteriores.**

Para activarlo, en el servidor:

```bash
sudo bash /srv/octogas/deploy/setup-ci.sh
```

Muestra tres valores. Créalos en GitHub, en el repositorio → **Settings → Secrets and
variables → Actions → New repository secret**: `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS` y
`DEPLOY_SSH_KEY`. Mientras no existan, el despliegue se salta sin error (la integración
sí se ejecuta).

La clave que usa GitHub **solo puede ejecutar el script de despliegue** como `octo`: sin
terminal, sin reenvíos y sin permisos de administrador (lo único que se le permite como
root es reiniciar la API).

**Lo que no se despliega solo**, a propósito: los cambios en el esquema de la base de
datos (`api/src/db/schema.ts`) o en la configuración del servidor (`deploy/systemd`,
`deploy/nginx`, `deploy/postgres`, `deploy/config.env`). Necesitan root o una migración y
conviene revisarlos: el despliegue se detiene avisando, y se aplican con
`sudo bash /srv/octogas/deploy/update.sh`.

El resultado de cada despliegue se ve en la pestaña **Actions** del repositorio.

---

## Operación diaria

| Qué                                   | Comando (en el servidor)                                   |
|---------------------------------------|------------------------------------------------------------|
| Estado de la API                      | `systemctl status octogas-api`                             |
| Logs de la API                        | `journalctl -u octogas-api -f`                             |
| Último refresco (¿falló?)             | `journalctl -u octogas-refresh -n 50`                      |
| Próximas ejecuciones                  | `systemctl list-timers 'octogas-*'`                        |
| Refrescar precios y web ahora         | `sudo systemctl start octogas-refresh`                     |
| Publicar código nuevo                 | Automático con cada `git push` (ver paso 7)                |
| Publicar cambios de servidor o de BD  | `sudo bash /srv/octogas/deploy/update.sh`                  |
| Copias de seguridad                   | `ls -lh /var/backups/octogas`                              |
| Avisos a Bing (IndexNow)              | `journalctl -u octogas-refresh \| grep IndexNow`           |

### Volver a la versión anterior de la web

```bash
ls /var/www/octogas/releases/                        # las 3 últimas publicaciones
sudo -u octo ln -sfn /var/www/octogas/releases/<FECHA> /var/www/octogas/current
```

### Restaurar una copia de la base de datos

```bash
sudo systemctl stop octogas-api octogas-refresh.timer
sudo -u octo bash -c 'pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$(cat /etc/octogas/database-url)" /var/backups/octogas/octogas-AAAA-MM-DD.dump'
sudo systemctl start octogas-api octogas-refresh.timer
```

Las copias diarias se quedan en el propio VPS (14 días). Para tenerlas también fuera,
activa los **snapshots** del panel de Netcup o descárgalas de vez en cuando con `scp`.

### Cambios en el esquema de la base de datos

`update.sh` avisa si cambia `api/src/db/schema.ts`, pero no lo aplica solo. Revísalo y
aplícalo con:

```bash
sudo -u octo bash -c 'cd /srv/octogas/api && npx drizzle-kit push'
```

## Activar anuncios (más adelante)

Cuando tengas AdSense: añade `PUBLIC_ADSENSE_ID=ca-pub-...` a `/srv/octogas/.env`, pon
los `data-ad-slot` reales en los `<AdSlot slot="..." />` y regenera la web. Al hacerlo
reaparecen el banner de cookies y los apartados de publicidad de las páginas legales;
antes necesitarás una CMP certificada (IAB TCF v2.2) y rellenar `OWNER.nif` y
`OWNER.address` en `src/consts.ts` (con publicidad, la web pasa a ser actividad
económica y la LSSI exige mostrarlos).
