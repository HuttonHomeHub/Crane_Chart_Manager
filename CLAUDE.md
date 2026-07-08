# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
flask --debug run              # dev server on :5000 with auto-reload
pytest tests/                  # full suite (unit + integration; 79 tests, ~1.3s)
pytest tests/e2e/              # Playwright E2E suite (21 tests; requires Chromium)
pytest tests/test_app.py::TestClassName::test_name -v   # single test
python -m playwright install chromium   # install browser once after pip install
```

Deps: `pip install -r requirements.txt` (Flask 3.1.1, pytest, pytest-playwright). Python venv already exists at `.venv/`.

**Environment variables** (all optional; defaults match original behaviour):
- `CRANE_UPLOAD_DIR` — path to PDF storage directory (default: `uploads`)
- `CRANE_DB` — path to SQLite database file (default: `crane.db`)
- `CRANE_MAX_UPLOAD_MB` — maximum upload size in MB (default: `500`)
- `CRANE_MAX_FIELD_LEN` — max characters per metadata field (default: `64`)
- `CRANE_UPLOAD_RATE` / `CRANE_WRITE_RATE` — Flask-Limiter limits for `POST /api/upload` and other mutating routes (defaults: `60 per minute` each). Bumped from the original 10/30 to give the bulk importer headroom; safe because the app sits behind the tinyauth gate. Applied via `app.config['UPLOAD_RATE'|'WRITE_RATE']` read by a callable in the `@limiter.limit(...)` decorators, so tests/env can override.
- `CRANE_TRUST_PROXY` — set to `1` **only** when running behind a reverse proxy (e.g. nginx) that terminates TLS and sets `X-Forwarded-Proto`/`X-Forwarded-For`. Wraps `app.wsgi_app` in Werkzeug's `ProxyFix` (`x_for=1, x_proto=1, x_host=1` — one hop only). Never enable this with no proxy in front — any client could then spoof its own scheme/IP and flip the CSRF cookie's `Secure` flag or dodge rate-limit keying. See RR-011/DL-020.

**Docker deployment convention.** The published image (`ghcr.io/huttonhomehub/crane-charts`) has no hardcoded data path — unlike LinuxServer.io-style images, `CRANE_UPLOAD_DIR`/`CRANE_DB` default to plain relative paths (`uploads`, `crane.db`) under `WORKDIR /app`. To match this stack's other containers (e.g. `photomapper`'s `/config` convention), point both at a single mounted `/config` directory:
```yaml
environment:
  - PUID=1000
  - PGID=1000
  - CRANE_TRUST_PROXY=1
  - CRANE_UPLOAD_DIR=/config/uploads
  - CRANE_DB=/config/crane.db
volumes:
  - /apps/crane-charts/config:/config
