# Risk Register

Crane Charts — risks worth tracking.  
Last updated: 2026-07-08 (remediation programme, Session 1)

Most entries below are CLOSED/MITIGATED historical records from the remediation (see
[README.md](README.md)). The one still genuinely live is **RR-001** (no app-level auth —
depends on the tinyauth/nginx gate). **RR-010** (crane.db loss) is MITIGATED by automated
backups since v1.5.0 (and in-app restore since v1.8.0), and **RR-011** (proxy headers) is
MITIGATED (single hop / single worker).

**2026-07-08 audit follow-up (see [backlog.md](backlog.md)):** a dependency-scanning CI gate
(`pip-audit`) + Dependabot were added and immediately caught **RR-012** below (a live Flask CVE),
now fixed. The single-process architectural ceiling is tracked as **RR-013** (accepted). New
risks are appended after RR-011.

---

## Status legend

| Code | Meaning |
|------|---------|
| OPEN | Active risk, no mitigation complete |
| MITIGATED | Risk reduced by implemented controls |
| CLOSED | Risk eliminated |
| ACCEPTED | Documented acceptance with conditions |

---

## RR-001 — Unauthenticated API (corresponds to R-002)

| Field | Value |
|-------|-------|
| **ID** | RR-001 |
| **Status** | ACCEPTED |
| **Severity** | HIGH |
| **Likelihood** | LOW (current deployment) |
| **Impact** | CRITICAL if exploited |

**Description:** All five API routes are open. Any client that can reach the app can list, upload, edit, or delete all crane specification documents.

**Current controls (Codespaces deployment):**
- GitHub Codespaces forwards port 5000 only to authenticated Codespaces sessions
- Port visibility is `private` by default (not public)
- CSRF prevents cross-site request forgery
- `SameSite=Strict` on the CSRF cookie limits cross-site cookie abuse

**Current controls (self-hosted Docker + nginx deployment — re-evaluated 2026-07-06, DL-020):**
- Access is gated by **tinyauth** in front of nginx. The Nginx Proxy Manager proxy host for `cranecharts.huttonhomehub.co.uk` uses `auth_request /tinyauth;` on its `location /` block, so **every** path (including `/health`, `/api/*`, `/uploads/*`) requires a valid tinyauth session; unauthenticated requests are 302-redirected to the tinyauth login. **Verified 2026-07-06:** an incognito request to `/health` redirects to the tinyauth login page.
- App runs with `CRANE_TRUST_PROXY=1`; the NPM `location /` block sets `Host`/`X-Forwarded-Proto`/`X-Forwarded-For` so `request.is_secure` and `get_remote_address()` reflect the real client (see RR-011). **Verified 2026-07-06:** the `crane_csrf` cookie is issued with `Secure` set over the public HTTPS URL, confirming `X-Forwarded-Proto` is landing.
- CSRF + `SameSite=Strict` still apply underneath the tinyauth gate.

**Residual risk:** The application itself still has zero credential checks of its own — it is entirely dependent on the tinyauth `auth_request` in NPM being present and correct. If that `location /` block is ever edited to drop `auth_request` (or a more-specific `location /api/` etc. is added without it), the full read/write/delete exposure returns. The control is now *verified in place* rather than *assumed*, but it lives in NPM config outside this repo, so it can't be regression-tested here.

**Acceptance conditions:**
- Codespaces deployment: port remains `private`.
- Self-hosted deployment: the tinyauth `auth_request` gate must remain on the NPM `location /` block, and no more-specific `location` may bypass it. Re-verify with an incognito `/health` request after any NPM proxy-host change.
- Re-evaluate on any further change to hosting model (e.g. if the tinyauth gate is removed, or the app is exposed with no proxy in front at all).

**Re-evaluation date:** On any further hosting model change, or any edit to the NPM proxy host for `cranecharts.huttonhomehub.co.uk`.

---

