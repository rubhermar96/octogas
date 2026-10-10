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

    # Clave de IndexNow (aviso a Bing de páginas nuevas o cambiadas, ver más abajo): se
    # crea la primera vez y se guarda en .env. El build publica /{clave}.txt, que la
    # verifica. No es secreta: el protocolo exige publicarla.
    if ! grep -q '^INDEXNOW_KEY=' .env 2>/dev/null; then
        echo "INDEXNOW_KEY=$(openssl rand -hex 16)" >> .env
        log "Clave de IndexNow creada en .env"
    fi

    log "Build"
    NODE_OPTIONS=--max-old-space-size=2048 npm run --silent build

    # Publicación atómica: cada build va a su carpeta y el enlace "current" cambia
    # de golpe, así nadie ve la web a medio generar.
    local rel prev
    rel="$WEB_ROOT/releases/$(date +%Y%m%d-%H%M%S)"
    prev="$(readlink -f "$WEB_ROOT/current" || true)"
    cp -a dist "$rel"
    ln -sfn "$rel" "$WEB_ROOT/current.tmp"
    mv -Tf "$WEB_ROOT/current.tmp" "$WEB_ROOT/current"

    # Aviso a Bing y demás buscadores de IndexNow: páginas nuevas, eliminadas y el turno
    # diario (scripts/indexnow.mjs). Si falla, solo queda en el registro: la web ya está
    # publicada.
    node --env-file-if-exists=.env scripts/indexnow.mjs --dist "$rel" --prev "$prev" \
        --state data-archive/indexnow-state.json || log "AVISO: IndexNow falló (la web está publicada igualmente)"
    # Se conservan las 3 últimas publicaciones para poder volver atrás. Se ordena por
    # nombre (es la fecha): la fecha de modificación no sirve, cp -a conserva la de dist/.
    ls -1d "$WEB_ROOT"/releases/*/ | sort -r | tail -n +4 | xargs -r rm -rf
    log "Publicado: $rel"
}

log() { echo "[$(date '+%F %T')] $*"; }

main "$@"