```
`docker-entrypoint.sh` (R-028) remaps the image's `crane` user to `PUID`/`PGID` and chowns whatever `CRANE_UPLOAD_DIR`/`CRANE_DB` resolve to at container start, so a freshly created (or root-owned) host directory just works — no manual `chown` needed before first start.

## Architecture

Single-process Flask app. State is the `uploads/` directory plus `crane.db` (SQLite). Core files: [app.py](app.py), [templates/index.html](templates/index.html), [static/main.js](static/main.js), [static/main.css](static/main.css).

**A crane owns many files; the slug is the crane identity.** `generate_crane_id(make, type, model, capacity)` produces a deterministic slug (`make_type_model_capacity`, lowercased, non-`[A-Za-z0-9._-]` stripped, 64-char cap per field). That slug is (a) the `cranes.id` primary key, and (b) the crane's directory name under `uploads/<crane_id>/`. Each crane has one-or-many `files`, all living inside that directory. `cranes.primary_file` points at the file that opens by default (NULL falls back to the earliest-uploaded file). `generate_filename()` (slug + `.pdf`) is retained only for its unit test. Editing the four fields renames the crane **directory** (a single atomic `os.rename`) and rewrites `cranes`/`files` — see `PUT /api/metadata/<crane_id>`, which rolls back the directory rename if the DB write fails. The rename+DB write must stay atomic-as-a-pair.

**Metadata storage (SQLite).** `DB_FILE` env var (default `crane.db`) points to the SQLite database. `init_db()` creates `cranes` (id PK, make, type, model, capacity, uploaded_at, updated_at, primary_file), `files` (id PK, crane_id, stored_name, original_filename, label, uploaded_at; `UNIQUE(crane_id, stored_name)`), and `spec_events` (audit log). `list_cranes()` returns a list of crane dicts each with a `files: [...]` list and resolved primary (via `_crane_from_rows`); `get_crane(crane_id)` returns one or None. There is no `load_metadata`/`save_metadata` anymore — routes do targeted SQL. Tests monkeypatch `DB_FILE` to `tmp_path / "crane.db"` and call `app_module.init_db()`.

**Migration.** On import, `_migrate_from_json()` (legacy `metadata.json` → `specs`, now inert) then `_migrate_from_specs()` runs: each old single-file `specs` row becomes a crane with one primary file, its flat `uploads/<slug>.pdf` moving to `uploads/<slug>/<slug>.pdf`. Idempotent (skips existing cranes); renames `specs` → `specs_legacy` on completion so it never re-runs.

**Metadata concurrency.** `metadata_lock()` (a `threading.Lock`) wraps the full disk+DB read-modify-write of every mutating route: `upload_file`, `add_crane_file`, `set_primary_file`, `delete_crane_file`, `update_metadata`, `delete_file`. SQLite WAL handles storage-level concurrency; the threading lock serialises the app-level cycle (e.g. save-file-then-insert-row, or rename-dir-then-update-rows) so disk and DB can't diverge.

**Audit trail.** `log_event(event_type, crane_id, before, after)` appends immutably to `spec_events`. Event types: `upload` (new crane), `file_add`, `primary_change`, `file_remove`, `edit`, `delete`. `before`/`after` are JSON snapshots from `_audit_snapshot()`.

**Multi-file routes & UI.** `POST /api/cranes/<id>/files` (attach a supplementary PDF + optional `label`), `PUT /api/cranes/<id>/primary` (body `{file_id}`), `PATCH /api/cranes/<id>/files/<file_id>` (rename a file's `label`), `DELETE /api/cranes/<id>/files/<file_id>` (delete one file — deleting the last file deletes the whole crane; deleting the primary falls back). `DELETE /api/delete/<crane_id>` deletes the whole crane. Frontend: the sidebar stays one-row-per-crane (a `.model-item__filecount` badge marks cranes with >1 file); all file management lives in a **viewer file strip** (`#file-strip`, built by `viewer._renderStrip()`) — one `.file-chip` per file, click to switch (`viewer.showFile`), ★ to set primary, ✎ to rename, × to delete, plus an "Add file" button. `viewer._applyCrane(updatedCrane)` re-syncs `state.current`/strip/sidebar after a mutation without a full reload. The metadata modal has four modes (`upload` | `edit` | `addfile` | `editlabel`); addfile/editlabel hide the make/type/model/capacity grid and show a label field. Dropping a PDF while a crane is open routes to addfile mode for that crane (with a "Create a new crane instead" escape); dropping with nothing open creates a new crane.

**Bulk import (`bulkImport` module).** Dropping 2+ PDFs (or multi-selecting in the upload picker) opens `#bulk-modal`. `parseFilename()` splits the house convention `Manufacturer Model (Label).pdf` into `{make, model, label}` (make = first word, model = the rest, label = the optional parenthetical). `buildDrafts()` **groups files by `(make, model)`** — a crane's several files share those — so each grid row is one crane with its file(s); this avoids duplicate-slug 409s. The user fills the two fields not in the filename (Type + Capacity; "Set all types" applies down the column), and multi-file cranes show a radio to pick the primary (defaults to the first). `submit()` uploads each crane sequentially: the chosen primary via `POST /api/upload` (carrying its label — the endpoint now accepts an optional `label` for the first file), then the rest via `POST /api/cranes/<id>/files`. `withRetry()` backs off and retries on 429. Rows show ✓/✗; failures stay for a "Retry failed" pass. A single dropped file still uses the metadata modal, now prefilled via `parseFilename()`.

**In-PDF find (`viewer` find methods).** A `#find-bar` (toolbar magnifier, `Ctrl/Cmd+F`, or `/` opens it) searches the open document. `_runFind()` builds a per-page text cache lazily via `page.getTextContent()` (`viewer._find.pageText`, keyed by page), collects item-level matches across all pages, and shows an `X/Y` count. `_drawHighlights()` places `.pdf-highlight` boxes into the `#pdf-highlights` overlay (a sibling of `#pdf-canvas` inside `#pdf-stage`) — positions are computed from each text item's transform composed with the render viewport, expressed in **%** so they track the canvas under any CSS scaling. `renderPage()` stores `_renderViewport`/`_renderPageNum` and redraws highlights after every render; `_loadPdf()`/`openEmpty()` reset the find state. Highlighting is whole-item (a matched text run/cell), not sub-word.

**Pagination.** `GET /api/pdfs?after=<crane_id>&limit=<n>` returns `{"items": [...crane dicts...], "total": N, "next_cursor": "<last-crane-id-of-page>" | null}`. `next_cursor` is the id of the last crane on the current page; the caller sends `?after=<next_cursor>` for the next page. `api.listPdfs(onPage)` in `static/main.js` fetches bounded pages (`PDFS_PAGE_SIZE = 200`) in a loop and invokes `onPage` with each page's items; `loadFileList()` uses this to repaint the sidebar progressively when a catalogue spans more than one page. Each crane item carries `name` (= id, sidebar keying compat), `url` (primary file), and `file_count`.

