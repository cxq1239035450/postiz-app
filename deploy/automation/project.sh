#!/usr/bin/env bash
# Postiz adapter. Replace this file when copying the toolkit to another project.
COMPOSE_DIR=deploy/production
COMPOSE_FILE=compose.yaml
COMPOSE_ENV_FILE=.env
APP_SERVICE=app
IMAGE_REPOSITORY=qpublish-release
DOCKERFILE=deploy/production/Dockerfile
BUILD_CONTEXT=.
STARTUP_SOURCE=deploy/production/start.sh
STARTUP_TARGET=/app/deploy/production/start.sh
PUBLIC_HEALTH_PATH=/auth/login

before_switch() {
  test -s "$prod/config/.env"
  local backup="$root/backups/postgres-$release.dump"
  "${current[@]}" exec -T postgres pg_dump -U postiz -d postiz -Fc > "$backup.part"
  test -s "$backup.part"
  mv "$backup.part" "$backup"
  echo "Database backup: $backup"
}

verify_app() {
  "${base[@]}" -f "$1" exec -T "$APP_SERVICE" node -e \
    "Promise.all([fetch('http://127.0.0.1:4200/auth/login'),fetch('http://127.0.0.1:3000/user/self')]).then(([f,b])=>process.exit(f.status===200&&b.status===401?0:1)).catch(()=>process.exit(1))"
}
