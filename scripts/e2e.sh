#!/bin/sh
# End-to-end tests: builds the Docker image from this checkout, starts it on a throwaway
# network as host "crane" with an in-memory /config (test data only) and roomy rate
# limits, and runs the Playwright tests (e2e/) from the pinned Playwright image against
# it (Node 26 there, so the tests never start the app themselves).
# Needs Docker and an installed node_modules (scripts/check.sh does both).
# SCREENSHOTS=1 also writes docs/screenshots/.
set -eu
cd "$(dirname "$0")/.."

PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.1-noble
name="crane-e2e-$$"
image="crane-charts:e2e"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "e2e: building the image"
docker build -q --build-arg APP_VERSION=e2e -t "$image" . >/dev/null
docker network create "$name" >/dev/null
docker run -d --name "$name" --network "$name" --network-alias crane \
  -e TZ=Europe/London -e BACKUP_ENABLED=0 \
  -e UPLOAD_RATE='10000 per minute' -e WRITE_RATE='10000 per minute' \
  --tmpfs /config "$image" >/dev/null

echo "e2e: waiting for /health"
i=0
until docker exec "$name" node -e "fetch('http://127.0.0.1:5000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    docker logs "$name"
    echo "e2e: the app did not become healthy" >&2
    exit 1
  fi
  sleep 1
done

docker run --rm --network "$name" --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE_URL=http://crane:5000 -e SCREENSHOTS="${SCREENSHOTS:-}" \
  -v "$PWD":/app -w /app "$PLAYWRIGHT_IMAGE" npx playwright test "$@"
