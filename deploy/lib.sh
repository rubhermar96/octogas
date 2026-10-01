# Funciones compartidas por setup.sh y update.sh (se cargan con `source`).

# Ejecuta un comando como el usuario de la aplicación.
as_app() { runuser -u "$APP_USER" -- "$@"; }

# Copia una plantilla sustituyendo los marcadores __VARIABLE__ por su valor.
render() {
    sed -e "s#__DOMAIN__#$DOMAIN#g" \
        -e "s#__APP_USER__#$APP_USER#g" \
        -e "s#__APP_DIR__#$APP_DIR#g" \
        -e "s#__WEB_ROOT__#$WEB_ROOT#g" \
        -e "s#__BACKUP_DIR__#$BACKUP_DIR#g" \
        "$1" > "$2"
}

# Instala (o actualiza) los servicios y temporizadores de systemd.
install_units() {
    local unit
    for unit in octogas-api.service octogas-refresh.service octogas-refresh.timer \
                octogas-backup.service octogas-backup.timer; do
        render "$APP_DIR/deploy/systemd/$unit" "/etc/systemd/system/$unit"
    done
    systemctl daemon-reload
}

# Instala la configuración definitiva de Nginx (requiere el certificado ya emitido).
install_site() {
    install -m 644 "$APP_DIR/deploy/nginx/security-headers.conf" /etc/nginx/snippets/octogas-security-headers.conf
    install -m 644 "$APP_DIR/deploy/nginx/proxy.conf" /etc/nginx/snippets/octogas-proxy.conf
    render "$APP_DIR/deploy/nginx/octogas.conf" "/etc/nginx/sites-available/$DOMAIN.conf"
    ln -sf "../sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
    nginx -t
    systemctl reload nginx
}
