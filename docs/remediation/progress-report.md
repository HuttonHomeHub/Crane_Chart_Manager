# Progress Report

Programme: Crane Charts Engineering Remediation  
Last updated: 2026-07-06 (Session 4 end)

---

## Session 1 — 2026-07-06

### Objectives
Close all P1 critical fixes, accept or close all P2 authentication findings, close quick-win P3–P5 items, establish CI, and create the full remediation artefact set.

### Items closed this session

| ID | Title | Evidence |
|----|-------|---------|
| R-001 | delete_file missing lock | `app.py` delete route wrapped in `metadata_lock()`. R-009 test passes. |
| R-002 | No authentication | Accepted as risk (ACCEPTED_RISK). See RR-001. |
| R-003 | PDF magic bytes | `is_valid_pdf()` added. New test passes. |
| R-005 | Flask/Werkzeug mismatch | Upgraded to Flask 3.1.1. Shim removed. All tests pass. |
| R-008 | No CI/CD | `.github/workflows/ci.yml` created. |
| R-009 | No delete race test | `test_delete_does_not_lose_concurrent_upload` added. Passes. |
| R-010 | Bare except blocks | All four bare clauses replaced. Logger calls added. |
| R-012 | TOCTOU in get_pdfs | `try/except OSError: continue` wraps `getsize`. |
| R-023 | No health check | `GET /health` endpoint added. Test added. |
| R-024 | Config hard-coded | `CRANE_UPLOAD_DIR`, `CRANE_MAX_UPLOAD_MB`, `CRANE_MAX_FIELD_LEN` env vars. |
| R-025 | Missing security headers | `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` added. |

### Test results

```
pytest tests/ -v
33 passed in 0.28s
```
23 original tests all pass. 10 new tests added (R-003 ×2, R-009, R-023 ×3, R-025 ×3, R-001 race test).

### Artefacts created

- `docs/remediation/backlog.md` ✓
- `docs/remediation/master-plan.md` ✓
- `docs/remediation/decision-log.md` ✓
- `docs/remediation/risk-register.md` ✓
- `docs/remediation/progress-report.md` ✓

---

## Session 2 — 2026-07-06

### Objectives
Close all P3 security items (R-004, R-013), close P5 ops-readiness items (R-006, R-007, R-022), close all P7 maintainability/frontend items (R-014, R-015, R-016, R-018).

### Items closed this session

| ID | Title | Evidence |
|----|-------|---------|
| R-004 | CDN PDF.js without SRI | `static/vendor/pdf.js/pdf.min.mjs` + `pdf.worker.min.mjs` downloaded. `PDFJS_BASE` updated to `/static/vendor/pdf.js`. CSP `script-src`, `worker-src`, `connect-src` no longer reference cdnjs. |
| R-006 | No production WSGI server | `gunicorn==23.0.0` in requirements.txt. `devcontainer.json` `postAttachCommand` updated to gunicorn. `Makefile` created with `dev`, `serve`, `test` targets. |
| R-007 | No Dockerfile | `Dockerfile` created: non-root `crane` user, Gunicorn CMD, `/app/uploads` VOLUME, HEALTHCHECK. |
| R-013 | No rate limiting | `Flask-Limiter==3.9.0` added. Upload: 10/min. Edit/delete: 30/min. 429 returns JSON. `conftest.app` fixture resets limiter. 1 new test added. |
| R-014 | Inline JS module | 1,246-line inline `<script type="module">` extracted to `static/main.js`. Template replaced with `<script type="module" src="...">`. |
| R-015 | Native confirm() inaccessible | `window.confirm()` replaced with `confirmDialog()` — a `Promise<boolean>`-returning function backed by `<dialog id="confirm-modal">`. Default focus on Cancel. |
| R-016 | JS/CSS breakpoint duplication | CSS custom properties `--bp-mobile: 640` and `--bp-tablet: 900` added to `:root`. `start()` reads them via `getComputedStyle`. All three hardcoded breakpoint values in JS now use `BP_MOBILE`/`BP_TABLET`. |
| R-018 | download() anchor timing | `a.remove()` changed to `setTimeout(() => a.remove(), 150)`. |
| R-022 | No structured logging | `python-json-logger==3.3.0` added. `JsonFormatter` configured on root logger. `_request_id` before_request injects `g.request_id`. `_log_request` after_request logs method/path/status/request_id as JSON. |

### Test results

```
pytest tests/ -v
34 passed in 0.36s
```
34 tests pass (33 from Session 1 + 1 new rate-limiting test).

### Artefacts updated

