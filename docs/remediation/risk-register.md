# Risk Register

Programme: Crane Charts Engineering Remediation  
Last updated: 2026-07-06 (Session 4)

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
- Access gating moves from Codespaces' port-forwarding to nginx: basic auth, mTLS, or an IP allowlist configured in the user's nginx, in front of the container.
- App must run with `CRANE_TRUST_PROXY=1` so `request.is_secure`/`get_remote_address()` reflect the real client via `X-Forwarded-Proto`/`X-Forwarded-For` rather than nginx's own connection (see RR-011).
- CSRF + `SameSite=Strict` still apply underneath the nginx gate.

**Residual risk:** The application itself still has zero credential checks of its own — it is entirely dependent on whatever sits in front of it (Codespaces' forwarding, or the operator's nginx config) being configured correctly. A misconfigured or missing nginx auth directive reopens the same full read/write/delete exposure. This has not changed in kind since the original acceptance — only the identity of "what's in front of it" has.

**Acceptance conditions:**
- Codespaces deployment: port remains `private`.
- Self-hosted deployment: nginx must have an auth gate (basic auth / mTLS / IP allowlist) in front of the app — verify this is actually configured before exposing the container, not assumed.
- Re-evaluate on any further change to hosting model (e.g. if nginx's gate is ever removed, or the app is exposed with no proxy in front at all).

**Re-evaluation date:** On any further hosting model change.

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
| **Status** | OPEN |
| **Severity** | HIGH |
| **Likelihood** | LOW |
| **Impact** | HIGH |

**Description:** The SQLite database (`crane.db`) stores all metadata. A corrupted or accidentally deleted file loses all metadata permanently. Unlike `metadata.json`, there is currently no cron-based backup.

**Current controls:**
- `load_metadata()` returns `{}` on corrupt DB (graceful degradation — app continues serving PDF downloads)
- `GET /api/export` provides a manual metadata snapshot for operator use
- `spec_events` table provides an audit trail that can be used to reconstruct history
- Dockerfile VOLUME mount on `/app/uploads` provides host-level persistence

**Residual risk:** Automated backup is not yet in place. A `crane.db` deletion after the last manual export loses all metadata changes since that export.

**Target state:** Automated daily backup cron (ops follow-up, outside the 26-item finding set). Until then, advise operators to download an export before any maintenance.

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

**Resolution:** `app.wsgi_app` is wrapped in Werkzeug's `ProxyFix` (`x_for=1, x_proto=1, x_host=1`), gated behind `CRANE_TRUST_PROXY=1` so headers are trusted only when the operator confirms there's exactly one proxy hop in front (unconditional trust would let any client spoof its own IP/scheme). Dockerfile now runs a single Gunicorn worker, eliminating the rate-limiter split-brain without adding a new storage dependency. Verified manually: with `CRANE_TRUST_PROXY=1` and a forged `X-Forwarded-Proto: https` header, the CSRF cookie correctly receives `Secure`; without the env var (default), the same header is ignored (see `test_forwarded_proto_ignored_without_trust_proxy`).

**Residual risk:** Only a single proxy hop is supported (`x_for=1` etc.) — chaining another proxy/CDN in front of nginx would need the `x_for`/`x_proto` counts increased. If throughput ever requires more than one Gunicorn worker, `storage_uri` must move to a shared backend (e.g. Redis) first, or the split-brain returns.

**Re-evaluation date:** If a second proxy hop is added in front of nginx, or if Gunicorn worker count is increased.

---

RR-010 remains the only OPEN risk in this register; it is an ops follow-up (automated `crane.db` backup) rather than one of the 26 tracked findings, all of which are CLOSED or ACCEPTED_RISK.
