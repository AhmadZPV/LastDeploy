#!/bin/sh
set -eu

mkdir -p /app/data /app/uploads

if [ ! -s /app/data/dev.db ]; then
  echo "Preparing a clean production database"
  PRODUCTION_DB_PATH=/app/data/dev.db node scripts/prepare-production.mjs
fi

# Existing databases are never altered automatically. Schema changes must be
# reviewed and applied explicitly so container restarts cannot cast/drop data.
echo "Using persistent database /app/data/dev.db"

exec "$@"