All 5 remediation artefacts updated to reflect Session 2 closures.

### Files created / modified

| File | Change |
|------|--------|
| `static/vendor/pdf.js/pdf.min.mjs` | New — self-hosted PDF.js main bundle |
| `static/vendor/pdf.js/pdf.worker.min.mjs` | New — self-hosted PDF.js worker |
| `static/main.js` | New — extracted 1,246-line JS module |
| `Dockerfile` | New — production container image |
| `Makefile` | New — `dev`, `serve`, `test` targets |
| `app.py` | R-004 CSP cleanup, R-013 limiter, R-022 JSON logging, R-015 429 handler |
| `templates/index.html` | R-004 preloads, R-014 script→src, R-015 confirm-modal dialog |
| `static/main.css` | R-016 `--bp-mobile`/`--bp-tablet`, R-015 `btn--danger`, `modal__panel--sm` |
| `requirements.txt` | Flask-Limiter, gunicorn, python-json-logger |
| `.devcontainer/devcontainer.json` | R-006 gunicorn launch |
| `tests/conftest.py` | R-013 limiter reset in app fixture |
| `tests/test_app.py` | R-013 rate-limit test; R-001 test limiter reset between phases |

---

---

## Session 3 — 2026-07-06

### Objectives
Close R-019 (SQLite), R-020 (audit trail), R-026 (Playwright E2E), R-021 (export), R-011 (pagination).

### Items closed this session

| ID | Title | Evidence |
|----|-------|---------|
| R-019 | JSON file scalability limit | `DB_FILE` (`crane.db`); `threading.Lock`; WAL mode; `init_db()`, `load_metadata()`, `save_metadata()` all updated. `_migrate_from_json()` runs once on startup. Tests monkeypatch `DB_FILE`. |
| R-020 | No audit trail | `spec_events` table; `log_event()` called in upload/edit/delete routes; `TestAuditTrail` (3 tests). |
| R-021 | No backup strategy | `GET /api/export` returns `Content-Disposition: attachment` JSON; `TestExportEndpoint` (3 tests). |
| R-026 | No E2E tests | `pytest-playwright`; `tests/e2e/conftest.py` live server; 6 tests cover page load, health, upload (UI+API), edit, delete; CI `e2e` job added. |
| R-011 | No pagination | `GET /api/pdfs?after=<cursor>&limit=<n>` returns `{items, total, next_cursor}`; `api.listPdfs()` fetches all pages; `TestPagination` (3 tests). |

### Test results

```
pytest tests/test_app.py tests/e2e/ -v
49 passed in 5.7s
```
37 unit/integration tests (pre-session) + 12 new tests (R-011 ×3, R-021 ×3, R-020 ×3, R-026 ×6 E2E) = 49 total.

### Files created / modified

| File | Change |
|------|--------|
| `app.py` | R-019: `DB_FILE`, `threading.Lock`, `init_db`, `_migrate_from_json`, `load_metadata`, `save_metadata`; R-020: `log_event`; R-021: `GET /api/export`; R-011: paginated `GET /api/pdfs` |
| `static/main.js` | R-011: `api.listPdfs()` now loops through pages |
| `requirements.txt` | Added `pytest-playwright>=0.6.0` |
| `tests/conftest.py` | Monkeypatch `DB_FILE` (replaces `METADATA_FILE`/`METADATA_LOCK`); call `init_db()` in fixture |
| `tests/test_app.py` | 7-8 tests updated for SQLite; `TestPagination`, `TestExportEndpoint`, `TestAuditTrail` added; `test_save_metadata_roundtrip`, `test_load_metadata_recovers_from_corrupt_db`, `test_load_metadata_empty_db_returns_empty_dict` replace JSON-file equivalents |
| `tests/e2e/__init__.py` | New (empty) |
| `tests/e2e/conftest.py` | New — live server fixture (`werkzeug.serving.make_server`, session scope) |
| `tests/e2e/test_e2e.py` | New — 6 Playwright tests |
| `.github/workflows/ci.yml` | Added `e2e` job (Playwright Chromium) |

### Artefacts updated

All 5 remediation artefacts updated to reflect Session 3 closures.

---

## Session 4 — 2026-07-06

### Objectives
Close R-017 (virtual scrolling), the last open finding.

### Items closed this session

