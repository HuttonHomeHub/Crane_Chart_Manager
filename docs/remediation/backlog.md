# Remediation Backlog

Source: Engineering Audit — Crane Charts — 2026-07-06  
Programme owner: Engineering  
Last updated: 2026-07-06 (Session 3)

---

## Status legend

| Code | Meaning |
|------|---------|
| NOT_STARTED | No work begun |
| IN_ANALYSIS | Being assessed or planned |
| BLOCKED | Cannot proceed — dependency unresolved |
| IN_PROGRESS | Implementation underway |
| IMPLEMENTED | Code written, awaiting test run |
| VALIDATED | Tests pass, criteria met |
| CLOSED | Fully done; artefacts updated |
| ACCEPTED_RISK | Intentionally deferred with documented rationale |
| SUPERSEDED | Made obsolete by another finding's resolution |

---

## Priority tiers (per programme rules)

| Tier | Scope |
|------|-------|
| P1 | Critical data-loss defects |
| P2 | Authentication and access control |
| P3 | Security vulnerabilities |
| P4 | Dependency compatibility |
| P5 | Deployment and operational readiness |
| P6 | Testing coverage |
| P7 | Maintainability |
| P8 | Scalability enhancements |

---

## R-001 — delete_file missing metadata_lock()

| Field | Value |
|-------|-------|
| **ID** | R-001 |
| **Source** | BE-1 / Top-25 rank 1 |
| **Priority** | P1 |
| **Severity** | CRITICAL |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
`delete_file()` reads and writes `metadata.json` without acquiring `metadata_lock()`. Upload and edit both hold the lock, so a concurrent DELETE + POST/PUT causes a lost-update race that silently drops newly uploaded metadata entries.

**Impact:** Data loss under concurrent use. Metadata for a newly uploaded file can be permanently erased by a racing delete.

**Dependencies:** None — self-contained change in `app.py:365-386`.

**Risk if deferred:** HIGH — any production concurrent usage will eventually trigger this.

**Implementation:** Wrap the `os.remove` + load/mutate/save sequence in `with metadata_lock():`. Move the 404 check inside the lock so the whole operation is atomic.

**Validation method:** `pytest tests/` must pass. New test `test_delete_does_not_lose_concurrent_upload` added in R-009 validates the fix under contention.

**Completion criteria:**
- `delete_file` uses `metadata_lock()` ✓
- `pytest tests/ -v` passes ✓
- CLAUDE.md updated if needed ✓
- R-009 test added (tracked separately) ✓

**Resolution:** Lock added in Session 1. See decision-log DL-001.

---

## R-002 — No authentication or authorisation

| Field | Value |
|-------|-------|
| **ID** | R-002 |
| **Source** | BE-2 / SEC-1 / Top-25 rank 2 |
| **Priority** | P2 |
| **Severity** | HIGH |
| **Status** | ACCEPTED_RISK |
| **Assignee** | — |

**Finding:**  
All five routes (list, upload, edit, delete, download) are unauthenticated. Any client that can reach port 5000 can wipe the entire catalogue.

**Impact:** Full unauthorised read/write/delete access to all crane specification documents.

**Dependencies:** None upstream. Downstream: R-013 (rate limiting) provides partial mitigation.

**Risk if deferred:** HIGH if internet-exposed. LOW on localhost-only Codespaces deployment.

**Accepted risk rationale:**  
The Codespaces devcontainer binds to localhost and forwards only to authenticated Codespaces sessions. Network-level isolation provides access control for the current deployment model. A production deployment would require revisiting this. Recorded in risk-register as RR-001.

**Validation method:** Verify `devcontainer.json` port forwarding is not set to `public`.

**Completion criteria:** N/A — accepted. Re-evaluate if deployment model changes.

---

## R-003 — PDF magic bytes not validated

| Field | Value |
|-------|-------|
| **ID** | R-003 |
| **Source** | BE-3 / Top-25 rank 3 |
| **Priority** | P3 |
| **Severity** | HIGH |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
`allowed_file()` checks only the filename extension (`.pdf`). A file named `malware.pdf` containing arbitrary bytes is accepted and stored.