**Virtual scrolling (sidebar).** `sidebar.selectMake()` doesn't build every `.model-item` row up front — it flattens type headers + rows into `this._modelQueue` and renders `MODEL_RENDER_BATCH_SIZE` (60) at a time via `_appendModelBatch()`. A trailing `.sidebar__sentinel` element, observed by an `IntersectionObserver` rooted on `#model-list`, triggers the next batch as the user scrolls. `sidebar.filter()` calls `_flushModelQueue()` first so text search can match rows that haven't been scrolled into view yet. When adding new sidebar rendering logic, remember rows may not exist in the DOM yet — don't assume `document.querySelectorAll('.model-item')` is exhaustive. Type headers are `<button>`s that toggle `.type-group.is-collapsed` (CSS hides `.model-item` when collapsed); `filter()` force-expands groups on a query so matches aren't hidden. `filter()` also keeps a make visible when the query matches any of its cranes via `sidebar._makeSearchText` (per-make concatenated model/type/capacity/label text built in `renderMakes()`), not just the make name.

**CSRF via double-submit cookie.** `_csrf_guard` before-request hook rejects any `POST/PUT/PATCH/DELETE` unless the `crane_csrf` cookie matches the `X-CSRF-Token` header (`secrets.compare_digest`). GETs are exempt. `_csrf_issue` after-request hook mints the cookie if absent. No `SECRET_KEY` and no Flask-WTF — deliberate. Any new mutating route inherits the guard automatically.

**CSP with per-request nonce.** `_csp_nonce` before-request hook generates a nonce; `_csp_header` after-request hook writes it. `script-src` is strict (nonces only, no `unsafe-inline`/`unsafe-eval`); `style-src` retains `'unsafe-inline'` because PDF.js sets `canvas.style.width/height` per-frame. When adding inline JS, always stamp the nonce; when adding inline styles, prefer a CSS class.

