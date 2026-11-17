#!/bin/sh
# End-to-end tests for the TypeScript rebuild: starts the built app (dist/ from
# `npm run build`, server/ run by Node 22) on a throwaway network as host "crane", with
# its data in the container's own /tmp (test data only) and roomy rate limits, then runs
# the Playwright tests (e2e/) from the pinned Playwright image against it.
# Needs Docker, node_modules and dist/ (scripts/check-node.sh does all three).
# SCREENSHOTS=1 also writes docs/screenshots/.
set -eu
cd "$(dirname "$0")/.."

PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.1-noble
name="crane-e2e-$$"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker network create "$name" >/dev/null
docker run -d --name "$name" --network "$name" --network-alias crane \
  --user "$(id -u):$(id -g)" -v "$PWD":/app:ro -w /app \
  -e NODE_ENV=production -e TZ=Europe/London -e DATA_DIR=/tmp/data -e APP_VERSION=e2e \
  -e BACKUP_ENABLED=0 -e UPLOAD_RATE='10000 per minute' -e WRITE_RATE='10000 per minute' \
  node:22-bookworm node server/index.ts >/dev/null

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