**Impact:** Non-PDF content stored and served under `Content-Type: application/pdf`; confuses PDF.js renderer; potential for browser-side exploitation via malformed PDF.

**Dependencies:** None.

**Risk if deferred:** MEDIUM — exploitable only by authenticated users (see R-002 risk acceptance).

**Implementation:** Add `is_valid_pdf(file_storage)` that reads the first 5 bytes (`%PDF-`), rewinds the stream, and returns bool. Call before `file.save()` in `upload_file()`.

**Validation method:** New test uploads a non-PDF with `.pdf` extension and expects 400. `pytest tests/ -v` passes.

**Completion criteria:**
- `is_valid_pdf()` helper exists ✓
- Called in `upload_file()` after `allowed_file()` ✓
- Test for non-PDF-magic-bytes with .pdf extension ✓
- `pytest tests/ -v` passes ✓

---

## R-004 — CDN-loaded PDF.js without Subresource Integrity

| Field | Value |
|-------|-------|
| **ID** | R-004 |
| **Source** | FE-1 / Top-25 rank 4 |
| **Priority** | P3 |
| **Severity** | HIGH |
| **Status** | CLOSED |
| **Assignee** | Session 2 |

**Finding:**  
PDF.js is loaded via `await import()` from `cdnjs.cloudflare.com`. Neither the `<link rel="modulepreload">` nor the dynamic `import()` carry an `integrity` attribute. A CDN compromise can inject arbitrary JavaScript.

**Impact:** Supply-chain XSS. Arbitrary code execution in the user's browser with full same-origin access.

**Dependencies:** Fixing this properly means self-hosting PDF.js (see also FE-2 JS extraction). The `import()` API cannot carry SRI. Self-hosting is the only complete fix.

**Risk if deferred:** MEDIUM — cdnjs is high-trust but the attack is realistic at scale.

**Completion criteria:**
- `static/vendor/pdf.js/` directory contains `pdf.min.mjs` and `pdf.worker.min.mjs`
- `PDFJS_BASE` in JS updated to `/static/vendor/pdf.js`
- `<link>` preloads updated to `/static/vendor/…`
- CSP `script-src` and `worker-src` no longer list `https://cdnjs.cloudflare.com`
- `connect-src` updated accordingly
- PDF rendering works in browser (manual QA step)

---

## R-005 — Flask 2.3.2 / Werkzeug 3.x version mismatch

| Field | Value |
|-------|-------|
| **ID** | R-005 |
| **Source** | BE-4 / Top-25 rank 6 |
| **Priority** | P4 |
| **Severity** | HIGH |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
`requirements.txt` pins `Flask==2.3.2` with a loose `pytest>=8.0`. `pip` resolves Werkzeug 3.x which removed `werkzeug.__version__`, causing a shim in `tests/conftest.py`. Possible hidden production incompatibilities.

**Impact:** Test infrastructure requires a monkey-patch shim. Unknown production incompatibilities may lurk.

**Dependencies:** R-008 (CI/CD) should verify this runs clean after upgrade.

**Risk if deferred:** MEDIUM — shim works around the symptom but masks deeper compatibility issues.

**Implementation:** Upgrade to Flask 3.1.1 + Werkzeug 3.1.3 (compatible pair). Remove the shim from conftest.py. Verify all 23 tests pass.

**Validation method:** `pip install -r requirements.txt && pytest tests/ -v` passes with no shim.

**Completion criteria:**
- `requirements.txt` updated to Flask 3.x ✓
- Werkzeug shim removed from `tests/conftest.py` ✓
- All 23 (+ new) tests pass ✓

---

## R-006 — No production WSGI server

| Field | Value |
|-------|-------|
| **ID** | R-006 |
| **Source** | DO-1 / Top-25 rank 7 |
| **Priority** | P5 |
| **Severity** | HIGH |
| **Status** | CLOSED |
| **Assignee** | Session 2 |

**Finding:**  
`.devcontainer/devcontainer.json` runs `flask --debug run` as the postAttachCommand. Debug mode exposes an interactive debugger. The dev server is single-threaded.

**Impact:** Debug mode active in the running environment. Single-threaded — one slow upload blocks all other users.

