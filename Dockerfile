FROM python:3.12-slim

RUN useradd --create-home --shell /bin/bash crane

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Build-time ownership so the no-volume-mounted default (bare 'uploads'/'crane.db'
# under /app) is already correct — the entrypoint's runtime chown then only ever
# has to touch an actual bind-mounted path, never the whole app tree.
RUN chmod +x docker-entrypoint.sh && chown -R crane:crane /app

# R-028: stays root at container start — docker-entrypoint.sh remaps the 'crane'
# user to PUID/PGID, fixes ownership of the mounted data dirs, then drops to that
# user via setpriv before exec'ing the CMD below. See docker-entrypoint.sh.
VOLUME ["/app/uploads"]

EXPOSE 5000

# Release version stamped in by the publish workflow (from the image tag). Surfaced
# in the UI, at GET /version, and it seeds asset cache-busting when a file is unreadable.
ARG CRANE_VERSION=dev
ENV CRANE_VERSION=$CRANE_VERSION

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')"

ENTRYPOINT ["./docker-entrypoint.sh"]

# R-027: single worker — Flask-Limiter's storage_uri="memory://" keeps rate-limit
# counters in process memory. Multiple workers would each hold independent counters,
# silently multiplying the configured limits (e.g. 10/min becomes ~10/min per worker).
# A single-user internal tool doesn't need the concurrency a second worker buys;
# if that changes, switch storage_uri to a shared backend (e.g. Redis) first.
CMD ["gunicorn", "--workers", "1", "--bind", "0.0.0.0:5000", "app:app"]
