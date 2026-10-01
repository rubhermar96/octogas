# Despliegue de OCTO en un VPS

Guía para publicar **octogas.es** en un VPS propio (recomendado: **Netcup VPS 500 G12**,
2 vCPU · 4 GB · 128 GB NVMe, con **Ubuntu 24.04 LTS**). Todo lo que se instala en el
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

1. **Decide la rama que se publica.** El trabajo de los últimos meses está en
   `design-experiment-square-contrast`; `main` se quedó en junio. `deploy/config.env`
   apunta a la rama del experimento. Si antes la fusionas en `main`, cambia ahí `BRANCH=main`
   (y haz commit + push).
2. **Pon tu nombre** en `OWNER.name` de [`src/consts.ts`](src/consts.ts) (y haz commit +
   push). El RGPD obliga a identificar al responsable de los datos en la política de
   privacidad. NIF y domicilio solo hacen falta cuando la web sea una actividad económica
   (al activar publicidad); hasta entonces no se muestran.
3. **Clave SSH** en tu PC (PowerShell), si no tienes una ya:
   ```powershell
   ssh-keygen -t ed25519
   ```

## 1. Contratar el VPS y el dominio

- **VPS:** Netcup VPS 500 G12 → imagen **Ubuntu 24.04**. Apunta la **IPv4** (y la IPv6)
  y la contraseña de root que te envían.
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

Ya en el servidor:

```bash
apt-get update && apt-get install -y git
git clone -b design-experiment-square-contrast https://github.com/rubhermar96/octogas.git /srv/octogas
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

## 4. Subir la base de datos (con todo el histórico)

Desde tu PC (PowerShell, en la carpeta del proyecto), vuelca la BD local y súbela:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" "postgres://octogas:octogas@localhost:5432/octogas" -Fc -f octogas.dump
scp octogas.dump octo@IP:/srv/octogas/
```

El volcado ocupa unos 20 MB y lleva todo el histórico de precios desde marzo.
Opcional, como copia: `scp -r data-archive octo@IP:/srv/octogas/` (los snapshots diarios).

> Sin volcado, `setup.sh` crea el esquema vacío y, si encuentra snapshots en
> `data-archive/`, los reproduce con `npm run replay`.

## 5. Instalar y publicar

En el servidor, como `octo`:

```bash
sudo bash /srv/octogas/deploy/setup.sh
```

`setup.sh` (10-15 minutos la primera vez):

1. Crea los `.env` de la web y de la API con la URL de la BD y el dominio.
2. Instala dependencias y restaura `octogas.dump`.
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

---

## Operación diaria

| Qué                                   | Comando (en el servidor)                                   |
|---------------------------------------|------------------------------------------------------------|
| Estado de la API                      | `systemctl status octogas-api`                             |
| Logs de la API                        | `journalctl -u octogas-api -f`                             |
| Último refresco (¿falló?)             | `journalctl -u octogas-refresh -n 50`                      |
| Próximas ejecuciones                  | `systemctl list-timers 'octogas-*'`                        |
| Refrescar precios y web ahora         | `sudo systemctl start octogas-refresh`                     |
| Publicar código nuevo (tras `git push`) | `sudo bash /srv/octogas/deploy/update.sh`                |
| Copias de seguridad                   | `ls -lh /var/backups/octogas`                              |

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
