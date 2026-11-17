#!/bin/sh
# Runs as root just long enough to fix ownership of the folders the app writes, then
# drops to PUID:PGID and execs the app (which stays PID 1, so SIGTERM reaches it). A
# bind-mounted host folder of any prior ownership works without a manual chown,
# matching the linuxserver-style images in the rest of the stack.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Same resolution as server/paths.ts: the standard name, then the old CRANE_ name, then
# a default inside DATA_DIR (/config in the image).
DATA_DIR="${DATA_DIR:-/config}"
UPLOAD_DIR="${UPLOADS_DIR:-${CRANE_UPLOAD_DIR:-$DATA_DIR/uploads}}"
DB_FILE="${DB_PATH:-${CRANE_DB:-$DATA_DIR/crane.db}}"
DB_DIR="$(dirname "$DB_FILE")"
BACKUPS="${BACKUP_DIR:-${CRANE_BACKUP_DIR:-$DB_DIR/backups}}"

# Already unprivileged (e.g. a compose `user:` override): nothing to fix or drop.
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

mkdir -p "$UPLOAD_DIR" "$DB_DIR" "$BACKUPS"

# Recursive, but only for a folder not already owned by PUID: a large uploads/ tree is
# walked once (e.g. on the first start after a PUID change), not on every restart.
for d in "$DB_DIR" "$UPLOAD_DIR" "$BACKUPS"; do
  if [ "$(stat -c '%u' "$d")" != "$PUID" ]; then
    chown -R "$PUID:$PGID" "$d"
  fi
done

exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
