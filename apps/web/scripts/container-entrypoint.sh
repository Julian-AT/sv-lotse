#!/bin/sh
set -eu
node /app/migrator/packages/db/src/db/migrate.mjs
exec node /app/apps/web/server.js
