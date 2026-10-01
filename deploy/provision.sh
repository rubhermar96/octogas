#!/usr/bin/env bash
# Prepara un VPS recién instalado (Ubuntu 24.04 LTS) para OCTO. Se ejecuta UNA vez,
# como root, desde el repositorio ya clonado en /srv/octogas:
#
#     bash /srv/octogas/deploy/provision.sh
#
# Instala Nginx, PostgreSQL 18, Node.js 22 y certbot; crea el usuario de la app,
# endurece SSH y el firewall, añade swap y crea la base de datos con una contraseña
# aleatoria. Se puede volver a ejecutar: cada paso comprueba si ya está hecho.
set -euo pipefail

main() {
    cd "$(dirname "$0")"
    source ./config.env
    [[ $EUID -eq 0 ]] || { echo "Ejecútalo como root: sudo bash $0"; exit 1; }

    echo "==> Paquetes del sistema"
    timedatectl set-timezone Europe/Madrid
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get -y upgrade
    apt-get install -y curl git rsync ca-certificates gnupg openssl ufw fail2ban \
        unattended-upgrades nginx certbot postgresql-common

    # Actualizaciones de seguridad automáticas.
    cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

    echo "==> PostgreSQL 18 (misma versión que en local, para restaurar el volcado)"
    if ! dpkg -s postgresql-18 &>/dev/null; then
        /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
        apt-get install -y postgresql-18
    fi
    install -m 644 postgres/octogas.conf /etc/postgresql/18/main/conf.d/octogas.conf
    systemctl restart postgresql

    echo "==> Node.js 22"
    if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y nodejs
    fi

    echo "==> Usuario $APP_USER"
    if ! id "$APP_USER" &>/dev/null; then
        adduser --disabled-password --gecos "" "$APP_USER"
        usermod -aG sudo "$APP_USER"
        echo "Elige una contraseña para $APP_USER (te la pedirá sudo):"
        passwd "$APP_USER"
    fi
    # Reutiliza la clave SSH con la que entras como root.
    if [[ -s /root/.ssh/authorized_keys && ! -s /home/$APP_USER/.ssh/authorized_keys ]]; then
        install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
        install -m 600 -o "$APP_USER" -g "$APP_USER" /root/.ssh/authorized_keys "/home/$APP_USER/.ssh/authorized_keys"
    fi

    echo "==> SSH"
    if [[ -s /home/$APP_USER/.ssh/authorized_keys ]]; then
        # "01-" para ir antes que 50-cloud-init.conf: en sshd gana la PRIMERA aparición.
        cat > /etc/ssh/sshd_config.d/01-octogas.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
CONF
        sshd -t
        systemctl restart ssh
        echo "    Acceso solo con clave SSH y sin root. Entra a partir de ahora con: ssh $APP_USER@<IP>"
    else
        echo "    AVISO: $APP_USER no tiene clave SSH, así que NO se desactiva el acceso por"
        echo "    contraseña (te quedarías fuera). Añade tu clave y vuelve a ejecutar este script."
    fi

    echo "==> Firewall y fail2ban"
    ufw allow OpenSSH
    ufw allow 'Nginx Full'
    ufw --force enable
    systemctl enable --now fail2ban

    echo "==> Swap de 4 GB (red de seguridad para el pico de memoria del build)"
    if ! swapon --show | grep -q /swapfile; then
        fallocate -l 4G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-octogas.conf
    sysctl --system >/dev/null

    echo "==> Directorios"
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    install -d -o "$APP_USER" -g "$APP_USER" "$WEB_ROOT" "$WEB_ROOT/releases" "$BACKUP_DIR"
    install -d /var/www/certbot
    install -d -m 750 -o root -g "$APP_USER" /etc/octogas

    echo "==> Base de datos"
    if ! runuser -u postgres -- psql -tAc "select 1 from pg_roles where rolname = 'octogas'" | grep -q 1; then
        local pass
        pass="$(openssl rand -hex 24)"
        runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE octogas LOGIN PASSWORD '$pass'"
        runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE octogas OWNER octogas"
        echo "postgres://octogas:$pass@localhost:5432/octogas" > /etc/octogas/database-url
        chown root:"$APP_USER" /etc/octogas/database-url
        chmod 640 /etc/octogas/database-url
    fi

    echo
    echo "Servidor preparado. Siguiente paso: sube el volcado de la base de datos (ver"
    echo "DEPLOY.md) y ejecuta:  sudo bash $APP_DIR/deploy/setup.sh"
}

main "$@"
