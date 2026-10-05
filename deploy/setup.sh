#!/usr/bin/env bash
# Instala OCTO en un servidor ya preparado con provision.sh. Se ejecuta UNA vez, como root:
#
#     sudo bash /srv/octogas/deploy/setup.sh
#
# Configura las variables de entorno, instala dependencias, reconstruye el histórico
# real de precios a partir de las descargas de /srv/octogas/data-archive (replay), hace
# la primera publicación, obtiene el certificado HTTPS y activa los servicios. Se puede
# volver a ejecutar.
set -euo pipefail

main() {
    cd "$(dirname "$0")"
    source ./config.env
    source ./lib.sh
    [[ $EUID -eq 0 ]] || { echo "Ejecútalo como root: sudo bash $0"; exit 1; }
    [[ -f /etc/octogas/database-url ]] || { echo "Falta /etc/octogas/database-url: ejecuta antes provision.sh"; exit 1; }
    local db_url
    db_url="$(cat /etc/octogas/database-url)"

    echo "==> Código (rama $BRANCH)"
    as_app git -C "$APP_DIR" fetch origin
    as_app git -C "$APP_DIR" checkout "$BRANCH"
    as_app git -C "$APP_DIR" pull --ff-only origin "$BRANCH"

    echo "==> Variables de entorno"
    if [[ ! -f $APP_DIR/.env ]]; then
        cat > "$APP_DIR/.env" <<CONF
DATABASE_URL=$db_url
PUBLIC_API_BASE_URL=https://$DOMAIN
PUBLIC_GOOGLE_SITE_VERIFICATION=
PUBLIC_ADSENSE_ID=
CONF
    fi
    if [[ ! -f $APP_DIR/api/.env ]]; then
        cat > "$APP_DIR/api/.env" <<CONF
DATABASE_URL=$db_url
NODE_ENV=production
PORT=3001
HOST=127.0.0.1
CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN
SITE_HOSTS=$DOMAIN,www.$DOMAIN
CONF
    fi
    chown "$APP_USER:$APP_USER" "$APP_DIR/.env" "$APP_DIR/api/.env"
    chmod 600 "$APP_DIR/.env" "$APP_DIR/api/.env"

    echo "==> Dependencias"
    as_app bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund"
    as_app bash -c "cd '$APP_DIR/api' && npm ci --no-audit --no-fund"

    echo "==> Histórico real (paquete de data-archive)"
    # Lo genera `npm run pack-archive` en tu PC y se sube con scp junto a su SHA-256.
    if [[ -f $APP_DIR/data-archive.tar.gz ]]; then
        if [[ -f $APP_DIR/data-archive.tar.gz.sha256 ]]; then
            (cd "$APP_DIR" && sha256sum --check --quiet data-archive.tar.gz.sha256) \
                || { echo "ERROR: el paquete no coincide con su SHA-256 (¿subida incompleta?). Vuelve a subirlo."; exit 1; }
        fi
        as_app tar -xzf "$APP_DIR/data-archive.tar.gz" -C "$APP_DIR" --no-same-owner \
            --wildcards 'data-archive/stations-*.json'
        echo "    $(compgen -G "$APP_DIR/data-archive/stations-*.json" | wc -l) días de histórico listos en data-archive/"
    else
        echo "    No hay $APP_DIR/data-archive.tar.gz: se usará lo que haya en data-archive/."
    fi

    echo "==> Base de datos"
    local tables
    tables="$(as_app psql "$db_url" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")"
    if [[ $tables -eq 0 ]]; then
        echo "    Creando el esquema..."
        as_app bash -c "cd '$APP_DIR/api' && npx drizzle-kit push --force"
        # El histórico se reconstruye SOLO con las descargas reales de MITECO, en orden y
        # con su fecha. No se restaura la BD local: tiene precios simulados de desarrollo.
        if compgen -G "$APP_DIR/data-archive/stations-*.json" >/dev/null; then
            echo "    Reconstruyendo el histórico real desde data-archive/ (unos minutos)..."
            as_app bash -c "cd '$APP_DIR/api' && npm run replay"
        else
            echo "    AVISO: no hay descargas en data-archive/; el histórico empezará hoy."
            echo "    (Súbelas antes si quieres conservarlo: ver DEPLOY.md, paso 4.)"
        fi
    else
        echo "    La base de datos ya tiene tablas: no se toca."
    fi
    check_real_history "$db_url"

    echo "==> API"
    install_units
    systemctl enable octogas-api
    systemctl restart octogas-api

    echo "==> Primera publicación (descarga de precios + build: unos minutos)"
    as_app bash "$APP_DIR/deploy/refresh.sh"

    echo "==> Certificado HTTPS"
    if [[ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
        check_dns
        render "$APP_DIR/deploy/nginx/bootstrap.conf" "/etc/nginx/sites-available/$DOMAIN.conf"
        ln -sf "../sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
        rm -f /etc/nginx/sites-enabled/default
        nginx -t
        systemctl reload nginx
        certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" -d "www.$DOMAIN" \
            --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email --non-interactive
    fi
    # Al renovarse el certificado (certbot lo hace solo), Nginx debe recargarlo.
    install -d /etc/letsencrypt/renewal-hooks/deploy
    printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

    echo "==> Nginx"
    rm -f /etc/nginx/sites-enabled/default
    install_site

    echo "==> Tareas programadas (refresco 2 veces al día y copia de seguridad diaria)"
    systemctl enable --now octogas-refresh.timer octogas-backup.timer

    echo
    echo "Listo: https://$DOMAIN"
    systemctl list-timers 'octogas-*' --no-pager
}

# Ningún precio puede ser anterior al inicio del histórico real (REAL_HISTORY_START):
# lo anterior sería el histórico simulado de desarrollo (api/src/seed-history.ts), que
# no debe publicarse nunca como si fuera real.
check_real_history() {
    local first
    first="$(as_app psql "$1" -tAc "select coalesce(min(observed_at)::date::text, '') from price_observations")"
    if [[ -n $first && $first < $REAL_HISTORY_START ]]; then
        echo "ERROR: la base de datos tiene precios del $first, anteriores al inicio del histórico"
        echo "       real ($REAL_HISTORY_START). Son datos simulados de desarrollo: no se publican."
        exit 1
    fi
}

# Comprueba que el dominio y www apuntan SOLO a este servidor antes de pedir el
# certificado. Let's Encrypt prueba también la IPv6: un registro AAAA que apunte a
# otro sitio (p. ej. la página de aparcamiento del registrador) hace fallar la emisión.
check_dns() {
    local ips host resolved ip
    ips=" $(ip -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | tr '\n' ' ') "
    for host in "$DOMAIN" "www.$DOMAIN"; do
        resolved="$(getent ahosts "$host" | awk '{print $1}' | sort -u | tr '\n' ' ')"
        if [[ -z $resolved ]]; then
            echo "ERROR: $host no resuelve. Crea el registro DNS (ver DEPLOY.md) y espera a que se propague."
            exit 1
        fi
        for ip in $resolved; do
            if [[ $ips != *" $ip "* ]]; then
                echo "ERROR: $host apunta a $ip, que no es este servidor ($ips)."
                echo "       Corrige o borra ese registro DNS (A o AAAA). Si usas Cloudflare, deja"
                echo "       los registros en 'DNS only' (nube gris) hasta tener el certificado."
                exit 1
            fi
        done
    done
}

main "$@"