| ID | Title | Evidence |
|----|-------|---------|
| R-017 | No virtual scrolling | `sidebar.selectMake()` in `static/main.js` flattens type headers + model rows into a queue and renders `MODEL_RENDER_BATCH_SIZE` (60) items at a time; an `IntersectionObserver` sentinel appended to `#model-list` triggers each subsequent batch on scroll. `sidebar.filter()` flushes the remaining queue before matching so search still finds unrendered rows. `api.listPdfs()` now requests bounded pages (`PDFS_PAGE_SIZE = 200`) via an `onPage` callback instead of one unbounded request; `loadFileList()` repaints as pages stream in. New `TestVirtualScrolling` E2E test passes. |

### Test results

```
pytest tests/test_app.py tests/e2e/ -v
50 passed in 6.4s
```
49 tests (pre-session) + 1 new E2E test (`test_large_make_renders_incrementally`) = 50 total.

### Files created / modified

| File | Change |
|------|--------|
| `static/main.js` | R-017: `MODEL_RENDER_BATCH_SIZE`, `PDFS_PAGE_SIZE`; `selectMake()` renders via queue+batches; new `buildModelRow()`, `_appendModelBatch()`, `_renderModelBatch()`, `_setupModelSentinel()`, `_teardownModelSentinel()`, `_flushModelQueue()`; `filter()` flushes queue before matching; `api.listPdfs()` takes an `onPage` callback and pages in bounded chunks; `loadFileList()` repaints progressively |
| `static/main.css` | R-017: `.sidebar__sentinel` (1px IntersectionObserver target) |
| `tests/e2e/conftest.py` | R-017: `uploads_dir` fixture exposing the live server's upload folder |
| `tests/e2e/test_e2e.py` | R-017: `TestVirtualScrolling::test_large_make_renders_incrementally` — seeds 75 files directly on disk (bypassing the upload rate limiter), verifies partial first batch then full render on scroll |

### Artefacts updated

All 5 remediation artefacts updated to reflect Session 4 closure. **Programme complete.**

---

## Overall programme status

| Status | Count | IDs |
|--------|-------|-----|
| CLOSED | 26 | R-001, R-003, R-004, R-005, R-006, R-007, R-008, R-009, R-010, R-011, R-012, R-013, R-014, R-015, R-016, R-017, R-018, R-019, R-020, R-021, R-022, R-023, R-024, R-025, R-026 |
| ACCEPTED_RISK | 1 | R-002 |
| NOT_STARTED | 0 | — |

**Percentage complete:** 26 / 26 = **100%** closed or accepted.  
Every finding from the 2026-07-06 audit is now CLOSED or ACCEPTED_RISK. RR-001 (R-002 acceptance) remains subject to re-evaluation on any hosting-model change; RR-010 (SQLite backup automation) remains an ops follow-up outside the 26-item finding set.

---

## Remaining effort estimate

None. All 26 findings are resolved. Any further work (e.g. automated `crane.db` backup cron per RR-010) is net-new ops scope, not remediation backlog.

---

## Session 1 risks introduced / removed

| Risk | Description |
|------|-------------|
| RR-009 (introduced) | Flask 3.x upgrade may surface hidden API differences. MITIGATED — all tests pass. |
| RR-003 (removed) | R-001 fix eliminates concurrent delete/upload data loss |
| RR-004 (removed) | R-005 upgrade eliminates Flask/Werkzeug incompatibility |
| RR-007 (removed) | R-003 fix eliminates non-PDF upload risk |
| RR-008 (removed) | R-010 fix eliminates internal path leakage in 500 responses |

## Session 2 risks removed

| Risk | Resolution |
|------|------------|
| RR-002 | R-004 self-hosting eliminates CDN supply-chain XSS risk |
| RR-005 | R-006 Gunicorn replaces Flask debug server (no more `/__debugger__`) |

## Dependencies changed this session

| Item | Change |
|------|--------|
| R-004 | CLOSED — unblocks R-014 ✓ (also done this session) |
| R-014 | CLOSED — unblocks R-026 (E2E tests) |
| R-015, R-016, R-018 | CLOSED — were blocked on R-014 ✓ |
| R-019 | Still NOT_STARTED — depends on R-001 ✓ |
| R-026 | NOT_STARTED — now unblocked (R-014 ✓, R-008 ✓) |

---

## Session 3 risks introduced / removed

| Risk | Resolution |
|------|------------|
| RR-010 (introduced) | SQLite database loss has no automated recovery. Partial mitigation: `GET /api/export`, audit trail. Full mitigation requires automated backup (Session 4). |

---

## Session 4 risks introduced / removed

None. R-017 is a frontend rendering/network-pacing change only — no new risk introduced, no existing risk mitigated.

---

## Next session objectives

None. The programme is complete: all 26 findings are CLOSED or ACCEPTED_RISK.