## RR-002 — CDN dependency for PDF.js (corresponds to R-004)

| Field | Value |
|-------|-------|
| **ID** | RR-002 |
| **Status** | CLOSED |
| **Severity** | HIGH |
| **Likelihood** | LOW |
| **Impact** | HIGH (supply-chain XSS) |

**Description:** PDF.js was loaded from `cdnjs.cloudflare.com` without SRI. A CDN compromise or man-in-the-middle attack on the CDN connection could inject arbitrary JavaScript.

**Resolution:** R-004 completed in Session 2. `pdf.min.mjs` and `pdf.worker.min.mjs` are now served from `static/vendor/pdf.js/`. The CDN host has been removed from all CSP directives (`script-src`, `worker-src`, `connect-src`). No external JS dependencies remain.

---

## RR-003 — Concurrent delete/upload data loss (corresponds to R-001)

| Field | Value |
|-------|-------|
| **ID** | RR-003 |
| **Status** | CLOSED |
| **Severity** | CRITICAL |
| **Likelihood** | MEDIUM (any concurrent usage) |
| **Impact** | CRITICAL (silent metadata loss) |

**Description:** `delete_file()` performed read-modify-write on `metadata.json` without `metadata_lock()`. A concurrent upload could lose its metadata entry.

**Resolution:** R-001 fixed in Session 1. `metadata_lock()` now wraps the full delete body. R-009 test provides regression coverage.

---

## RR-004 — Flask/Werkzeug incompatibility in production (corresponds to R-005)

| Field | Value |
|-------|-------|
| **ID** | RR-004 |
| **Status** | CLOSED |
| **Severity** | MEDIUM |
| **Likelihood** | MEDIUM |
| **Impact** | MEDIUM |

**Description:** Flask 2.3.2 and Werkzeug 3.x had a known API incompatibility (`werkzeug.__version__` removed). Unknown further incompatibilities possible.

**Resolution:** R-005 upgraded to Flask 3.1.1. Shim removed. All tests pass.

---

## RR-005 — Development server in active use (corresponds to R-006)

| Field | Value |
|-------|-------|
| **ID** | RR-005 |
| **Status** | MITIGATED |
| **Severity** | MEDIUM |
| **Likelihood** | LOW |
| **Impact** | MEDIUM |

**Description:** `flask --debug run` was the configured server. Debug mode exposes an interactive Werkzeug debugger at `/__debugger__` if an unhandled exception occurs.

**Resolution:** R-006 completed in Session 2. `devcontainer.json` now launches `gunicorn --workers 1 --bind 0.0.0.0:5000 --reload app:app`. Debug mode is no longer active. `make dev` still available for hot-reload development. R-007 Dockerfile also added with `gunicorn` as the default CMD.

---

## RR-006 — No rollback mechanism for failed deployments (new risk)

| Field | Value |
|-------|-------|
| **ID** | RR-006 |
| **Status** | MITIGATED |
| **Severity** | LOW |
| **Likelihood** | LOW |
| **Impact** | MEDIUM |

**Description:** There is no versioned deployment. If a bad change is pushed to the Codespaces branch and auto-reloaded, the only recovery is `git revert`. For a single-user internal tool this is acceptable.

**Resolution (partial):** R-021 closed in Session 3. `GET /api/export` provides a metadata snapshot before a bad deploy takes effect. R-007 Dockerfile + R-008 CI together provide a safe pipeline. Residual risk: SQLite database is not backed up automatically; `crane.db` loss requires re-uploading all files. Automated backup is a follow-up ops task.

---

## RR-007 — Non-PDF files served as PDF (corresponds to R-003)

| Field | Value |
|-------|-------|
| **ID** | RR-007 |
| **Status** | CLOSED |
| **Severity** | MEDIUM |
| **Likelihood** | LOW |
| **Impact** | MEDIUM |