**Dependencies:** R-007 (Dockerfile) — WSGI config ships in the container. Can be done independently for devcontainer.

**Completion criteria:**
- `gunicorn` added to `requirements.txt`
- Devcontainer uses non-debug launch (`flask run` without `--debug` or gunicorn)
- A separate `Makefile` or script provides the dev-mode launch

---

## R-007 — No Dockerfile

| Field | Value |
|-------|-------|
| **ID** | R-007 |
| **Source** | DO-2 / Top-25 rank 7 |
| **Priority** | P5 |
| **Severity** | HIGH |
| **Status** | CLOSED |
| **Assignee** | Session 2 |

**Finding:**  
No `Dockerfile`. Application can only run in the Codespaces devcontainer.

**Impact:** Cannot deploy to any cloud provider, VPS, or colleague's machine without manual environment setup.

**Dependencies:** R-006 (WSGI), R-024 (env var config — needed to configure UPLOAD_FOLDER outside the container).

**Completion criteria:**
- `Dockerfile` exists, builds successfully
- Container starts, `/health` returns 200
- `uploads/` is a VOLUME mount
- Container does not run as root

---

## R-008 — No CI/CD pipeline

| Field | Value |
|-------|-------|
| **ID** | R-008 |
| **Source** | DO-3 / Top-25 rank 5 |
| **Priority** | P5 |
| **Severity** | HIGH |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
No GitHub Actions (or other CI) workflows. No automated test execution on push or pull request.

**Impact:** Bugs can be merged to main without detection. No safety net for the refactoring work in this programme.

**Dependencies:** None upstream.

**Completion criteria:**
- `.github/workflows/ci.yml` exists ✓
- Runs `pytest tests/ -v` on push and pull_request to main ✓
- Workflow passes on current codebase ✓

---

## R-009 — No test for delete-vs-upload race condition

| Field | Value |
|-------|-------|
| **ID** | R-009 |
| **Source** | TS-1 / Top-25 rank 10 |
| **Priority** | P6 |
| **Severity** | HIGH |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
The concurrent writes test only exercises `metadata_lock()` via upload threads. No test verifies that `delete_file()` (after the R-001 fix) serialises correctly against concurrent uploads.

**Impact:** Without this test, regression of R-001 would not be caught by the suite.

**Dependencies:** R-001 must be fixed first (lock must exist before the test can verify it).

**Completion criteria:**
- `test_delete_does_not_lose_concurrent_upload` exists in `tests/test_app.py` ✓
- Test fails on the pre-R-001 code, passes after ✓
- `pytest tests/ -v` passes ✓

---

## R-010 — Bare `except Exception` swallows stack traces and leaks internals

| Field | Value |
|-------|-------|
| **ID** | R-010 |
| **Source** | BE-5 / Top-25 rank 8 |
| **Priority** | P7 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
Four route handlers end with `except Exception as e: return jsonify({'error': str(e)}), 500`. `str(e)` can expose file paths and OS details. No `logger.exception()` call means the traceback is swallowed.

**Impact:** Silent errors in production. Potential leakage of internal paths in 500 responses.

**Dependencies:** None.

**Completion criteria:**
- All four bare `except` clauses replaced with `app.logger.exception(…)` + sanitised message ✓
- `pytest tests/ -v` passes ✓

---

## R-011 — No pagination on GET /api/pdfs

| Field | Value |
|-------|-------|
| **ID** | R-011 |
| **Source** | BE-6 / Top-25 rank 19 |
| **Priority** | P8 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 3 |

**Finding:**  
`/api/pdfs` returns all records in a single response. For large catalogues (~1 000+ entries) this becomes a large payload and triggers a full DOM rebuild on every mutation.

**Impact:** Slow initial load and degraded UX for large catalogues.

**Dependencies:** R-019 (SQLite migration) — pagination on a JSON file is harder to implement correctly. Defer until after DB migration.

**Completion criteria:**
- `GET /api/pdfs?after=<filename>&limit=<n>` supported ✓
- Sidebar fetches pages incrementally (`api.listPdfs()` loop in `static/main.js`) ✓
- Tests cover paginated responses (`TestPagination` — 3 tests) ✓

