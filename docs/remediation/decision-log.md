# Decision Log

Crane Charts — living record of significant design decisions.  
Last updated: 2026-07-08 (v1.7.0)

`DL-001`–`DL-020` cover the 2026-07-06 engineering remediation (see [README.md](README.md));
`DL-021` onward cover the post-1.0 features (multi-file cranes, in-PDF find, bulk import,
cache-busting). Each entry records a decision, its reasoning, and consequences.

---

## DL-001 — Wrap entire delete_file body in metadata_lock()

**Date:** 2026-07-06  
**Finding:** R-001  
**Decision:** Move the 404 existence check inside `metadata_lock()` and wrap the full `os.remove` + load/save sequence.

**Rationale:** If the check and the remove are not atomic with respect to the lock, a second request could pass the 404 check after the first has already removed the file, producing a spurious 500 instead of a clean 404. Keeping the existence check outside the lock was the original bug pattern — the fix must be holistic.

**Consequences:** Slightly longer lock hold time during delete (still negligible). R-009 test added to guard against regression.

---

## DL-002 — Accept R-002 (no auth) as risk for current deployment model

**Date:** 2026-07-06  
**Finding:** R-002  
**Decision:** Mark as ACCEPTED_RISK. Do not implement authentication in Session 1.

**Rationale:** The application runs exclusively within GitHub Codespaces. Port 5000 is forwarded only to authenticated Codespaces sessions via HTTPS tunnelling. The Codespaces access model provides network-level authentication. Adding application-level auth now would add complexity without commensurate risk reduction for the current deployment. The risk must be re-evaluated if the application is ever exposed on a public URL or a VPS.

**Re-evaluation trigger:** Any change to `devcontainer.json` port visibility, or any deployment outside Codespaces.

**Risk register entry:** RR-001.

---

## DL-003 — Upgrade Flask to 3.x to eliminate Werkzeug shim

**Date:** 2026-07-06  
**Finding:** R-005  
**Decision:** Upgrade to Flask==3.1.1, remove `werkzeug.__version__` shim from `tests/conftest.py`.

**Rationale:** Flask 3.x maintains the same API surface used by this application (routes, blueprints, `jsonify`, `g`, `request`, `send_from_directory`, `before_request`/`after_request` hooks). The shim in conftest masked the mismatch. Upgrading removes the patching code and gives the test suite a faithful picture of the running application.

**Consequences:** `requirements.txt` changes. `tests/conftest.py` loses 4 lines. All 23 existing tests must pass after upgrade.

---

## DL-004 — Implement env var config before Dockerfile

**Date:** 2026-07-06  
**Finding:** R-024, R-007  
**Decision:** Complete R-024 (env vars) before R-007 (Dockerfile).

**Rationale:** A Dockerfile that bakes in hardcoded paths is worse than no Dockerfile. R-024 takes 30 minutes and makes R-007 straightforward. Ordering enforced in master-plan Phase 1 → Phase 3.

---

## DL-005 — Self-host PDF.js before extracting JS module

**Date:** 2026-07-06  
**Finding:** R-004, R-014  
**Decision:** Complete R-004 (self-host PDF.js) before R-014 (extract JS to static/main.js).

**Rationale:** The `PDFJS_BASE` URL and the CDN `<link>` preloads are both in `index.html` today. If the JS is extracted to `static/main.js` first, the CDN URL change requires editing two files. Doing R-004 first means a single clean edit in the already-extracted file.

**Consequences:** R-014 is BLOCKED on R-004. Recorded in backlog.

---

## DL-006 — Defer R-011 (pagination) until after R-019 (SQLite)

**Date:** 2026-07-06  
**Finding:** R-011, R-019  
**Decision:** Do not implement pagination on the JSON-file backend. Implement it as part of the SQLite migration.

**Rationale:** Cursor-based pagination on a flat JSON file requires sorting on every read and maintaining a cursor in the file bytes, which adds complexity without the performance benefit (the file must still be read in full). With SQLite, pagination is a trivial `LIMIT/OFFSET` or `WHERE filename > ?` query. Adding it now would create throw-away code.

---

## DL-007 — Defer R-017 (virtual scrolling) until R-011 is done

**Date:** 2026-07-06  
**Finding:** R-017, R-011  
**Decision:** Virtual scrolling is pointless if the API still returns all records. Block R-017 on R-011.

**Rationale:** If the API returns 1 000 records and the frontend renders only 20 at a time, the savings are real. If the API still returns 1 000 records, the virtual scroll only saves DOM rendering cost, not network or JSON-parse cost. The correct fix is the full stack: paginated API → incremental render.

---

## DL-008 — Add delete race test (R-009) immediately after R-001

**Date:** 2026-07-06  
**Finding:** R-009, R-001  
**Decision:** Add `test_delete_does_not_lose_concurrent_upload` in the same session as R-001.

