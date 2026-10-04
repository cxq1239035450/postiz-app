#!/usr/bin/env bash
# Runs on a GitHub runner, or locally with the same environment variables.
set -euo pipefail
for name in DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS DEPLOY_ROOT PUBLIC_URL; do
  test -n "${!name:-}" || { echo "Missing $name" >&2; exit 1; }
done
DEPLOY_PORT=${DEPLOY_PORT:-22}
[[ $DEPLOY_HOST =~ ^[a-zA-Z0-9.-]+$ && $DEPLOY_USER =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]
[[ $DEPLOY_PORT =~ ^[0-9]+$ && $DEPLOY_ROOT =~ ^/[a-zA-Z0-9_/-]+$ ]]
[[ $PUBLIC_URL =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]
cd "$(git rev-parse --show-toplevel)"
revision=$(git rev-parse HEAD)
release="${revision:0:12}-${GITHUB_RUN_ID:-$(date +%s)}-${GITHUB_RUN_ATTEMPT:-1}"
temp_dir=$(mktemp -d)
trap 'rm -rf -- "$temp_dir"' EXIT
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$temp_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$temp_dir/known_hosts"
git archive --format=tar.gz HEAD > "$temp_dir/source.tar.gz"
# Fail closed if credentials or server state were accidentally committed.
python3 - "$temp_dir/source.tar.gz" <<'PY'
import pathlib, sys, tarfile
with tarfile.open(sys.argv[1]) as archive:
    for member in archive:
        path = pathlib.PurePosixPath(member.name)
        name = path.name
        if ((name == '.env' or name.startswith('.env.')) and name != '.env.example'
            or name.endswith(('.pem', '.key', '.p12', '.pfx'))
            or any(part in {'site-backup', 'backups', 'releases', '.deploy-state'} for part in path.parts)):
            raise SystemExit(f'Refusing to publish sensitive/state file: {member.name}')
PY
mkdir "$temp_dir/source"
tar -xzf "$temp_dir/source.tar.gz" -C "$temp_dir/source"
cd "$temp_dir/source"
BUILD_ARGS=(--build-arg "PUBLIC_URL=$PUBLIC_URL")
source deploy/automation/project.sh
image="$IMAGE_REPOSITORY:$release"
docker build "${BUILD_ARGS[@]}" -t "$image" -f "$DOCKERFILE" "$BUILD_CONTEXT"
docker save "$image" | gzip -1 > "$temp_dir/image.tar.gz"
printf '%s\n' "$image" > "$temp_dir/image.txt"
cp deploy/automation/deploy.sh "$temp_dir/deploy.sh"
cp deploy/automation/project.sh "$temp_dir/project.sh"
if [[ -n ${STARTUP_SOURCE:-} ]]; then cp "$STARTUP_SOURCE" "$temp_dir/start.sh"; fi
(cd "$temp_dir" && sha256sum image.tar.gz image.txt project.sh deploy.sh > SHA256SUMS)
if test -f "$temp_dir/start.sh"; then (cd "$temp_dir" && sha256sum start.sh >> SHA256SUMS); fi
payload=("$temp_dir/image.tar.gz" "$temp_dir/image.txt" "$temp_dir/project.sh" "$temp_dir/deploy.sh" "$temp_dir/SHA256SUMS")
if test -f "$temp_dir/start.sh"; then payload+=("$temp_dir/start.sh"); fi
ssh_options=(-i "$temp_dir/key" -o BatchMode=yes -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$temp_dir/known_hosts" -o ConnectTimeout=20
  -o ServerAliveInterval=30 -o ServerAliveCountMax=6)
target="$DEPLOY_USER@$DEPLOY_HOST"
ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" "mkdir -p '$DEPLOY_ROOT/incoming/$release'"
scp "${ssh_options[@]}" -P "$DEPLOY_PORT" "${payload[@]}" \
  "$target:$DEPLOY_ROOT/incoming/$release/"
ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" \
  "bash '$DEPLOY_ROOT/incoming/$release/deploy.sh' '$DEPLOY_ROOT' '$release' '$PUBLIC_URL'"
