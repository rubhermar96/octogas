#!/usr/bin/env bash
# Refresco de OCTO: precios de MITECO → snapshot → base de datos → build → publicación.
# Lo lanza octogas-refresh.timer dos veces al día. A mano:
#
#     sudo -u octo bash /srv/octogas/deploy/refresh.sh
#
# Si cualquier paso falla, se aborta sin tocar la web publicada.
set -euo pipefail

main() {
    local dir
    dir="$(cd "$(dirname "$0")/.." && pwd)"
    source "$dir/deploy/config.env"
    cd "$dir"

    # Un solo refresco a la vez: el temporizador y un despliegue automático pueden
    # coincidir, y dos builds simultáneos se pisarían dist/. El segundo espera.
    exec 9>"$WEB_ROOT/.refresh.lock"
    flock 9

    log "Descargando precios de MITECO"
    npm run --silent update-data

    # Si el Ministerio devuelve un catálogo incompleto, mejor no publicar nada.
    local n
    n="$(node -e "console.log(require('./public/data/stations.json').length)")"
    if (( n < 9000 )); then
        log "ERROR: solo $n gasolineras en la descarga; se aborta sin tocar la web publicada."
        exit 1
    fi
    log "$n gasolineras"

    npm run --silent archive-snapshot
    log "Ingesta en la base de datos"
    npm --prefix api run --silent ingest

    log "Build"
    NODE_OPTIONS=--max-old-space-size=2048 npm run --silent build

    # Publicación atómica: cada build va a su carpeta y el enlace "current" cambia
    # de golpe, así nadie ve la web a medio generar.
    local rel
    rel="$WEB_ROOT/releases/$(date +%Y%m%d-%H%M%S)"
    cp -a dist "$rel"
    ln -sfn "$rel" "$WEB_ROOT/current.tmp"
    mv -Tf "$WEB_ROOT/current.tmp" "$WEB_ROOT/current"
    # Se conservan las 3 últimas publicaciones para poder volver atrás. Se ordena por
    # nombre (es la fecha): la fecha de modificación no sirve, cp -a conserva la de dist/.
    ls -1d "$WEB_ROOT"/releases/*/ | sort -r | tail -n +4 | xargs -r rm -rf
    log "Publicado: $rel"
}

log() { echo "[$(date '+%F %T')] $*"; }

main "$@"
