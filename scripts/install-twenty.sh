#!/usr/bin/env bash
# install-twenty.sh — install + boot the bundled Twenty CRM stack from the
# Smyth setup wizard.
#
# Does:
#   1. Check Docker is installed (print a clear message if not).
#   2. Generate secrets if docker/twenty/.env doesn't exist yet.
#   3. docker compose up -d
#   4. Wait for the healthcheck, then report the CRM URL.
#
# Safe: generates random secrets locally, never ships a real credential, and
# never touches anything outside docker/twenty/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TWENTY_DIR="$SCRIPT_DIR/../docker/twenty"
COMPOSE_FILE="$TWENTY_DIR/docker-compose.yml"
ENV_FILE="$TWENTY_DIR/.env"
ENV_EXAMPLE="$TWENTY_DIR/.env.example"

echo "== Smyth: install Twenty CRM =="

# ── 1. Docker present? ───────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Docker is not installed."
  echo "  macOS: install Docker Desktop from https://www.docker.com/products/docker-desktop/"
  echo "         then run this again."
  echo "  Linux: see https://docs.docker.com/engine/install/"
  echo ""
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Docker is installed but not running. Start Docker Desktop, then retry."
  echo ""
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo ""
  echo "The helper program needs an update. Please update Docker, then try again."
  echo ""
  exit 1
fi

# ── 2. Secrets ────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$COMPOSE_FILE" ]; then
    echo "ERROR: $COMPOSE_FILE not found. Is the docker/twenty bundle present?"
    exit 1
  fi
  echo "Getting everything ready..."
  gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48; }
  cat > "$ENV_FILE" <<EOF
APP_SECRET=$(gen)
ENCRYPTION_KEY=$(gen)
FALLBACK_ENCRYPTION_KEY=$(gen)
EOF
  chmod 600 "$ENV_FILE"
  echo "  done."
else
  echo "Already prepared."
fi

# ── 3. Boot ───────────────────────────────────────────────────────────────
echo ""
echo "Starting your Customer Book (this can take a minute the first time)..."
cd "$TWENTY_DIR"
docker compose --env-file "$ENV_FILE" up -d

# ── 4. Wait for health ───────────────────────────────────────────────────
echo "Waiting for your Customer Book to be ready..."
for i in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' smyth-twenty-server 2>/dev/null || echo 'starting')"
  if [ "$status" = "healthy" ]; then
    echo ""
    echo "SUCCESS: Your Customer Book is ready!"
    echo ""
    echo "  Next steps:"
    echo "  1. Your assistant can now remember your customers."
    echo "  2. The first time you use it, you'll be asked to make a login —"
    echo "     pick any email and password you'll remember."
    exit 0
  fi
  sleep 2
done

echo ""
echo "Almost there — it's still getting ready. Give it a minute, then check again."
echo "If it still isn't ready, restart Smyth and try once more."
exit 0
