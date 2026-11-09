#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_dir=/var/backups/medshifter
database=medshifter_prod
stamp=$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$backup_dir"

database_tmp="$backup_dir/.${database}-${stamp}.dump.tmp"
database_final="$backup_dir/${database}-${stamp}.dump"
trap 'rm -f "$database_tmp"' EXIT
runuser -u postgres -- pg_dump -Fc -d "$database" > "$database_tmp"
pg_restore -l "$database_tmp" > /dev/null
mv "$database_tmp" "$database_final"

settings=/var/www/medshifter/server/data/site-settings.json
if [ -f "$settings" ]; then
    cp "$settings" "$backup_dir/site-settings-${stamp}.json"
    chmod 600 "$backup_dir/site-settings-${stamp}.json"
fi

find "$backup_dir" -maxdepth 1 -type f -name 'medshifter_prod-*.dump' -mtime +14 -delete
find "$backup_dir" -maxdepth 1 -type f -name 'site-settings-*.json' -mtime +14 -delete
echo "MedShifter PostgreSQL backup verified: $stamp"
