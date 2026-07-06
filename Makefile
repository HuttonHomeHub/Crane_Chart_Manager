.PHONY: dev serve test

# Hot-reload dev server (Flask built-in, debug mode)
dev:
	flask --debug run --host 0.0.0.0 --port 5000

# Production-like server (Gunicorn, single worker for dev, auto-reload)
serve:
	gunicorn --workers 1 --bind 0.0.0.0:5000 --reload app:app

test:
	pytest tests/ -v --tb=short
