#!/bin/sh
set -e

echo "Running Prisma migrations..."
# migrate deploy applies pending migrations in production
# It will exit with error if migrations fail, preventing app start
npx prisma migrate deploy || {
  echo "Migration failed. Please ensure migrations are up to date."
  exit 1
}

echo "Starting application..."
exec npm run start:prod
