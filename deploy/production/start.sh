#!/usr/bin/env bash
set -euo pipefail
test -s /config/.env
ln -sf /config/.env /app/.env
cd /app
pnpm exec dotenv -e /config/.env -- pnpm exec prisma db push --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
nginx
pnpm -r --workspace-concurrency=1 --filter ./apps/backend --filter ./apps/frontend --filter ./apps/orchestrator run pm2
exec pm2 logs --raw
