#!/usr/bin/env bash
# Despliegue automático. Lo lanza GitHub Actions por SSH cuando un push a la rama
# publicada pasa la integración continua. La clave de GitHub solo puede ejecutar este
# script, como el usuario octo, sin terminal ni permisos de administrador (ver
# setup-ci.sh); el commit a publicar llega en SSH_ORIGINAL_COMMAND.
#
#   1. Comprueba que el commit es de la rama y posterior a lo publicado.
#   2. Se niega si el cambio toca el esquema de la BD o la configuración del servidor:
#      eso necesita root y revisión, y se aplica a mano con update.sh.
#   3. Actualiza el código, reinstala dependencias si cambiaron, reinicia la API,
#      comprueba que responde y regenera la web (refresh.sh).
#   4. Si algo falla, vuelve al commit y a la publicación anteriores.
#
# A mano (como octo):  bash /srv/octogas/deploy/ci-deploy.sh <hash del commit>
set -euo pipefail

# Lo que requiere root o una migración: no se despliega solo.
MANUAL_PATHS=(api/src/db/schema.ts deploy/systemd deploy/nginx deploy/postgres deploy/config.env)

main() {
    DIR="$(cd "$(dirname "$0")/.." && pwd)"
    source "$DIR/deploy/config.env"
    cd "$DIR"
    # Si se corta la conexión SSH a mitad, el despliegue sigue hasta el final.
    trap '' HUP

    local target="${SSH_ORIGINAL_COMMAND:-${1:-}}"
    if [[ ! $target =~ ^[0-9a-f]{40}$ ]]; then
        echo "ERROR: se esperaba el hash completo de un commit (40 caracteres hexadecimales)."
        exit 2
    fi

    git fetch --quiet origin "$BRANCH"
    if ! git merge-base --is-ancestor "$target" "origin/$BRANCH"; then
        echo "ERROR: el commit $target no pertenece a la rama $BRANCH."
        exit 2
    fi
    PREV_COMMIT="$(git rev-parse HEAD)"
    if [[ $PREV_COMMIT == "$target" ]]; then
        echo "Ya está publicado $target."
        exit 0
    fi
    if git merge-base --is-ancestor "$target" "$PREV_COMMIT"; then
        echo "Ya hay publicada una versión más reciente ($PREV_COMMIT); no se hace nada."
        exit 0
    fi

    local manual
    manual="$(git diff --name-only "$PREV_COMMIT" "$target" -- "${MANUAL_PATHS[@]}")"
    if [[ -n $manual ]]; then
        echo "Este cambio necesita un despliegue manual (permisos de administrador o migración):"
        echo "$manual" | sed 's/^/  - /'
        echo "En el servidor: sudo bash $APP_DIR/deploy/update.sh"
        exit 3
    fi

    DEPS_CHANGED="$(git diff --name-only "$PREV_COMMIT" "$target" -- package.json package-lock.json api/package.json api/package-lock.json)"
    PREV_RELEASE="$(readlink -f "$WEB_ROOT/current" || true)"

    log "Publicando $PREV_COMMIT → $target"
    git log --oneline "$PREV_COMMIT..$target"
    git merge --ff-only --quiet "$target"

    if [[ -n $DEPS_CHANGED ]]; then
        log "Dependencias"
        install_deps || rollback "no se pudieron instalar las dependencias"
    fi

    log "API"
    sudo -n /usr/bin/systemctl restart octogas-api || rollback "no se pudo reiniciar la API"
    api_ok || rollback "la API no responde tras reiniciar"

    log "Web (precios del día + build + publicación)"
    bash "$DIR/deploy/refresh.sh" || rollback "falló la regeneración de la web"
    site_ok || rollback "la web publicada no responde"

    log "Publicado $target"
}

log() { echo "[$(date '+%F %T')] $*"; }

install_deps() {
    npm ci --no-audit --no-fund --silent && (cd "$DIR/api" && npm ci --no-audit --no-fund --silent)
}

api_ok() {
    local i
    for i in $(seq 1 20); do
        curl -fsS -m 2 http://127.0.0.1:3001/health >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}

site_ok() {
    curl -fsS -m 15 -o /dev/null --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/"
}

# Vuelve al commit y a la publicación anteriores, y deja la API con el código de antes.
rollback() {
    log "ERROR: $1. Volviendo a $PREV_COMMIT."
    git reset --hard --quiet "$PREV_COMMIT"
    if [[ -n $DEPS_CHANGED ]]; then install_deps || true; fi
    sudo -n /usr/bin/systemctl restart octogas-api || true
    if [[ -n $PREV_RELEASE && -d $PREV_RELEASE && $(readlink -f "$WEB_ROOT/current") != "$PREV_RELEASE" ]]; then
        ln -sfn "$PREV_RELEASE" "$WEB_ROOT/current.tmp"
        mv -Tf "$WEB_ROOT/current.tmp" "$WEB_ROOT/current"
        log "Restaurada la publicación anterior: $PREV_RELEASE"
    fi
    exit 1
}

main "$@"