**Resolution:** Implemented in Session 3. Response shape changed to `{items, total, next_cursor}`. `next_cursor` is the last item of the current page. `api.listPdfs()` in `static/main.js` fetches all pages in a loop for current full-list callers. Unblocks R-017.

---

## R-012 — TOCTOU race in get_pdfs between listdir and getsize

| Field | Value |
|-------|-------|
| **ID** | R-012 |
| **Source** | BE-7 / Top-25 rank 11 |
| **Priority** | P7 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
`os.path.getsize(filepath)` is called after `os.listdir()`. If a concurrent DELETE removes the file between the listing and the stat call, `get_pdfs()` raises `FileNotFoundError` caught by the bare `except Exception`, returning HTTP 500 for the whole list.

**Impact:** Any DELETE during a list load causes a 500, breaking the sidebar refresh.

**Dependencies:** None.

**Completion criteria:**
- `try/except OSError: continue` wraps the `getsize` call ✓
- `pytest tests/ -v` passes ✓

---

## R-013 — No rate limiting on mutating routes

| Field | Value |
|-------|-------|
| **ID** | R-013 |
| **Source** | BE-8 / Top-25 rank 9 |
| **Priority** | P3 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 2 |

**Finding:**  
Upload, edit, and delete endpoints accept unlimited requests. Disk exhaustion or metadata lock starvation via automated clients.

**Impact:** DoS via disk fill or lock starvation.

**Dependencies:** R-002 (auth) accepted as risk; rate limiting provides partial mitigation.

**Completion criteria:**
- `Flask-Limiter` added to `requirements.txt`
- Upload limited to 10/minute per IP
- Edit/delete limited to 30/minute per IP
- Graceful 429 response with `{"error": "…"}`
- Tests verify 429 is returned after limit

---

## R-014 — 1 250-line inline ES module blocks frontend tooling

| Field | Value |
|-------|-------|
| **ID** | R-014 |
| **Source** | FE-2 / Top-25 rank 17 |
| **Priority** | P7 |
| **Severity** | HIGH |
| **Status** | CLOSED |
| **Assignee** | Session 2 |

**Finding:**  
All frontend logic lives in an inline `<script type="module">` in `index.html`. No linting, no type-checking, no independent testing is possible.

**Impact:** High maintenance risk. A syntax error kills the entire app. No tooling feedback loop.

**Dependencies:** R-004 (PDF.js self-hosting) — if PDF.js is self-hosted first, the `import()` path changes; do R-004 before R-014 to avoid double-editing the JS.

**Completion criteria:**
- `static/main.js` contains all application logic
- `index.html` has `<script type="module" src="…" nonce="{{ csp_nonce }}">` only
- `{{ csp_nonce }}` and `{{ is_mac }}` passed via `data-*` attributes on `<html>` or a config element
- PDF rendering works in browser ✓ (manual QA)
- `pytest tests/ -v` still passes ✓

---

## R-015 — Native confirm() for delete is inaccessible

| Field | Value |
|-------|-------|
| **ID** | R-015 |
| **Source** | FE-3 / Top-25 rank 14 |
| **Priority** | P7 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 2 |

**Finding:**  
`window.confirm()` blocks the UI thread, cannot be styled, and is inaccessible to some screen reader + browser combinations. Disabled in cross-origin iframes.

**Impact:** Accessibility regression for screen reader users. Cannot be customised.

**Dependencies:** None. Deferred behind R-014 (JS extraction) so it is implemented in the clean extracted file.

**Completion criteria:**
- `<dialog id="confirm-modal">` added to `index.html`
- `confirm(label)` returns a `Promise<boolean>`
- Uses existing `modal.open()` / `modal.close()` infrastructure
- Keyboard accessible: Enter confirms, Esc cancels
- QA checklist item updated

---

## R-016 — JS breakpoints hardcoded separately from CSS breakpoints

| Field | Value |
|-------|-------|
| **ID** | R-016 |
| **Source** | FE-4 / Top-25 rank 22 |
| **Priority** | P7 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 2 |

**Finding:**  
Pixel breakpoints `900` and `640` appear both in CSS `@media` rules and in JS `window.matchMedia()` calls. Changing the CSS breakpoint does not update the JS.

