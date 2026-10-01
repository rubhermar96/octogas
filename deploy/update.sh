#!/usr/bin/env bash
# Publica una versión nueva del código (tras hacer push a la rama configurada):
#
#     sudo bash /srv/octogas/deploy/update.sh
#
# Trae el código, reinstala dependencias, actualiza servicios y Nginx, reinicia la
# API y regenera la web. Los cambios de esquema de la BD NO se aplican solos.
set -euo pipefail

# Todo va dentro de main(): git pull reescribe este mismo fichero mientras se
# ejecuta, y bash ya lo habrá leído entero antes de empezar.
main() {
    cd "$(dirname "$0")"
    source ./config.env
    source ./lib.sh
    [[ $EUID -eq 0 ]] || { echo "Ejecútalo como root: sudo bash $0"; exit 1; }

    local before after
    before="$(as_app git -C "$APP_DIR" rev-parse HEAD)"
    as_app git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
    after="$(as_app git -C "$APP_DIR" rev-parse HEAD)"
    echo "==> $before → $after"
    as_app git -C "$APP_DIR" log --oneline "$before..$after"

    echo "==> Dependencias"
    as_app bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund"
    as_app bash -c "cd '$APP_DIR/api' && npm ci --no-audit --no-fund"

    if ! as_app git -C "$APP_DIR" diff --quiet "$before" "$after" -- api/src/db/schema.ts; then
        echo
        echo "AVISO: ha cambiado el esquema de la base de datos (api/src/db/schema.ts)."
        echo "Revisa y aplica el cambio ANTES de seguir usando la web:"
        echo "    sudo -u $APP_USER bash -c 'cd $APP_DIR/api && npx drizzle-kit push'"
        echo
    fi

    echo "==> Servicios y Nginx"
    install_units
    install_site
    systemctl restart octogas-api

    echo "==> Regenerando la web"
    as_app bash "$APP_DIR/deploy/refresh.sh"
}

main "$@"