**Description:** Only file extension was checked. Files with `.pdf` extension but non-PDF content could be uploaded.

**Resolution:** R-003 fixed in Session 1. `is_valid_pdf()` checks `%PDF-` magic bytes before saving.

---

## RR-008 — 500 responses leak internal file paths (corresponds to R-010)

| Field | Value |
|-------|-------|
| **ID** | RR-008 |
| **Status** | CLOSED |
| **Severity** | MEDIUM |
| **Likelihood** | LOW |
| **Impact** | LOW |

**Description:** `return jsonify({'error': str(e)})` could expose OS error messages containing `/workspaces/codespaces-flask/uploads/…` paths.

**Resolution:** R-010 fixed in Session 1. Bare `except` clauses now use `app.logger.exception()` and return sanitised `"Internal server error"` messages.

---

## Programme-introduced risks

### RR-009 — Flask 3.x upgrade may expose hidden API differences

| Field | Value |
|-------|-------|
| **ID** | RR-009 |
| **Status** | MITIGATED |
| **Severity** | MEDIUM |
| **Likelihood** | LOW |
| **Impact** | MEDIUM |

**Description:** Flask 3.x introduced some breaking changes (e.g., `flask.escape` removed, `flask.json` module restructured). The application may use deprecated API patterns not covered by the test suite.

**Current controls:**
- All 23 + new tests pass after upgrade
- Application routes reviewed manually against Flask 3.x changelog
- R-008 CI will catch regressions on future changes

**Target state:** MITIGATED. Monitor for any Flask 3.x-specific errors in production logs.

---

### RR-010 — SQLite database file corruption or loss

| Field | Value |
|-------|-------|
| **ID** | RR-010 |
| **Status** | MITIGATED (v1.5.0) |
| **Severity** | HIGH |
| **Likelihood** | LOW |
| **Impact** | HIGH |

**Description:** The SQLite database (`crane.db`) stores all metadata. A corrupted or accidentally deleted file would lose all metadata permanently.

**Resolution (v1.5.0, DL-027):** The app now takes automated **full backups** — a consistent `crane.db` snapshot (SQLite online-backup API) + a zip of `uploads/` — on a schedule (`CRANE_BACKUP_INTERVAL_HOURS`, default 24h), pruned to `CRANE_BACKUP_KEEP`. Written to `CRANE_BACKUP_DIR`, which can point at a separate/off-host mount (e.g. TrueNAS). A "Download backup" button and `GET /api/backup/download` provide on-demand copies; `POST /api/backup` allows host-cron-driven backups. Graceful degradation on a corrupt DB (empty catalogue, no 500) and the `spec_events` audit trail remain as secondary controls.

**Residual risk:** Backups are only as safe as where `CRANE_BACKUP_DIR` points — if left at the default (`<data>/backups`, same volume as the live data), a single-disk failure loses both. Operators should point it at a separate mount. Restore is manual (unzip into the data dir); there is no in-app restore. Recommend verifying a backup occasionally.

---

## Session 4 note (R-017)

R-017 (virtual scrolling) closed — frontend-only change (batched DOM rendering in `sidebar.selectMake()`, bounded pagination in `api.listPdfs()`). No new risk introduced: the change doesn't touch authentication, data persistence, or any security control.

---

## RR-011 — Reverse-proxy headers spoofable / rate-limiter split-brain (corresponds to R-027)

| Field | Value |
|-------|-------|
| **ID** | RR-011 |
| **Status** | MITIGATED |
| **Severity** | MEDIUM |
| **Likelihood** | HIGH (certain, if deployed behind nginx without the fix) |
| **Impact** | MEDIUM |

**Description:** Raised when moving the app off Codespaces onto self-hosted Docker behind the user's own nginx. Two related issues: (1) without trusting `X-Forwarded-Proto`/`X-Forwarded-For`, the app can't tell TLS was terminated at nginx, so the CSRF cookie never gets `Secure`, and `Flask-Limiter`'s `get_remote_address()` keys every request off nginx's own IP instead of the real client; (2) `Flask-Limiter`'s `storage_uri="memory://"` keeps counters per-process — the Dockerfile's original 2-worker Gunicorn config would silently double every configured rate limit.

