#!/bin/sh
# Everything CI's "TypeScript rebuild checks" job runs (.github/workflows/ci.yml), the same
# way: `npm run check` (which builds dist/) in the Node 22 container, then the end-to-end
# tests (scripts/e2e.sh). Writes only gitignored paths (node_modules/, dist/, coverage/,
# e2e-results/). Becomes scripts/check.sh when the Python app is retired.
set -eu
cd "$(dirname "$0")/.."

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$PWD":/app -w /app node:22-bookworm sh -c 'npm ci && npm run check'
sh scripts/e2e.sh
