#!/usr/bin/env bash
# Prepara el despliegue continuo. Se ejecuta UNA vez, como root, después de setup.sh:
#
#     sudo bash /srv/octogas/deploy/setup-ci.sh
#
# Crea la clave SSH con la que GitHub Actions entra al servidor, limitada a ejecutar
# deploy/ci-deploy.sh como el usuario de la app (sin terminal, sin reenvíos, sin root),
# y permite a ese usuario reiniciar la API sin contraseña, que es lo único que el
# despliegue necesita de root. Al final muestra los tres valores que hay que guardar
# como secretos en GitHub. Volver a ejecutarlo sustituye la clave anterior.
set -euo pipefail

KEY_COMMENT="github-actions-octogas"

main() {
    cd "$(dirname "$0")"
    source ./config.env
    [[ $EUID -eq 0 ]] || { echo "Ejecútalo como root: sudo bash $0"; exit 1; }

    echo "==> Permiso para reiniciar la API sin contraseña"
    local rule=/etc/sudoers.d/octogas-deploy
    echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart octogas-api" > "$rule.tmp"
    visudo -cf "$rule.tmp" >/dev/null
    chmod 440 "$rule.tmp"
    mv "$rule.tmp" "$rule"

    echo "==> Clave de despliegue para GitHub Actions"
    local tmp
    tmp="$(mktemp -d)"
    ssh-keygen -q -t ed25519 -N "" -C "$KEY_COMMENT" -f "$tmp/key"
    local ssh_dir="/home/$APP_USER/.ssh"
    local auth="$ssh_dir/authorized_keys"
    install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$ssh_dir"
    touch "$auth"
    # Solo puede ejecutar el script de despliegue; se quita la clave anterior si la hay.
    { grep -v " $KEY_COMMENT\$" "$auth" || true
      echo "command=\"bash $APP_DIR/deploy/ci-deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $(cat "$tmp/key.pub")"
    } > "$auth.tmp"
    install -m 600 -o "$APP_USER" -g "$APP_USER" "$auth.tmp" "$auth"
    rm -f "$auth.tmp"

    local ip host_key
    ip="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)"
    host_key="$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"

    cat <<INFO

En GitHub: repositorio → Settings → Secrets and variables → Actions → New repository
secret. Crea estos tres (copia el valor completo, sin espacios de más):

──────── DEPLOY_HOST ────────
$ip

──────── DEPLOY_KNOWN_HOSTS ────────
$ip $host_key

──────── DEPLOY_SSH_KEY ────────
$(cat "$tmp/key")

La clave privada NO se guarda en el servidor: si la pierdes, vuelve a ejecutar este
script y actualiza el secreto.
INFO
    rm -rf "$tmp"
}

main "$@"
