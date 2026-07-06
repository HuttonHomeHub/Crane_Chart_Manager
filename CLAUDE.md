# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
flask --debug run              # dev server on :5000 with auto-reload
pytest tests/                  # full suite (unit + integration; 43 tests, ~0.8s)
pytest tests/e2e/              # Playwright E2E suite (7 tests; requires Chromium)
pytest tests/test_app.py::TestClassName::test_name -v   # single test
python -m playwright install chromium   # install browser once after pip install
```

Deps: `pip install -r requirements.txt` (Flask 3.1.1, pytest, pytest-playwright). Python venv already exists at `.venv/`.

**Environment variables** (all optional; defaults match original behaviour):
- `CRANE_UPLOAD_DIR` — path to PDF storage directory (default: `uploads`)
- `CRANE_DB` — path to SQLite database file (default: `crane.db`)
- `CRANE_MAX_UPLOAD_MB` — maximum upload size in MB (default: `500`)
- `CRANE_MAX_FIELD_LEN` — max characters per metadata field (default: `64`)
- `CRANE_TRUST_PROXY` — set to `1` **only** when running behind a reverse proxy (e.g. nginx) that terminates TLS and sets `X-Forwarded-Proto`/`X-Forwarded-For`. Wraps `app.wsgi_app` in Werkzeug's `ProxyFix` (`x_for=1, x_proto=1, x_host=1` — one hop only). Never enable this with no proxy in front — any client could then spoof its own scheme/IP and flip the CSRF cookie's `Secure` flag or dodge rate-limit keying. See RR-011/DL-020.

## Architecture

Single-process Flask app. State is the `uploads/` directory plus `crane.db` (SQLite). Core files: [app.py](app.py), [templates/index.html](templates/index.html), [static/main.js](static/main.js), [static/main.css](static/main.css).

**Filename is the primary key.** `generate_filename(make, type, model, capacity)` produces a deterministic slug (`make_type_model_capacity.pdf`, lowercased, non-`[A-Za-z0-9._-]` stripped, 64-char cap per field). The same slug is (a) the file on disk in `uploads/`, and (b) the primary key in the `specs` SQLite table. Editing any of the four fields renames the file on disk AND rewrites the metadata — see `PUT /api/metadata/<filename>`, which rolls back the rename if the metadata write fails. The rename+metadata write must stay atomic-as-a-pair.

**Metadata storage (SQLite).** `DB_FILE` env var (default `crane.db`) points to the SQLite database. `init_db()` creates two tables: `specs` (filename PK, make, type, model, capacity, uploaded_at, updated_at, original_filename) and `spec_events` (audit log). `load_metadata()` returns `{filename: {fields}}` dict from `specs`. `save_metadata(metadata)` does DELETE+INSERT in one transaction. Tests monkeypatch `DB_FILE` to `tmp_path / "crane.db"` and call `app_module.init_db()` to create tables in the test DB.

**Metadata concurrency.** `metadata_lock()` wraps every load-mutate-save — including `delete_file` — with a `threading.Lock`. All three mutating routes (`upload`, `update_metadata`, `delete_file`) must hold the lock around their full read-modify-write cycle. The SQLite WAL mode handles storage-level concurrency; the threading lock serialises the application-level load-modify-save cycle.

**Audit trail.** `log_event(event_type, filename, before, after)` appends immutably to `spec_events` on every upload, edit, and delete. `before`/`after` are JSON-serialised metadata snapshots.

**Pagination.** `GET /api/pdfs?after=<filename>&limit=<n>` returns `{"items": [...], "total": N, "next_cursor": "<last-item-of-page>" | null}`. `next_cursor` is the filename of the last item on the current page; the caller sends `?after=<next_cursor>` for the next page. `api.listPdfs(onPage)` in `static/main.js` fetches bounded pages (`PDFS_PAGE_SIZE = 200`) in a loop and invokes `onPage` with each page's items as it arrives; `loadFileList()` uses this to repaint the sidebar progressively when a catalogue spans more than one page.

**Virtual scrolling (sidebar).** `sidebar.selectMake()` doesn't build every `.model-item` row up front — it flattens type headers + rows into `this._modelQueue` and renders `MODEL_RENDER_BATCH_SIZE` (60) at a time via `_appendModelBatch()`. A trailing `.sidebar__sentinel` element, observed by an `IntersectionObserver` rooted on `#model-list`, triggers the next batch as the user scrolls. `sidebar.filter()` calls `_flushModelQueue()` first so text search can match rows that haven't been scrolled into view yet. When adding new sidebar rendering logic, remember rows may not exist in the DOM yet — don't assume `document.querySelectorAll('.model-item')` is exhaustive.

**CSRF via double-submit cookie.** `_csrf_guard` before-request hook rejects any `POST/PUT/PATCH/DELETE` unless the `crane_csrf` cookie matches the `X-CSRF-Token` header (`secrets.compare_digest`). GETs are exempt. `_csrf_issue` after-request hook mints the cookie if absent. No `SECRET_KEY` and no Flask-WTF — deliberate. Any new mutating route inherits the guard automatically.

**CSP with per-request nonce.** `_csp_nonce` before-request hook generates a nonce; `_csp_header` after-request hook writes it. `script-src` is strict (nonces only, no `unsafe-inline`/`unsafe-eval`); `style-src` retains `'unsafe-inline'` because PDF.js sets `canvas.style.width/height` per-frame. When adding inline JS, always stamp the nonce; when adding inline styles, prefer a CSS class.

**Errors as JSON.** The global `HTTPException` handler rewrites every 4xx/5xx into `{"error": "..."}`. Bare `except` clauses log via `app.logger.exception()` and return `{"error": "Internal server error"}` — never `str(e)`. The XHR client depends on JSON — do not return HTML error pages.

**Frontend.** [static/main.js](static/main.js) is the extracted ES module. [templates/index.html](templates/index.html) loads it with the CSP nonce. The JS is divided into labelled regions: `STATE`, `API`, `TOAST`, `THEME`, `MODAL`, `METADATA MODAL`, `SHORTCUTS`, `DROPZONE`, `SIDEBAR`, `VIEWER`, `INIT`. Modals use native `<dialog>`. CSS breakpoints are CSS custom properties (`--bp-mobile`, `--bp-tablet`) read by JS via `getComputedStyle`.

## Testing constraints

`tests/conftest.py` monkeypatches `UPLOAD_FOLDER` and `DB_FILE` onto `tmp_path` per test, then calls `app_module.init_db()` to create the tables in the test database. Tests never touch the developer's real catalogue. The `csrf` fixture mints a token via `GET /api/pdfs`.

The concurrent-writes test (`test_concurrent_metadata_writes_serialize`) spawns 20 threads calling `metadata_lock()` — if you refactor the lock, this is the guardrail.

`tests/e2e/conftest.py` starts a live Flask server on a free port using `werkzeug.serving.make_server`. The `live_server` fixture is session-scoped (one server per run); `page` is function-scoped (fresh browser per test). E2E tests upload unique files per test and track them by `data-filename` attribute.

## Manual QA

`pytest` doesn't exercise the browser fully. After UI changes, walk [QA-CHECKLIST.md](QA-CHECKLIST.md) — it covers theme toggle, drag-drop, modals, mobile drawer, fullscreen, keyboard shortcuts, and focus restoration on delete.
