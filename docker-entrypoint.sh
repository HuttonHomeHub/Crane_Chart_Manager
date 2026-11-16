#!/bin/sh
# R-028: PUID/PGID-aware entrypoint, matching the LinuxServer.io-style pattern used
# by other containers in this stack (e.g. photomapper). Runs as root just long enough
# to align the 'crane' user with the requested PUID/PGID and fix ownership of whatever
# directories the app is about to write to, then drops privileges and execs the CMD.
# This means a bind-mounted host directory of ANY prior ownership "just works" —
# no manual chown required on the host before first start.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -g crane)" != "$PGID" ]; then
    groupmod -o -g "$PGID" crane
fi
if [ "$(id -u crane)" != "$PUID" ]; then
    usermod -o -u "$PUID" crane
fi

# Same resolution as app.py: the standard name, then the old CRANE_ name, then a
# default inside DATA_DIR (/config in the image).
DATA_DIR="${DATA_DIR:-.}"
UPLOAD_DIR="${UPLOADS_DIR:-${CRANE_UPLOAD_DIR:-$DATA_DIR/uploads}}"
DB_FILE="${DB_PATH:-${CRANE_DB:-$DATA_DIR/crane.db}}"
DB_DIR="$(dirname "$DB_FILE")"
BACKUPS="${BACKUP_DIR:-${CRANE_BACKUP_DIR:-$DB_DIR/backups}}"

mkdir -p "$UPLOAD_DIR" "$DB_DIR" "$BACKUPS"

# Only chown (recursively) directories that aren't already owned by the target
# user — avoids an expensive walk of a large uploads/ tree on every restart once
# ownership is already correct.
for d in "$UPLOAD_DIR" "$DB_DIR" "$BACKUPS"; do
    owner="$(stat -c '%u' "$d")"
    if [ "$owner" != "$PUID" ]; then
        chown -R "$PUID:$PGID" "$d"
    fi
done

exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups "$@"