**Impact:** Silent UX regression if CSS breakpoints are changed without matching JS update.

**Dependencies:** Deferred behind R-014 (JS extraction) — CSS variable approach requires editing both files cleanly.

**Completion criteria:**
- `:root { --bp-tablet: 900; --bp-mobile: 640; }` in `main.css`
- JS reads these via `getComputedStyle(document.documentElement).getPropertyValue(…)`
- No hardcoded pixel values in JS

---

## R-017 — No virtual scrolling — sidebar renders all items eagerly

| Field | Value |
|-------|-------|
| **ID** | R-017 |
| **Source** | FE-5 / Top-25 rank 23 |
| **Priority** | P8 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 4 |

**Finding:**  
Every DOM rebuild generates one element per document. For 500+ documents, rebuilds are slow and cause layout thrashing.

**Impact:** Degraded performance on large catalogues.

**Dependencies:** R-011 (pagination) is the backend prerequisite. R-014 (JS extraction) is the frontend prerequisite.

**Completion criteria:**
- Model list renders incrementally (intersection observer or windowed list)
- Initial render of 500 items takes < 100 ms

**Resolution:** `sidebar.selectMake()` now flattens type headers + model rows into a queue and renders only `MODEL_RENDER_BATCH_SIZE` (60) at a time; a trailing `.sidebar__sentinel` element observed by an `IntersectionObserver` (root: `#model-list`, `rootMargin: 200px`) appends the next batch as the user scrolls. `sidebar.filter()` flushes the remaining queue synchronously before matching, so search still finds rows that haven't been rendered yet. `api.listPdfs()` now requests bounded pages (`PDFS_PAGE_SIZE = 200`) instead of one unbounded request, and `loadFileList()` repaints as each page arrives when more than one page exists. New E2E test `TestVirtualScrolling::test_large_make_renders_incrementally` seeds 75 files directly into the uploads folder (bypassing the upload rate limiter) and verifies a partial first batch renders, then the rest appears on scroll.

---

## R-018 — download() anchor element removed synchronously

| Field | Value |
|-------|-------|
| **ID** | R-018 |
| **Source** | FE-6 / Top-25 rank 25 |
| **Priority** | P8 |
| **Severity** | LOW |
| **Status** | CLOSED |
| **Assignee** | Session 2 |

**Finding:**  
`a.click(); a.remove()` — the anchor is removed on the same tick. Safari has historically failed to honour such downloads.

**Impact:** Download may silently fail in Safari.

**Dependencies:** None. Deferred behind R-014.

**Completion criteria:**
- `setTimeout(() => a.remove(), 150)` used instead
- Manual QA confirms download works in Safari/Chrome/Firefox

---

## R-019 — JSON flat file unsuitable beyond ~2 000 entries

| Field | Value |
|-------|-------|
| **ID** | R-019 |
| **Source** | DB-1 / Top-25 rank 18 |
| **Priority** | P8 |
| **Severity** | HIGH |
| **Status** | CLOSED |
| **Assignee** | Session 3 |

**Finding:**  
Every operation reads and rewrites the full JSON file. O(N) on every API call. No indexing.

**Impact:** Degraded performance beyond ~2 000 files. Linear scan on every load.

**Dependencies:** R-001 must be closed before migration (lock semantics must be correct before switching storage). R-020 (audit trail) can be implemented in the same SQLite migration. R-011 (pagination) becomes much simpler with SQL.

**Completion criteria:**
- SQLite database replaces `metadata.json` ✓ (`crane.db`, env var `CRANE_DB`)
- `fcntl.flock` replaced by `threading.Lock` + SQLite WAL mode ✓
- All existing tests pass against new storage ✓ (49 pass)
- Existing `metadata.json` data migrated to SQLite on startup if present ✓ (`_migrate_from_json()`)
- `metadata.json.lock` no longer created ✓

**Resolution:** Implemented in Session 3. `DB_FILE` env var replaces `METADATA_FILE`/`METADATA_LOCK`. `threading.Lock` replaces `fcntl.flock`. `init_db()` creates `specs` and `spec_events` tables (WAL mode). `save_metadata()` uses DELETE+INSERT transaction. `load_metadata()` returns same dict interface. Tests updated to monkeypatch `DB_FILE` and call `init_db()` in fixture. See DL-014, DL-015.

