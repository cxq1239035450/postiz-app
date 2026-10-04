FROM node:22.20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends g++ make python3 bash nginx ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system www \
    && adduser --system --ingroup www --home /www --shell /usr/sbin/nologin www \
    && mkdir -p /www && chown -R www:www /www /var/lib/nginx
RUN npm --no-update-notifier --no-fund install --global pnpm@10.6.1 pm2
WORKDIR /app
FROM base AS builder
COPY . /app
COPY var/docker/nginx.conf /etc/nginx/nginx.conf
ARG PUBLIC_URL=https://qpublush.io
ENV NEXT_PUBLIC_BACKEND_URL=${PUBLIC_URL}/api NEXT_PUBLIC_UPLOAD_DIRECTORY=/uploads STORAGE_PROVIDER=local NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile
RUN NODE_OPTIONS=--max-old-space-size=6144 pnpm run build
# Runtime stage deliberately excludes the repository and build tools' source context.
RUN find apps/backend/dist apps/orchestrator/dist apps/frontend/.next -type f \( -name '*.map' -o -name '*.ts' -o -name '*.tsbuildinfo' \) -delete     && rm -rf apps/frontend/.next/cache
FROM base AS runtime
COPY --from=builder /etc/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/
COPY --from=builder /app/apps/backend/dist /app/apps/backend/dist
COPY --from=builder /app/apps/backend/package.json /app/apps/backend/package.json
COPY --from=builder /app/apps/orchestrator/dist /app/apps/orchestrator/dist
COPY --from=builder /app/apps/orchestrator/package.json /app/apps/orchestrator/package.json
COPY --from=builder /app/apps/frontend/.next /app/apps/frontend/.next
COPY --from=builder /app/apps/frontend/public /app/apps/frontend/public
COPY --from=builder /app/apps/frontend/package.json /app/apps/frontend/next.config.js /app/apps/frontend/
COPY --from=builder /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma
COPY --from=builder /app/deploy/production/start.sh /app/deploy/production/start.sh
ENV NODE_ENV=production AI_SETTINGS_FILE=/config/.env
CMD ["bash", "/app/deploy/production/start.sh"]
