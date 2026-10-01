#!/usr/bin/env bash
# Copia de seguridad diaria de la base de datos (la lanza octogas-backup.timer).
# Guarda un volcado por día y borra los de más de 14 días.
set -euo pipefail

main() {
    source "$(dirname "$0")/config.env"
    local url file
    url="$(grep '^DATABASE_URL=' "$APP_DIR/api/.env" | cut -d= -f2-)"
    file="$BACKUP_DIR/octogas-$(date +%F).dump"
    pg_dump "$url" -Fc -f "$file.tmp"
    mv "$file.tmp" "$file"
    find "$BACKUP_DIR" -name 'octogas-*.dump' -mtime +14 -delete
    echo "Copia guardada: $file ($(du -h "$file" | cut -f1))"
}

main "$@"
