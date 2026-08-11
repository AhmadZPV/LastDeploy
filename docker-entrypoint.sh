#!/bin/sh
set -eu

mkdir -p /app/data /app/uploads

if [ ! -s /app/data/dev.db ] && [ -s /app/prisma/dev.db ]; then
  echo "Initializing persistent database from the project fixture"
  cp /app/prisma/dev.db /app/data/dev.db
fi

if [ ! -s /app/data/dev.db ]; then
  echo "Creating the initial fixture database"
  node scripts/build-fixture.mjs --db=/app/data/dev.db
fi

# Existing databases are never altered automatically. Schema changes must be
# reviewed and applied explicitly so container restarts cannot cast/drop data.
echo "Using persistent database /app/data/dev.db"

exec "$@"