---

## R-020 — No audit trail

| Field | Value |
|-------|-------|
| **ID** | R-020 |
| **Source** | DB-2 / Top-25 rank 24 |
| **Priority** | P8 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 3 |

**Finding:**  
Deletes and edits are permanent with no record of what changed.

**Impact:** No recovery path for accidental deletes or edits.

**Dependencies:** R-019 (SQLite) — implement audit table as part of the migration.

**Completion criteria:**
- `spec_events` table in SQLite records upload/edit/delete events ✓
- Each event stores a JSON snapshot of old/new record ✓ (`snapshot_before`, `snapshot_after`)
- `GET /api/events` — deferred; admin endpoint is lower priority than the table itself

**Resolution:** Implemented in Session 3 as part of the R-019 SQLite migration. `spec_events` table created by `init_db()`. `log_event(event_type, filename, before, after)` writes immutably to the table. Called from all three mutating routes. 3 new tests in `TestAuditTrail`.

---

## R-021 — No backup strategy

| Field | Value |
|-------|-------|
| **ID** | R-021 |
| **Source** | DB-3 / Top-25 rank 23 |
| **Priority** | P8 |
| **Severity** | LOW |
| **Status** | CLOSED |
| **Assignee** | Session 3 |

**Finding:**  
No periodic backup of `metadata.json` or `uploads/`. Corruption loses all metadata permanently.

**Impact:** Data loss on file corruption with no recovery.

**Dependencies:** R-019 (SQLite) — SQLite `.backup()` API is simpler to automate than JSON file rotation.

**Completion criteria:**
- `GET /api/export` returns full metadata as JSON (operator backup path) ✓
- Cron/script backup — deferred (out of scope for this programme phase)
- Documentation — see README and QA-CHECKLIST.md

**Resolution:** Implemented in Session 3. `GET /api/export` returns `Content-Disposition: attachment; filename="crane_export.json"` with all metadata as a JSON download. 3 tests in `TestExportEndpoint`. The full automated backup cron is a Phase 6 ops task.

---

## R-022 — No structured logging

| Field | Value |
|-------|-------|
| **ID** | R-022 |
| **Source** | DO-4 / Top-25 rank 15 |
| **Priority** | P5 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 2 |

**Finding:**  
Flask's default logger emits unstructured plaintext to stderr. No request-ID, no structured fields, no log aggregation path.

**Impact:** Difficult to diagnose issues in production. No audit trail from logs.

**Dependencies:** R-010 (bare except fixed) must be done first so the new logger is used correctly throughout.

**Completion criteria:**
- `python-json-logger` (or `structlog`) added to `requirements.txt`
- All log calls emit JSON to stderr
- Request ID injected into each log line via `before_request`

---

## R-023 — No health check endpoint

| Field | Value |
|-------|-------|
| **ID** | R-023 |
| **Source** | DO-5 / Top-25 rank 13 |
| **Priority** | P5 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
No `/health` or `/ping` endpoint. Load balancers, uptime monitors, and container orchestrators have no liveness probe.

**Impact:** Deployment automation and monitoring cannot verify the app is alive.

**Dependencies:** None.

**Completion criteria:**
- `GET /health` returns `200 {"status": "ok", "uploads": <int>}` ✓
- CSRF guard exempts GET (already does by design) ✓
- Test covers the endpoint ✓

---

## R-024 — Configuration hard-coded as Python constants

| Field | Value |
|-------|-------|
| **ID** | R-024 |
| **Source** | DO-6 / Top-25 rank 14 |
| **Priority** | P5 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
`UPLOAD_FOLDER`, `MAX_CONTENT_LENGTH`, `MAX_FIELD_LEN` are hard-coded Python constants. Changing them requires a code edit.

**Impact:** Cannot configure the application for different environments without code changes.

**Dependencies:** None.

**Completion criteria:**
- Constants read from environment variables with fallbacks ✓
- `requirements.txt` unchanged (os.environ needs no extra dependency) ✓
- `pytest tests/ -v` passes (monkeypatching still works) ✓

---

## R-025 — Missing secondary security headers

