#!/usr/bin/env bash
set -euo pipefail
test -s /config/.env
ln -sf /config/.env /app/.env
cd /app
pnpm exec dotenv -e /config/.env -- pnpm exec prisma db push --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
nginx -g 'daemon off;' &
nginx_pid=$!
pnpm -r --workspace-concurrency=1 --filter ./apps/backend --filter ./apps/frontend --filter ./apps/orchestrator run pm2
pm2 logs --raw &
logs_pid=$!
trap 'kill "$nginx_pid" "$logs_pid" 2>/dev/null || true' EXIT
wait -n "$nginx_pid" "$logs_pid" || true
echo 'Nginx or PM2 log process exited; restarting the application container.' >&2
exit 1