**Resolution:** `app.wsgi_app` is wrapped in Werkzeug's `ProxyFix` (`x_for=1, x_proto=1, x_host=1`), gated behind `CRANE_TRUST_PROXY=1` so headers are trusted only when the operator confirms there's exactly one proxy hop in front (unconditional trust would let any client spoof its own IP/scheme). Dockerfile now runs a single Gunicorn worker, eliminating the rate-limiter split-brain without adding a new storage dependency. Verified manually: with `CRANE_TRUST_PROXY=1` and a forged `X-Forwarded-Proto: https` header, the CSRF cookie correctly receives `Secure`; without the env var (default), the same header is ignored (see `test_forwarded_proto_ignored_without_trust_proxy`). **Verified in production 2026-07-06:** over the public HTTPS URL (`cranecharts.huttonhomehub.co.uk`, tinyauth + NPM, single hop, `CRANE_TRUST_PROXY=1`), the `crane_csrf` cookie is issued with `Secure` set — confirming NPM's `X-Forwarded-Proto` reaches the app and `ProxyFix` honours it.

**Residual risk:** Only a single proxy hop is supported (`x_for=1` etc.) — chaining another proxy/CDN in front of nginx would need the `x_for`/`x_proto` counts increased. If throughput ever requires more than one Gunicorn worker, `storage_uri` must move to a shared backend (e.g. Redis) first, or the split-brain returns.

**Re-evaluation date:** If a second proxy hop is added in front of nginx, or if Gunicorn worker count is increased.

---

---

## RR-012 — Vulnerable dependency shipping in the image (Flask CVE-2026-27205)

| | |
|---|---|
| **ID** | RR-012 |
| **Status** | CLOSED |
| **Source** | Audit finding S2 → new `pip-audit` CI gate (REM-SEC-02a) |

**Risk:** The published image bundled **Flask 3.1.1**, affected by **CVE-2026-27205** (fixed in
3.1.3). Nothing in CI scanned for known-vulnerable dependencies, so it would have shipped
indefinitely.

**Mitigation (2026-07-08):** Bumped Flask to 3.1.3 (SEC-DEP-01); added a `pip-audit --strict`
gate + Dependabot so future CVEs are caught proactively. `pip-audit` now reports no known
vulnerabilities.

**Residual risk:** Zero-day / not-yet-published CVEs remain undetectable until disclosed — the
gate reduces window, doesn't eliminate it.

---

## RR-013 — Single-process architectural ceiling

| | |
|---|---|
| **ID** | RR-013 |
| **Status** | ACCEPTED |
| **Source** | Audit findings B2 / S5 (REM-SCALE-02) |

**Risk:** Consistency depends on an in-process `threading.Lock` and a `memory://` rate-limiter,
and state lives on local FS + local WAL SQLite. Running >1 Gunicorn worker or >1 replica would
corrupt the disk/DB invariant and multiply rate limits. The app cannot scale horizontally as-is.

**Acceptance:** Correct and sufficient for the single-user, homelab, proxy-gated deployment. The
Dockerfile pins `--workers 1` to enforce it.

**Re-evaluation trigger:** Any need for multiple workers/replicas or HA — at which point the lock
must move to a shared advisory lock and the limiter to Redis (do those *first*).

---

As of the 2026-07-08 remediation Session 1, no risk in this register is OPEN: RR-001 / RR-013 are
ACCEPTED (gated / single-process by design), RR-010 / RR-011 are MITIGATED, and RR-012 is CLOSED.
The programme backlog ([backlog.md](backlog.md)) tracks the remaining audit findings to a terminal
state.
