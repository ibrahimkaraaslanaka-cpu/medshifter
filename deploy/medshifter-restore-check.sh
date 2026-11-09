#!/usr/bin/env bash
set -euo pipefail

database=medshifter_restore_check_$$
backup=$(find /var/backups/medshifter -maxdepth 1 -type f -name 'medshifter_prod-*.dump' | sort | tail -n 1)
if [ -z "$backup" ]; then
    echo 'No MedShifter backup found' >&2
    exit 1
fi
if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$database'" | grep -q '^1$'; then
    echo 'Restore test database already exists; refusing to overwrite' >&2
    exit 1
fi

runuser -u postgres -- createdb "$database"
trap 'runuser -u postgres -- dropdb --if-exists "$database"' EXIT
runuser -u postgres -- pg_restore --no-owner -d "$database" < "$backup"
table_count=$(runuser -u postgres -- psql -d "$database" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
if [ "$table_count" -ne 5 ]; then
    echo "Restored table count mismatch: $table_count" >&2
    exit 1
fi
echo 'MedShifter backup restored successfully into an isolated test database'
