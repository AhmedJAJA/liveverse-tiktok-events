#!/bin/sh
# Back up the SPONGE LIVE database to a compressed custom-format dump.
#   DATABASE_URL=postgres://… BACKUP_DIR=./backups npm run db:backup
# Restore into an empty database:
#   pg_restore --clean --if-exists --no-owner -d "$TARGET_DATABASE_URL" backups/sponge-YYYYmmdd-HHMMSS.dump
set -eu
: "${DATABASE_URL:?DATABASE_URL is not set}"
DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP:-14}"
mkdir -p "$DIR"
FILE="$DIR/sponge-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$DATABASE_URL"
pg_restore --list "$FILE" > /dev/null   # fails if the dump is unreadable
echo "backup written: $FILE"
# keep only the newest $KEEP dumps
ls -1t "$DIR"/sponge-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