**Backups (RR-010).** `create_backup()` writes a timestamped `.zip` to `BACKUP_DIR` (env `CRANE_BACKUP_DIR`, default `<db dir>/backups`) containing a **consistent** `crane.db` snapshot (via SQLite's `conn.backup()` online API into a temp file — WAL-safe) plus the `uploads/` tree, then `_prune_backups()` trims to `BACKUP_KEEP`. It holds `metadata_lock()` for the DB snapshot. `CRANE_BACKUP_INCLUDE_UPLOADS=0` makes the zip DB-only (for when `uploads/` is on self-snapshotting storage like a TrueNAS/ZFS share). `_backup_scheduler()` is a daemon thread started at import by `start_backup_scheduler()` — it sleeps `min(300, interval)` then backs up every `CRANE_BACKUP_INTERVAL_HOURS`; gated by `CRANE_BACKUP_ENABLED` (both conftests set it to `0`, and monkeypatch `BACKUP_DIR`, so tests never spawn the thread or write into the repo). Routes: `GET /api/backup` (status + list), `POST /api/backup` (backup now), `GET /api/backup/download` (stream a fresh zip), `GET /api/backup/download/<name>` (serve an existing backup file — restricted to the `crane-backup-*.zip` pattern, `send_from_directory` prevents traversal). `BACKUP_DIR` is a module global computed from `DB_FILE` at import, so tests that repoint `DB_FILE` must also set `BACKUP_DIR`.

**Settings panel (`settings` module).** The app-bar gear (`#settings-btn`) opens `#settings-modal` — a read-only view: a **Backups** card (status badge, schedule/target from `GET /api/backup`, "Back up now" → `POST /api/backup`, "Download fresh", and a list of existing backups each linking to `/api/backup/download/<name>`) and a **This instance** card (`GET /api/info`: version, crane/file counts, data paths, limits, proxy) plus an export link. Deployment config is *not* editable here — it lives in env/compose (some is read-once, and `CRANE_TRUST_PROXY` is a security control that must not be UI-toggleable).

**Data hygiene & fast retrieval (`FACETS·PALETTE·DEEP LINKS` region).** Three v1.7.0 features share this JS region:
- **Autocomplete.** `GET /api/facets` returns `{makes:[...], types:[...]}` (distinct non-empty values, `COLLATE NOCASE`). `refreshFacets()` (called after every `loadFileList()` and after a merge) fills the `#facet-makes`/`#facet-types` `<datalist>`s (native autocomplete on the upload modal's make/type inputs and the bulk grid's cells) and the merge tool's two `<select>`s.
- **Merge manufacturers.** `POST /api/merge-make` (body `{from, into}`, `WRITE_RATE`-limited, under `metadata_lock()`) moves every crane off a mistyped make onto the correct one. For each source crane it recomputes `new_id = generate_crane_id(into, type, model, capacity)`: if that slug is free it **renames** (os.rename dir + UPDATE cranes id/make + UPDATE files crane_id); if it collides with an existing crane it **absorbs** (move/dedupe each file into the target dir, INSERT files rows, DELETE source rows, rmtree old dir). Returns `{success, moved, absorbed}`; logs a `merge` event. Validates 400 (missing/equal fields), 404 (no source cranes). UI lives in the Settings panel's "Merge manufacturers" card (confirm dialog → toast → `loadFileList()` + `refreshFacets()`).
- **Command palette.** `Ctrl/Cmd+K` (or clicking the search box's kbd hint) opens `#palette-modal`. `palette.run()` filters `state.files` client-side: a capacity-range query (`>=N`, `>N`, `≥N`, or `N+`) shows all cranes ≥N sorted **ascending** by capacity (`parseCapacity()` extracts the leading number); otherwise a fuzzy substring match (`terms.every(t => haystack.includes(t))`) across make/model/type/capacity. Caps 60 results; ArrowUp/Down/Enter/Escape; Enter → `openCrane()`.
- **Deep links.** `openCrane(crane)` selects the make, opens the primary file, flushes the virtual-scroll queue, and highlights the row. `viewer.openFile()` calls `deepLink.set(id)` (sets `location.hash = '#crane/<id>'` with a suppress flag to avoid a feedback loop); `deepLink.resolve()` (run once after the initial `loadFileList()`, plus on `hashchange`) reads the hash and opens the matching crane. A share/bookmark of `…/#crane/<id>` opens that crane on load.

**Versioning & cache-busting.** `APP_VERSION` (env `CRANE_VERSION`, default `dev`) is stamped into the image at build time by `docker-publish.yml` (`build-args: CRANE_VERSION=${{ steps.meta.outputs.version }}`). It shows in the app-bar (`.app-bar__version`) and at `GET /version` (also on `/health`). Templates reference `main.js`/`main.css` via the `versioned_static()` context helper, which appends `?v=<md5[:8]>` of the file's bytes — so a new deploy always serves fresh assets with no hard-refresh. `_ASSET_HASHES` caches per file; only the two app assets are versioned (the vendored pdf.js is stable).

**Errors as JSON.** The global `HTTPException` handler rewrites every 4xx/5xx into `{"error": "..."}`. Bare `except` clauses log via `app.logger.exception()` and return `{"error": "Internal server error"}` — never `str(e)`. The XHR client depends on JSON — do not return HTML error pages.

**Frontend.** [static/main.js](static/main.js) is the extracted ES module. [templates/index.html](templates/index.html) loads it with the CSP nonce. The JS is divided into labelled regions: `STATE`, `API`, `TOAST`, `THEME`, `MODAL`, `METADATA MODAL`, `BULK IMPORT`, `SHORTCUTS`, `SETTINGS`, `FACETS·PALETTE·DEEP LINKS`, `DROPZONE`, `SIDEBAR`, `VIEWER`, `INIT`. Modals use native `<dialog>` (`showModal()` → browser **top layer**, above all normally-positioned content). Consequence (DL-024): anything that must be visible while a dialog is open must live **inside** the dialog — a `toast` fired during a modal action renders behind the dialog's `::backdrop`. The metadata modal shows action errors inline via `#modal-error` (`showError()`), not a toast. CSS breakpoints are CSS custom properties (`--bp-mobile`, `--bp-tablet`) read by JS via `getComputedStyle`.

## Testing constraints

`tests/conftest.py` monkeypatches `UPLOAD_FOLDER` and `DB_FILE` onto `tmp_path` per test, then calls `app_module.init_db()` to create the tables in the test database. Tests never touch the developer's real catalogue. The `csrf` fixture mints a token via `GET /api/pdfs`.

The concurrent-writes test (`test_concurrent_metadata_writes_serialize`) spawns 20 threads calling `metadata_lock()` — if you refactor the lock, this is the guardrail.

`tests/e2e/conftest.py` starts a live Flask server on a free port using `werkzeug.serving.make_server`. The `live_server` fixture is session-scoped (one server per run); `page` is function-scoped (fresh browser per test). E2E tests upload unique files per test and track them by `data-filename` attribute.

## Manual QA

`pytest` doesn't exercise the browser fully. After UI changes, walk [QA-CHECKLIST.md](QA-CHECKLIST.md) — it covers theme toggle, drag-drop, modals, mobile drawer, fullscreen, keyboard shortcuts, and focus restoration on delete.