| Field | Value |
|-------|-------|
| **ID** | R-025 |
| **Source** | SEC-6 / Top-25 rank 12 |
| **Priority** | P3 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 1 |

**Finding:**  
`X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` headers are absent. The CSP covers the biggest risk but defence-in-depth headers are missing.

**Impact:** MIME-type sniffing possible in older browsers. Referrer leakage on outbound navigations.

**Dependencies:** None.

**Completion criteria:**
- `X-Content-Type-Options: nosniff` ✓
- `Referrer-Policy: strict-origin-when-cross-origin` ✓
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` ✓
- Test asserts all three headers on GET / ✓

---

## R-026 — No E2E browser test suite

| Field | Value |
|-------|-------|
| **ID** | R-026 |
| **Source** | TS-2 / Top-25 rank 21 |
| **Priority** | P6 |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 3 |

**Finding:**  
All browser-facing behaviour is manually tested via QA-CHECKLIST.md. No Playwright or Cypress suite.

**Impact:** UI regressions are only caught by a 5-minute manual QA pass.

**Dependencies:** R-014 (JS extraction) should be complete first so E2E tests exercise stable file structure. R-008 (CI) must be in place to run E2E in automation.

**Completion criteria:**
- `pytest-playwright` added to `requirements.txt` ✓
- Suite covers: page load, health check, upload (UI + API), sidebar render, edit, delete ✓ (6 tests in `tests/e2e/`)
- Runs in CI via separate `e2e` job in `.github/workflows/ci.yml` ✓
- Playwright Chromium browser installed via `python -m playwright install` ✓

**Resolution:** Implemented in Session 3. `tests/e2e/conftest.py` starts a live Flask server via `werkzeug.serving.make_server` on a free port. Session-scoped `live_server` fixture; function-scoped `page`. `CRANE_DB` and `UPLOAD_FOLDER` redirected to `tmp_path` for isolation. All 6 tests pass.

---

## R-027 — Reverse-proxy headers not trusted; rate-limiter storage not shared across workers

| Field | Value |
|-------|-------|
| **ID** | R-027 |
| **Source** | Raised 2026-07-06 — user moving deployment from Codespaces to self-hosted Docker + nginx |
| **Priority** | P3 (security-adjacent — affects CSRF cookie security and rate-limit correctness) |
| **Severity** | MEDIUM |
| **Status** | CLOSED |
| **Assignee** | Session 4 (post-programme) |

**Finding:**  
The app reads `request.is_secure` and `request.remote_addr` directly from the raw WSGI environ, with no `ProxyFix` middleware. Behind a TLS-terminating reverse proxy (nginx), this means: (1) the CSRF cookie never receives the `Secure` flag, since Flask can't see that the original connection was HTTPS; (2) `Flask-Limiter`'s `get_remote_address()` keys every request off nginx's own IP instead of the real client's. Separately, the Dockerfile's original 2-worker Gunicorn config combined with `Flask-Limiter`'s `storage_uri="memory://"` (per-process counters) meant configured rate limits were effectively doubled.

**Impact:** CSRF cookie transmitted without `Secure` over what the browser sees as an HTTPS connection; rate limiting either mis-keyed (all real clients sharing nginx's bucket) or, via the worker split-brain, roughly twice as permissive as configured.

**Dependencies:** None upstream. Raised only because of a deployment-model change (Codespaces → self-hosted Docker + nginx) — not applicable while running inside Codespaces.

**Completion criteria:**
- `app.wsgi_app` wrapped in `ProxyFix`, gated behind an explicit `CRANE_TRUST_PROXY=1` env var (never trust forwarded headers by default) ✓
- Dockerfile Gunicorn worker count reduced to 1 to eliminate the rate-limiter split-brain without adding a new storage dependency ✓
- Regression test for the fail-safe default (`CRANE_TRUST_PROXY` unset ⇒ forwarded headers ignored) ✓
- Opt-in path (`CRANE_TRUST_PROXY=1` ⇒ headers trusted) verified manually ✓

**Resolution:** See DL-020 and RR-011. `CRANE_TRUST_PROXY=1` must be set in the environment whenever the app runs behind nginx or any reverse proxy.

---
