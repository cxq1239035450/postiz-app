#!/usr/bin/env bash
# Update an existing Docker Compose installation without replacing its secrets/data.
set -euo pipefail
umask 077
root=${1:?Usage: deploy.sh ROOT RELEASE PUBLIC_URL}
release=${2:?Missing release}
public_url=${3:?Missing PUBLIC_URL}
[[ $root =~ ^/[a-zA-Z0-9_/-]+$ && $root != / ]]
[[ $release =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,100}$ ]]
[[ $public_url =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]
root=$(realpath "$root")
state="$root/.deploy-state"
incoming="$root/incoming/$release"
for tool in docker python3 flock curl; do command -v "$tool" >/dev/null; done
mkdir -p "$state" "$root/backups"
exec 9>"$state/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
exec > >(tee -a "$state/$release.log") 2>&1
# Only images and runtime deployment metadata arrive on this server.
cleanup_payload() { rm -f -- "$incoming/image.tar.gz"; }
trap cleanup_payload EXIT
(cd "$incoming" && sha256sum -c SHA256SUMS)
COMPOSE_DIR=deploy/production
COMPOSE_FILE=compose.yaml
COMPOSE_ENV_FILE=.env
APP_SERVICE=app
IMAGE_REPOSITORY=app-release
DOCKERFILE=Dockerfile
BUILD_CONTEXT=.
STARTUP_SOURCE=
STARTUP_TARGET=
PUBLIC_HEALTH_PATH=/
HEALTH_ATTEMPTS=60
HEALTH_INTERVAL=5
BUILD_ARGS=(--build-arg "PUBLIC_URL=$public_url")
# Project hooks are trusted repository code, just like the Dockerfile.
before_switch() { echo 'No project backup hook configured.'; }
verify_app() { return 0; }
source "$incoming/project.sh"
prod="$root/$COMPOSE_DIR"
test -f "$prod/$COMPOSE_FILE"
image=$(cat "$incoming/image.txt")
[[ $image == "$IMAGE_REPOSITORY:$release" ]]
echo "Loading prebuilt $image; no source build runs on the server."
docker load -i "$incoming/image.tar.gz"
docker image inspect "$image" >/dev/null
cleanup_payload
base=(docker compose --project-directory "$prod")
if [[ -n $COMPOSE_ENV_FILE ]]; then
  test -s "$prod/$COMPOSE_ENV_FILE"
  base+=(--env-file "$prod/$COMPOSE_ENV_FILE")
fi
base+=(-f "$prod/$COMPOSE_FILE")
active="$state/active.json"
current=("${base[@]}")
if test -f "$active"; then current+=(-f "$active"); fi
container=$("${current[@]}" ps -q "$APP_SERVICE")
test -n "$container" || { echo 'Existing app container is required.' >&2; exit 1; }
# Inspect only image and startup mount, never the environment containing secrets.
old_image=$(docker inspect --format '{{.Image}}' "$container")
previous_start=
candidate_start=
if [[ -n $STARTUP_SOURCE && -n $STARTUP_TARGET ]]; then
  old_start=$(docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$STARTUP_TARGET\"}}{{.Source}}{{end}}{{end}}" "$container")
  test -f "$old_start" || { echo 'Expected startup bind mount missing.' >&2; exit 1; }
  previous_start="$state/$release-previous-start.sh"
  candidate_start="$state/$release-start.sh"
  cp "$incoming/start.sh" "$candidate_start"
  cp "$old_start" "$previous_start"
fi
write_override() {
  python3 - "$1" "$2" "$3" "$APP_SERVICE" "$STARTUP_TARGET" <<'PY'
import json, sys
service = {'image': sys.argv[2]}
if sys.argv[3]:
    service['volumes'] = [{'type': 'bind', 'source': sys.argv[3],
                           'target': sys.argv[5], 'read_only': True}]
with open(sys.argv[1], 'w') as file:
    json.dump({'services': {sys.argv[4]: service}}, file)
PY
}
previous="$state/$release-previous.json"
candidate="$state/$release-candidate.json"
write_override "$previous" "$old_image" "$previous_start"
write_override "$candidate" "$image" "$candidate_start"
"${base[@]}" -f "$candidate" config --quiet
before_switch
healthy() {
  local override=$1 id status
  for ((attempt=0; attempt<HEALTH_ATTEMPTS; attempt++)); do
    id=$("${base[@]}" -f "$override" ps -q "$APP_SERVICE")
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)
    if [[ $status == healthy ]] && verify_app "$override"; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}
switched=0
rollback_on_failure() {
  local result=$?
  trap - EXIT INT TERM
  if ((switched)); then
    echo "Deployment failed. Restoring previous image. Check project backups in $root/backups."
    cp "$previous" "$active"
    if "${base[@]}" -f "$active" up -d --no-build --no-deps "$APP_SERVICE" && healthy "$active"; then
      echo 'Previous application restored. Database schema was NOT rolled back.'
    else
      echo 'ROLLBACK NEEDS MANUAL ATTENTION. Inspect application logs and database compatibility.' >&2
    fi
  fi
  cleanup_payload
  exit "$result"
}
trap rollback_on_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
switched=1
"${base[@]}" -f "$candidate" up -d --no-build --no-deps "$APP_SERVICE"
healthy "$candidate"
cp "$candidate" "$active.tmp"
mv "$active.tmp" "$active"
printf '%s\n' "$release" > "$state/current-release"
switched=0
echo "Deployed $release. Project backups: $root/backups"
# External smoke check is reported separately; network/DNS failure must not roll back healthy code.
if ! curl --fail --silent --show-error --max-time 30 -o /dev/null "$public_url$PUBLIC_HEALTH_PATH"; then
  echo 'WARNING: local health checks passed, but public URL needs inspection.' >&2
fi