**Rationale:** A fix without a regression test can be silently reverted. The concurrent metadata writes test gave us confidence in the existing lock. The delete fix deserves equivalent coverage immediately.

---

## DL-009 — Use os.environ.get() directly, no python-dotenv dependency

**Date:** 2026-07-06  
**Finding:** R-024  
**Decision:** Use `os.environ.get('CRANE_…', default)` without adding `python-dotenv` or similar.

**Rationale:** The application has zero runtime dependencies beyond Flask. Adding dotenv for env-var loading in a single-file app would add more complexity than value. In Codespaces, variables are set via devcontainer.json `remoteEnv`. In a Dockerfile, they are set via `ENV` or `-e` flags. `os.environ` covers both without extra code.

---

## DL-010 — Remove conftest Werkzeug shim as part of R-005

**Date:** 2026-07-06  
**Finding:** R-005  
**Decision:** The shim removal is a completion criterion for R-005, not a separate finding.

**Rationale:** The shim exists solely because of the Flask/Werkzeug mismatch. Once the mismatch is resolved, the shim is dead code. Tracking it as a separate item would fragment a single coherent change.

---

## DL-011 — Reset Flask-Limiter counter in app fixture to prevent test bleed

**Date:** 2026-07-06  
**Finding:** R-013  
**Decision:** Call `app_module.limiter.reset()` in the `app` conftest fixture. Also reset between phases in tests that make more uploads than the per-minute limit allows.

**Rationale:** Flask-Limiter with `storage_uri="memory://"` holds counters in a module-level dictionary. Since the test suite reuses the same `app_module` object (it monkeypatches attributes rather than creating a new Flask app), limiter counters bleed from one test into the next. The `app` fixture already resets paths/metadata; resetting the limiter is consistent with that pattern and preserves correct isolation.

**Consequences:** The `TestDeleteFileLock.test_delete_does_not_lose_concurrent_upload` test also resets the limiter between its two phases, since it performs 20 total uploads.

---

## DL-012 — Gunicorn with --reload in devcontainer, make dev for debug server

**Date:** 2026-07-06  
**Finding:** R-006  
**Decision:** Replace `flask --debug run` with `gunicorn --workers 1 --bind 0.0.0.0:5000 --reload app:app` in devcontainer `postAttachCommand`. Add `Makefile` with `dev` target (Flask debug) and `serve` target (Gunicorn) for developer convenience.

**Rationale:** The devcontainer launch should match production behaviour. Gunicorn with `--reload` provides hot-reload like the Flask dev server without the Werkzeug debugger exposure. Developers who want the full debug experience can run `make dev`.

---

## DL-013 — Complete R-015, R-016, R-018 as part of R-014 JS extraction

**Date:** 2026-07-06  
**Finding:** R-014, R-015, R-016, R-018  
**Decision:** Implement R-015, R-016, and R-018 in the same `static/main.js` write as R-014, rather than as separate edits.

**Rationale:** All three items (confirm dialog, breakpoint sync, download anchor timing) are changes within the module body. Writing the file once with all changes applied is cleaner than writing it once for R-014 and then editing it three more times. The changes are small and orthogonal — no risk of interaction. Each change is labelled with its finding ID in the source.

---

## DL-014 — threading.Lock replaces fcntl.flock for SQLite migration

**Date:** 2026-07-06  
**Finding:** R-019  
**Decision:** Replace `fcntl.flock` with `threading.Lock` as the application-level concurrency guard. Complement with SQLite WAL mode for storage-level locking.

**Rationale:** `fcntl.flock` is POSIX-only and tied to the JSON file lock path. With SQLite, the database engine handles storage-level concurrency (WAL mode allows concurrent reads during writes). The application-level lock (`threading.Lock`) is still needed to serialise the load-modify-save cycle at the Python level — without it, two concurrent requests could both read stale state and then overwrite each other's writes. `threading.Lock` is cross-platform, requires no file on disk, and is idiomatic Python.

**Consequences:** `fcntl` import removed. `METADATA_LOCK` global removed. `_metadata_lock_obj = threading.Lock()` added. `metadata_lock()` simplified to a context manager that acquires the threading lock. The concurrent-writes test still passes.

---

## DL-015 — save_metadata uses DELETE+INSERT transaction (not targeted SQL)

**Date:** 2026-07-06  
**Finding:** R-019  
**Decision:** Keep `save_metadata(metadata)` taking a full dict and implementing DELETE+INSERT inside a single SQLite transaction. Do not switch to targeted per-row INSERT/UPDATE/DELETE in the routes.

**Rationale:** The existing routes do a full read-modify-write cycle: `metadata = load_metadata(); ... ; save_metadata(metadata)`. Keeping this interface means zero changes to route logic, zero risk of regression, and all existing tests continue to pass without modification. The DELETE+INSERT is atomic from the application's perspective (the transaction either commits fully or rolls back). With <10 000 entries, performance is irrelevant. If performance becomes a concern, routes can be individually upgraded to targeted SQL.

