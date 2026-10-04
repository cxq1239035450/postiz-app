#!/usr/bin/env bash
# Generic single-service application: copy to deploy/automation/project.sh.
COMPOSE_DIR=deploy/production
COMPOSE_FILE=compose.yaml
COMPOSE_ENV_FILE='' # Set .env when Compose requires server-side interpolation.
APP_SERVICE=web
IMAGE_REPOSITORY=myapp-release
DOCKERFILE=Dockerfile
BUILD_CONTEXT=.
PUBLIC_HEALTH_PATH=/health
# Healthcheck must be declared in Compose or Dockerfile and return healthy.
# No custom startup bind mount or database backup is needed here.
# Add before_switch() if this project has a database or migration requirements.
