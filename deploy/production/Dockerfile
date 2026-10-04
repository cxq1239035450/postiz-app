FROM node:22.20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends g++ make python3 bash nginx ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system www \
    && adduser --system --ingroup www --home /www --shell /usr/sbin/nologin www \
    && mkdir -p /www && chown -R www:www /www /var/lib/nginx
RUN npm --no-update-notifier --no-fund install --global pnpm@10.6.1 pm2
WORKDIR /app
COPY . /app
COPY var/docker/nginx.conf /etc/nginx/nginx.conf
ARG PUBLIC_URL=https://qpublush.io
ENV NEXT_PUBLIC_BACKEND_URL=${PUBLIC_URL}/api NEXT_PUBLIC_UPLOAD_DIRECTORY=/uploads STORAGE_PROVIDER=local NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile
RUN NODE_OPTIONS=--max-old-space-size=6144 pnpm run build
ENV NODE_ENV=production AI_SETTINGS_FILE=/config/.env
CMD ["bash", "/app/deploy/production/start.sh"]
