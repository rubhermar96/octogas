#!/usr/bin/env bash
# Instala OCTO en un servidor ya preparado con provision.sh. Se ejecuta UNA vez, como root:
#
#     sudo bash /srv/octogas/deploy/setup.sh
#
# Configura las variables de entorno, instala dependencias, carga la base de datos
# (desde /srv/octogas/octogas.dump si lo has subido), hace la primera publicación,
# obtiene el certificado HTTPS y activa los servicios. Se puede volver a ejecutar.
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

    echo "==> Base de datos"
    local tables
    tables="$(as_app psql "$db_url" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")"
    if [[ $tables -eq 0 ]]; then
        if [[ -f $APP_DIR/octogas.dump ]]; then
            echo "    Restaurando $APP_DIR/octogas.dump (histórico completo)..."
            as_app pg_restore --no-owner --no-privileges -d "$db_url" "$APP_DIR/octogas.dump"
        else
            echo "    Sin volcado: se crea el esquema vacío."
            as_app bash -c "cd '$APP_DIR/api' && npx drizzle-kit push --force"
            if compgen -G "$APP_DIR/data-archive/stations-*.json" >/dev/null; then
                echo "    Reproduciendo los snapshots de data-archive/..."
                as_app bash -c "cd '$APP_DIR/api' && npm run replay"
            fi
        fi
    else
        echo "    La base de datos ya tiene tablas: no se toca."
    fi

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

# Comprueba que el dominio y www apuntan SOLO a este servidor antes de pedir el
# certificado. Let's Encrypt prueba también la IPv6: un registro AAAA que apunte a
# otro sitio (p. ej. la página de aparcamiento del registrador) hace fallar la emisión.
check_dns() {
    local ips host resolved ip
    ips=" $(hostname -I) "
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
