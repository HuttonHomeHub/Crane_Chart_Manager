#!/bin/sh
# Everything CI checks, run the same way here and in CI (.github/workflows/ci.yml):
# `npm run check` in the Node 22 container, then the end-to-end tests against the built
# Docker image (scripts/e2e.sh). Writes only gitignored paths (node_modules/, dist/,
# coverage/, e2e-results/).
set -eu
cd "$(dirname "$0")/.."

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$PWD":/app -w /app node:22-bookworm sh -c 'npm ci && npm run check'
sh scripts/e2e.sh