**Consequences:** `save_metadata()` is slightly expensive for large catalogues (rewrites all rows). Acceptable for this programme's scope. R-017 pagination removes the per-request full read anyway.

---

## DL-016 — GET /api/export as the operator backup path for R-021

**Date:** 2026-07-06  
**Finding:** R-021  
**Decision:** Implement `GET /api/export` as the immediate deliverable for R-021, rather than a cron job or SQLite `.backup()` call.

**Rationale:** The R-021 requirement is "no recovery path for accidental data loss." The most urgent element is giving operators a way to manually export all metadata before or after incidents. A browser-triggered JSON download accomplishes this with 15 lines of code. Automated backup cron jobs require cron configuration, storage paths, and retention policies — out of scope for this programme but documented as follow-up ops work.

**Consequences:** R-021 marked CLOSED with the export endpoint as evidence. Automated scheduling is a follow-up ops task for Session 4+.

---

## DL-017 — next_cursor is last item of current page, not first of next

**Date:** 2026-07-06  
**Finding:** R-011  
**Decision:** `next_cursor` in the `GET /api/pdfs` response is the filename of the last item on the current page. The caller sends `?after=<next_cursor>` to get items that come alphabetically after that filename.

**Rationale:** This is the standard cursor pattern: the cursor identifies the last-seen item, not the next-to-be-seen item. The server implements `?after=X` by finding X in the sorted list and returning `list[idx+1:]`. This means the cursor is opaque to the client (it doesn't need to know it's a filename) and the server only needs one comparison. Alternative "first of next page" cursors require a `>=` comparison that can double-return an item on boundaries.

**Consequences:** `next_cursor = page_items[-1]['name'] if len(files) > limit else None`. `api.listPdfs()` in `static/main.js` passes `?after=<cursor>` in each page loop iteration.

---

## DL-018 — E2E tests use session-scoped live server with fresh page per test

**Date:** 2026-07-06  
**Finding:** R-026  
**Decision:** E2E conftest uses `scope='session'` for the live server (one server per test run) and function-scoped `page` (fresh browser context per test). The shared database accumulates uploads across tests.

**Rationale:** Starting a new server per test would add ~300 ms per test and would require resetting the DB between tests. The session-scoped server is fast and avoids Flask's initialisation overhead. Tests are designed to be additive: each uploads uniquely-named files and verifies behaviour on those specific files. The delete test uses `data-filename` attribute matching rather than a count, which is robust to other files being present.

**Consequences:** Tests are not isolated from each other's uploads. Parallelising E2E tests without worker partitioning would require per-worker servers. Accepted for the current single-worker CI setup.

---

## DL-019 — Virtual scrolling batches the render queue, not the network fetch

**Date:** 2026-07-06  
**Finding:** R-017  
**Decision:** Keep `api.listPdfs()` fetching the full catalogue (now via bounded `PDFS_PAGE_SIZE=200` pages rather than one unbounded request) so the make/type grouping and counts in the sidebar stay correct. Implement the actual "virtual scrolling" as batched DOM insertion in `sidebar.selectMake()`, gated by an `IntersectionObserver` watching a sentinel element appended to `#model-list`.

**Rationale:** The backend has no `?make=` filter, so make/type counts and grouping require the full metadata set regardless of how the network fetch is paced. The DOM cost — not the JSON-parse cost — is what scales badly with catalogue size (each `.model-item` row creates ~6 elements plus 3 listeners). Batching the render queue at `MODEL_RENDER_BATCH_SIZE = 60` items and only building rows as the user scrolls near the bottom directly addresses that cost. `api.listPdfs()` streaming pages via an `onPage` callback (used by `loadFileList()` to repaint as data arrives) is a secondary improvement for genuinely large catalogues, but is a no-op for the common case where everything fits in one page.

**Consequences:** `sidebar.filter()` must flush the remaining render queue before matching text against `.model-item` elements, since a text search has to be able to find rows that haven't been scrolled into view yet. `_flushModelQueue()` handles this. Focus-restoration after upload/delete (`renderMakes`'s `_restoreFocus` lookup) can silently no-op if the previously-focused row falls outside the first rendered batch — an accepted tradeoff inherent to virtual scrolling, matching the precedent set by DL-018 for E2E test isolation tradeoffs.

**Consequences (testing):** New E2E test `TestVirtualScrolling::test_large_make_renders_incrementally` writes 75 raw PDF files directly into the live server's upload folder (bypassing the 10/min upload rate limit) with no metadata row, so they land under the 'Unknown' make/'Other' type bucket. It asserts a partial first batch renders, then scrolls `#model-list` to trigger the sentinel and asserts all 75 eventually render.

---

