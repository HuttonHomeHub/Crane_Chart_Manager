#!/bin/sh
# Every check CI's "checks" job runs, in the same order. CI calls this script, so
# a local run proves what GitHub will see. Assumes requirements-dev.txt is installed.
# E2E tests (tests/e2e/) are a separate CI job and need Playwright browsers.
# On CT 106 run it in a throwaway container: see "Checks on CT 106" in CLAUDE.md.
set -eu

echo "== ruff"
ruff check app.py static tests

echo "== pip-audit"
pip-audit -r requirements.txt --strict

echo "== pytest (unit + integration, coverage gate 80%)"
pytest tests/ --ignore=tests/e2e --cov=app --cov-report=term-missing \
    --cov-fail-under=80 -q --tb=short "$@"
