FROM python:3.12-slim

RUN useradd --create-home --shell /bin/bash crane

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads && chown crane:crane uploads

USER crane

VOLUME ["/app/uploads"]

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')"

# R-027: single worker — Flask-Limiter's storage_uri="memory://" keeps rate-limit
# counters in process memory. Multiple workers would each hold independent counters,
# silently multiplying the configured limits (e.g. 10/min becomes ~10/min per worker).
# A single-user internal tool doesn't need the concurrency a second worker buys;
# if that changes, switch storage_uri to a shared backend (e.g. Redis) first.
CMD ["gunicorn", "--workers", "1", "--bind", "0.0.0.0:5000", "app:app"]