## DL-020 — Trust reverse-proxy headers only when CRANE_TRUST_PROXY=1; gate access at nginx, not in the app

**Date:** 2026-07-06  
**Finding:** R-027 (new, raised by moving off Codespaces onto self-hosted Docker + nginx)  
**Decision:** Two changes, both scoped to the deployment layer rather than the application's security model:
1. Wrap `app.wsgi_app` in Werkzeug's `ProxyFix` (`x_for=1, x_proto=1, x_host=1`), but only when `CRANE_TRUST_PROXY=1` is explicitly set.
2. Drop the Dockerfile's Gunicorn worker count from 2 to 1.
3. Access control for the new deployment (Docker behind the user's own nginx, no longer inside Codespaces) is delegated to nginx — basic auth, mTLS, or an IP allowlist — rather than adding an app-level login. R-002 remains ACCEPTED_RISK; RR-001's conditions are updated to point at the nginx gate instead of Codespaces' network isolation.

**Rationale:** Once the app sits behind nginx, two silent correctness bugs would otherwise ship: (a) `request.is_secure` and `get_remote_address()` read straight from the raw WSGI environ, which reflects nginx's own connection to the app, not the browser's connection to nginx — so the CSRF cookie would never get the `Secure` flag, and rate-limit keys would collapse onto nginx's single IP for every real client; (b) `Flask-Limiter`'s `storage_uri="memory://"` keeps counters in one process's memory, so a second Gunicorn worker silently doubles every configured limit (10/min becomes ~20/min in aggregate). Gating `ProxyFix` behind an explicit env var (rather than trusting forwarded headers unconditionally) matters because *any* client can send `X-Forwarded-Proto`/`X-Forwarded-For` headers directly — trusting them by default in a config where there is no proxy in front would let a client spoof its own scheme/IP. On auth: R-002's original acceptance rationale was "network-level isolation provides access control for the current deployment model" (DL-002) — nginx sitting in front of Docker is a different but equally valid instance of that same pattern (gate at the edge, keep the app simple), so re-litigating into app-level login wasn't necessary — it just needed the gate moved from Codespaces' port-forwarding to nginx.

**Consequences:** `CRANE_TRUST_PROXY=1` must be set whenever the app runs behind nginx (or any reverse proxy) — forgetting it silently reintroduces the `Secure`-flag and rate-limit-keying bugs, but degrades safely (cookie just isn't marked Secure; rate limiting still works, just keyed on the proxy's IP). Running two proxy hops (e.g. nginx behind a CDN) would need `x_for=2` etc. — not handled, since only a single nginx hop is in scope right now. Gunicorn now runs with a single worker; if throughput ever requires more, `storage_uri` must move to a shared backend (e.g. Redis) *before* adding workers back, or the rate-limiter split-brain returns. New regression test `test_forwarded_proto_ignored_without_trust_proxy` guards the fail-safe default; the opt-in path was verified manually (not by an automated test, to avoid reloading the `app` module mid-suite and destabilising shared fixture state) — confirmed the CSRF cookie gets `Secure` when `CRANE_TRUST_PROXY=1` and `X-Forwarded-Proto: https` is sent.

---

## DL-021 — Multi-file per crane: cranes + files tables, slug-keyed directories, primary pointer

**Date:** 2026-07-06
**Finding:** F-001 (new feature — not part of the 26-item audit; supplementary PDFs per crane, with a selectable "main" file)

**Decision:** Break the original 1:1 "a crane IS its PDF" identity (DL-era `specs.filename` PK) into a proper `cranes` (1) → `files` (N) model. The crane slug (`make_type_model_capacity`) stays the identity — now `cranes.id` and the per-crane directory name `uploads/<crane_id>/` — and each file lives inside that directory. "Main file" is a single `cranes.primary_file` pointer (not an `is_primary` flag per file). Deleting a crane's last file deletes the whole crane. UI: sidebar stays one-row-per-crane (with a file-count badge); all file management lives in a viewer "file strip".

**Options considered:**
- **A — JSON `files` column on the spec row.** Rejected: reintroduces exactly the queryability/audit smell that R-019 removed by migrating *off* a JSON blob.
- **B — one flat table + `crane_key`/`is_primary` columns.** Rejected: duplicates crane metadata across every file row (edit touches N rows, drift risk); crane existence becomes implicit.
- **C — two tables (chosen).** Normalised, queryable, audit-friendly; the faithful continuation of the SQLite migration.
- Disk sub-choice **C1 (slug-keyed dirs, chosen)** vs **C2 (surrogate uuid ids, slug display-only).** C1 preserves the codebase's "eyeball `uploads/`" property and keeps metadata-edit at a single directory rename; C2 would have deleted the rename-atomicity machinery entirely but is a bigger break and opaque on disk — overkill for this tool. User approved C1 defaults.
- UI **viewer strip (chosen)** vs **expandable sidebar rows.** The strip keeps the R-017 virtual-scrolling sidebar untouched (its batched render queue would have to grow expand/collapse state otherwise) and puts file management where the document is.

**Rationale:** "Main" is purely a default-open pointer — it doesn't rename files or change the slug — so it maps cleanly onto one nullable FK, which *structurally* guarantees exactly one primary (vs N booleans to keep mutually exclusive). Files were made supplementary (not versions), so no supersession/ordering logic is needed. `list_cranes()`/`get_crane()` replace `load_metadata()`/`save_metadata()`; routes now do targeted SQL rather than whole-table DELETE+INSERT (an improvement over the DL-015 shortcut). `metadata_lock()` still wraps each route's full disk+DB sequence.

**Migration:** `_migrate_from_specs()` runs once on import — each `specs` row → one crane + one primary file, its flat `uploads/<slug>.pdf` moving into `uploads/<slug>/`. Idempotent (skips existing cranes); renames `specs` → `specs_legacy` so it never re-runs and the old rows survive for rollback. Verified against a synthesised v1.0.1-shaped DB (file moved, `specs_legacy` retained, second boot inert).

**Consequences:** `GET /api/pdfs` items are now cranes (each with `files[]`, `url`=primary, `name`=id, `file_count`); the pagination cursor is a crane id. New routes: `POST /api/cranes/<id>/files`, `PUT /api/cranes/<id>/primary`, `DELETE /api/cranes/<id>/files/<file_id>`. Audit gains `file_add`/`primary_change`/`file_remove` event types. Health now counts `files` rows. 21 tests added/updated (56 backend + 9 E2E, all green); two new E2E tests drive the strip (switch, set-primary, delete) in a real browser. Ships as a minor version (new feature, backward-compatible via automatic migration).

---

## DL-022 — Multi-file polish (editable labels, drag-to-add) + in-PDF find

**Date:** 2026-07-07
**Finding:** F-002, F-003 (new features following DL-021's multi-file model)

**Decisions:**
1. **Editable file labels (F-002a).** New `PATCH /api/cranes/<id>/files/<file_id>` updates `files.label`; the strip chip gains a ✎ action that opens the metadata modal in a new `editlabel` mode (label field only). Chose modal reuse over inline-edit for consistency with the existing accessible-dialog pattern (R-015) — no new focus-management surface.
2. **Drag-to-add-to-crane (F-002b).** A PDF dropped while a crane is open now routes to `addfile` mode targeted at that crane, rather than always starting a new crane. The modal names the crane and offers a "Create a new crane instead" link that switches to `upload` carrying the same pending file — so the default is low-friction but never traps the user. Nothing commits until submit, so the "guess" is safe.
3. **In-PDF find (F-003).** Implemented as a self-contained overlay rather than wiring PDF.js's `PDFFindController`/viewer components (which assume the `pdf_viewer` module, not this bespoke canvas renderer). `getTextContent()` per page builds a lazy cache; matches are item-level (a text run/cell containing the query); highlights are `<div>`s positioned in **%** of the page inside a `#pdf-highlights` overlay, computed from the item transform × render viewport. Percentages (not px) keep highlights aligned when `max-width:100%` scales the canvas. Verified visually: highlights land exactly on the matching lines/cells.

**Rationale (find):** The daily task is reading a dense load chart, so "jump to the value" is the high-value viewer feature. Item-level highlighting is a deliberate MVP tradeoff — sub-word highlighting needs per-glyph geometry (a full text layer), but in real charts each cell is its own text item, so item-level already highlights individual cells. A dedicated `state.findToken` guards the async cross-page scan against a file switch mid-scan (mirrors `openToken`/`renderToken`).

**Consequences:** `#pdf-canvas` is now wrapped in `#pdf-stage` (position:relative) alongside `#pdf-highlights`. New E2E: `TestFind` (drives search → 2 matches, next, 0/0 miss, with real extractable text via `_make_text_pdf`) and `TestMultiFileUI::test_rename_file_label`. `Ctrl/Cmd+F` is intercepted only while a document is open. Audit gains a `label_edit` event. 59 backend + 11 E2E tests, all green. Ships as v1.2.0.

---

## DL-023 — Bulk import: filename-convention grouping + configurable rate limits

**Date:** 2026-07-07
**Finding:** F-004 (new feature — seed the catalogue by dropping many PDFs at once)

**Decisions:**
1. **Group by parsed (make, model), one grid row = one crane.** The house convention `Manufacturer Model (Label).pdf` encodes make + model + a per-file label (the parenthetical), and the whole point of the parenthetical is that a crane has several files. So the importer groups files by (make, model) into one crane rather than one-file-one-crane. This is not just ergonomic — one-file-one-crane would generate duplicate crane slugs for a crane's multiple files and 409 on the second, forcing manual cleanup. Grouping sidesteps that entirely.
2. **Annotate-first, client-held (no staging table).** Files stay as browser `File` objects until submit; nothing hits the server until the user fills Type + Capacity (the two fields not in the filename) and clicks Import. Chosen over a server-side "inbox" (upload-first) because the user confirmed this is a one-time seed — an inbox data-model addition wasn't worth it. Tradeoff: closing the tab mid-import loses unsubmitted rows.
3. **Primary selection in the grid.** Single-file crane → its only file is primary automatically. Multi-file crane → a radio per file, defaulting to the first, so the user picks the main chart during import. Implemented by uploading the chosen file *first* (it becomes the crane's primary by construction), then the rest — no separate set-primary call.
4. **Raise + config-drive the rate limits.** Bulk uploads would trip the old 10/min upload cap. Limits are now `app.config['UPLOAD_RATE'|'WRITE_RATE']` (default 60/min, env `CRANE_UPLOAD_RATE`/`CRANE_WRITE_RATE`), read via a callable in the `@limiter.limit` decorators so tests pin them low and the conftest resets them per-test. Safe to raise because the app is behind the tinyauth gate (RR-001). The client also retries 429s with backoff (`withRetry`) as a belt-and-braces measure.

**Consequences:** `POST /api/upload` gained an optional `label` form field (carries the primary file's parenthetical). Multi-file **drop** and multi-select **picker** both route into the importer; a single file still uses the metadata modal, now filename-prefilled. New `bulkImport` module + `#bulk-modal` grid; `parseFilename()` shared with the single-upload prefill. New E2E `TestBulkImport` (3 files → 2 cranes, fill-down, Outrigger chosen as primary, verified server-side). Also fixed a latent v1.2.0 bug found along the way: `Ctrl+F` (find) also triggered the `f` fullscreen shortcut because single-key shortcuts didn't bail on a modifier chord — added `if (mod) return;`. 60 backend + 12 E2E tests, all green. Ships as v1.3.0.

---

## DL-024 — Dialog drop target + inline errors (native <dialog> top-layer gotchas)

**Date:** 2026-07-07
**Finding:** F-005, F-006 (UX bugs reported after v1.3.0)

**Decisions:**
1. **Errors during a modal action show inline, not as a toast.** A native `<dialog>` opened with `showModal()` renders in the browser **top layer**, above all normally-positioned content including the fixed toast stack — so a `toast.danger()` fired while the metadata modal was open appeared *behind* the dialog's `::backdrop` and was invisible. Fix: the submit handler now writes to a `#modal-error` element inside the dialog (`showError()`), cleared on open/mode-switch. Success still uses a toast (the modal closes first, so it's visible on the page). Bulk import already shows per-row errors inline, so it was unaffected.
2. **The modal's file-picker box is a real drop target.** It looks droppable (dashed "Click to choose a PDF" zone) but the window-level dropzone refused drops while a modal was open, so nothing happened. Added `dragover`/`drop` on `#file-field` that `stopPropagation()` (so the window handler doesn't also fire) and route the file(s): single → set + prefill; multiple in upload mode → hand off to the bulk importer. The global dropzone now bails entirely while a modal is open (no overlay, no "close the dialog first" toast — which would itself have been buried behind the backdrop).

**Consequences:** New `#modal-error` element + `.modal__error` style; `#file-field.is-dragover` reuses the picker's drag highlight. Two E2E tests added (`test_duplicate_upload_shows_inline_error`, `test_drop_pdf_on_picker_sets_and_prefills`). Also confirms a general rule for this codebase: **anything that must be visible while a native modal dialog is open has to live inside that dialog**, not rely on z-index. 60 backend + 14 E2E, all green. Ships as v1.3.1.

---

## DL-025 — Static asset cache-busting + version indicator

**Date:** 2026-07-07
**Finding:** F-007 (users had to hard-refresh after every deploy to get new JS/CSS)

**Decisions:**
1. **Content-hash cache-busting, not version-string.** `versioned_static('main.js')` appends `?v=<md5[:8]>` of the file's actual bytes. Chosen over `?v=<APP_VERSION>` because a hash busts iff the file changes — correct even if someone forgets to bump a version — and needs zero maintenance. Only the two app-owned assets (`main.js`, `main.css`) are versioned; the vendored pdf.js is stable and left alone. Hashes are computed once and cached in `_ASSET_HASHES`.
2. **Version flows from the image tag, not a hardcoded constant.** `APP_VERSION = os.environ.get('CRANE_VERSION', 'dev')`; the Dockerfile takes `ARG CRANE_VERSION` and the publish workflow passes `steps.meta.outputs.version` (e.g. `1.3.2` for a tag, `main` for a branch build). So the version indicator always matches the deployed image with no code edit per release. Surfaced in the app-bar, `GET /version`, and `/health`.

**Rationale:** Flask already does ETag revalidation, but "tab left open" and browser heuristic caching still served stale `main.js` after a deploy (the user hit exactly this). A hashed URL is a different resource, so the browser is forced to fetch it — the standard, reliable fix. Query-string busting doesn't interact with CSP (script-src matches host, not query), and the modulepreload + script `src` use the same helper so their URLs match and the preload is still used.

**Consequences:** New `versioned_static()` + `_asset_hash()` helpers and context-processor exposure; `GET /version`; `.app-bar__version` label; Dockerfile `ARG/ENV CRANE_VERSION`; workflow `build-args`. 64 backend + 15 E2E, all green. Ships as v1.3.2 — **the last release that needs a manual hard-refresh; every deploy after this serves fresh assets automatically.**

---

## DL-026 — Sidebar usability: collapsible groups + cross-field make search

**Date:** 2026-07-07
**Finding:** F-008 (user feedback on a large real catalogue — 34 Liebherr models)

**Decisions:**
1. **Rebalance the sidebar, don't just widen it.** Grid columns went `1fr 1fr` → `148px 1fr`
   (total 380px → 430px): manufacturer names are short, model names (`LTM1090-4.1`) were
   truncating. Model rows tightened (padding `space-2`→`4px`, margin `2px`→`1px`) so a long
   list scrolls less.
2. **Collapsible type groups.** The type header became a `<button>` (chevron + label + count)
   toggling `.type-group.is-collapsed`, which hides its `.model-item`s via CSS. Collapse is
   purely visual, so it composes with the R-017 virtual-scroll batching untouched. A search
   force-expands all groups (`filter()`), because a match hidden inside a collapsed group
   would be invisible and confusing.
3. **Cross-field make search.** Previously a make was filtered by its *name* only, so
   searching a capacity like `500t` hid every manufacturer (no name contains "500t"). Now
   `renderMakes()` builds `sidebar._makeSearchText[make]` = the lowercased concatenation of
   all that make's cranes' make/type/model/capacity + file labels, and `filter()` keeps a make
   visible when the query hits that. The models panel (selected make) still filters its rows;
   together this means "search 500t → the makes that have a 500t crane stay, click one to see
   its 500t models."

**Also fixed:** model names were centre-aligned because `.model-item__body` is a `<button>`
(default `text-align:center`) — added `text-align:left`. A pre-existing bug the wider column
made obvious; found by screenshotting the change rather than trusting the passing tests.

**Consequences:** New `.type-header` button + chevron/count markup and CSS; `_makeSearchText`
lookup. Two E2E tests (`TestSidebarUX`: collapse toggle, cross-field make search). 64 backend
+ 17 E2E, all green. Bundled with the v1.3.x documentation refresh (README/CHANGELOG/QA
rewrite, remediation-docs consolidation). Ships as v1.4.0.

---

## DL-027 — Automated backups: in-app scheduler, consistent DB snapshot, separate target

**Date:** 2026-07-07
**Finding:** RR-010 (the last open risk — no recovery from `crane.db` loss)

**Decisions:**
1. **In-app scheduler, not host cron.** A daemon thread (`_backup_scheduler`) runs backups on
   an interval, so it "just works" in the container with no external cron to configure —
   matching the app's zero-ceremony philosophy. It sleeps `min(300, interval)` before the
   first run so a restart still snapshots soon (and so tests, which run in seconds, never fire
   it). `POST /api/backup` is also exposed so a host cron *can* drive it if the operator
   prefers (set `CRANE_BACKUP_ENABLED=0`).
2. **Consistent DB snapshot via SQLite's online-backup API**, not a file copy. Copying a live
   WAL database can capture a torn state; `source.backup(dest)` into a temp file is
   transactionally consistent even under concurrent writes. The `uploads/` tree is a
   best-effort point-in-time copy (not locked — a file added mid-run may or may not be
   included; acceptable for a catalogue snapshot). One `.zip` per backup = trivial restore
   (unzip into the data dir).
3. **`CRANE_BACKUP_DIR` is independent of the data dir.** Defaults to `<data>/backups` so it
   works out of the box, but points anywhere — the intended setup is a *separate* mount (e.g.
   a TrueNAS share) so a single-disk failure doesn't take the backups too. Documented the
   corollary: keep the *live* DB on local/block storage, because SQLite WAL locking is
   unreliable over NFS/SMB — put only the write-once backups (and the plain PDF files, which
   are lock-free) on the network share.
4. **`CRANE_BACKUP_INCLUDE_UPLOADS` (default on) for DB-only backups.** `CRANE_DB` and
   `CRANE_UPLOAD_DIR` are already independent, so the natural homelab split is DB-local +
   PDFs-on-NAS. When the PDFs sit on storage that snapshots itself (TrueNAS/ZFS), re-zipping
   gigabytes of PDFs into every backup is redundant and slow over the mount — so this toggle
   lets backups be just the (small, lock-sensitive, most-critical) DB snapshot, leaning on the
   NAS's own snapshots for the documents. Full backup remains the default (self-contained
   restore artifact).

**Consequences:** `create_backup()`/`list_backups()`/`_prune_backups()`/scheduler + three
routes + an app-bar download button. `BACKUP_DIR` is a module global derived from `DB_FILE` at
import, so both conftests set `CRANE_BACKUP_ENABLED=0` (no thread) and monkeypatch `BACKUP_DIR`
to a temp path. 71 backend + 18 E2E tests (7 backend backup tests incl. the snapshot being a
valid queryable SQLite DB + rotation; 1 E2E for the download button). RR-010 → MITIGATED.
Ships as v1.5.0.

---

## DL-028 — Settings panel: surface backups + read-only instance info, not an env editor

**Date:** 2026-07-07
**Finding:** F-009 (make the v1.5.0 backups visible/verifiable; a place for instance info)

**Decisions:**
1. **Read-only, not a config editor.** The panel deliberately does NOT let you edit the env
   vars. Most are read once at container start (paths, backup interval captured by the
   scheduler thread) so a UI control would silently do nothing until a restart; and
   `CRANE_TRUST_PROXY` is a *security* control — a UI toggle for "trust proxy headers" would be
   a footgun. Deployment config belongs in compose (version-controlled, reproducible). The
   panel shows config read-only and says so.
2. **Backups are the point.** v1.5.0 shipped backups but they were invisible (a lone button +
   a hidden status endpoint) — you couldn't tell if last night's run happened. The Backups card
   surfaces status (schedule, target, last run, DB-only vs full), a "Back up now" button, and a
   list of existing backups each downloadable via `GET /api/backup/download/<name>` (pattern-
   restricted + `send_from_directory` traversal-safe). Trust comes from being able to *see* it.
3. **Consolidated the app-bar.** The standalone database/download button became a gear that
   opens Settings (download lives inside), keeping the app-bar from growing a button per admin
   action. `GET /api/info` backs the read-only instance card (version, counts, paths, limits).

**Consequences:** New `settings` JS module + `#settings-modal`; routes `GET /api/info` and
`GET /api/backup/download/<name>`. 75 backend + 18 E2E (3 new backend: info + download-by-name
+ bad-name 404; the E2E backup test became a full settings-flow test). Ships as v1.6.0.

## DL-029 — Find & data hygiene: command palette, deep links, autocomplete, merge

**Date:** 2026-07-08
**Finding:** F-010 (retrieval at scale + keeping the catalogue clean as it grows)

**Decisions:**
1. **Client-side command palette, not a search API.** The whole catalogue already lives in
   `state.files` after `loadFileList()`, so the palette (`Ctrl/Cmd+K`) filters in-memory — no
   round-trip, instant results. Fuzzy substring across make/model/type/capacity covers "jump to
   a crane"; a capacity-range grammar (`>=N`, `>N`, `≥N`, `N+`) covers "show me everything ≥N
   tonnes" and sorts ascending by parsed capacity. Capped at 60 rows so a broad query stays fast
   to render. A server-side search endpoint would be premature at homelab catalogue sizes.
2. **Deep links via URL hash, not History pushState routes.** `#crane/<id>` is a fragment, so it
   needs no server route and can't 404 on refresh behind nginx/tinyauth. `viewer.openFile()`
   writes the hash (suppress flag prevents a set→hashchange→open loop); `deepLink.resolve()` runs
   once after the first list load and on every `hashchange`. Shareable/bookmarkable, back/forward
   just work.
3. **Native `<datalist>` autocomplete, not a JS combobox.** `GET /api/facets` yields distinct
   makes/types; feeding them into `<datalist>`s gets browser-native suggestions on both the
   upload modal and the bulk grid with zero extra widget code or a11y burden. `refreshFacets()`
   re-runs after each list load and after a merge so suggestions never go stale.
4. **Merge is re-slug-or-absorb, under the lock, and mirrors edit.** Because the make is part of
   the crane slug/directory, fixing a mistyped make is structurally the same as editing metadata:
   recompute `new_id` per crane and either rename the dir+rows (target free) or absorb the files
   into the existing crane and delete the source (target taken). Held in `metadata_lock()` like
   every other disk+DB mutation; emits a `merge` audit event. Exposed only in Settings (a bulk,
   destructive-ish operation gated behind a confirm dialog), not the main toolbar.

**Consequences:** New routes `GET /api/facets`, `POST /api/merge-make`; new `FACETS·PALETTE·DEEP
LINKS` JS region; `#palette-modal` + Settings "Merge manufacturers" card + two `<datalist>`s.
79 backend + 21 E2E (4 new backend: facets + merge rename/absorb/validation; 3 new E2E: palette
jump+capacity, deep-link-on-load, merge flow). Ships as v1.7.0.
