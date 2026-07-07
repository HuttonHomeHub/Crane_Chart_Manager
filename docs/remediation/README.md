# Engineering remediation — summary

A 2026-07-06 engineering deep-dive audited Crane Charts and raised **26 findings**
(`R-001`–`R-026`). Two more surfaced while moving to self-hosted Docker + nginx
(`R-027`, `R-028`). **All are resolved: 27 CLOSED + 1 ACCEPTED_RISK** (`R-002`, no app-level
auth — the app runs behind a tinyauth/nginx gate). The bulk shipped in **v1.0.0**; the two
deployment findings in v1.0.1 / the proxy work.

This file is the condensed record. The full living detail lives in:
- **[decision-log.md](decision-log.md)** — why each decision was made (`DL-001`–`DL-025`,
  including the post-remediation feature work).
- **[risk-register.md](risk-register.md)** — the risks still worth tracking (`RR-001`,
  `RR-010`, `RR-011`).
- Feature history since v1.0.0 is in the root **[CHANGELOG.md](../../CHANGELOG.md)**.
- Per-finding evidence (test names, diffs) is in git history around the v1.0.0 work.

## Findings & resolutions

| ID | Finding | Resolution |
|----|---------|-----------|
| R-001 | `delete_file` missing lock | whole body wrapped in `metadata_lock()`; race test added |
| R-002 | No authentication | **ACCEPTED_RISK** — gated by tinyauth/nginx `auth_request` (RR-001) |
| R-003 | PDF magic bytes not validated | `is_valid_pdf()` checks the `%PDF-` signature |
| R-004 | CDN PDF.js without SRI | self-hosted under `static/vendor/pdf.js/`; CDN dropped from CSP |
| R-005 | Flask/Werkzeug mismatch | upgraded to Flask 3.1.1; conftest shim removed |
| R-006 | No production WSGI server | Gunicorn (`make serve`, Docker CMD) |
| R-007 | No Dockerfile | added; non-root `crane` user |
| R-008 | No CI/CD | GitHub Actions: tests + E2E + image publish |
| R-009 | No delete-race test | `test_delete_does_not_lose_concurrent_upload` |
| R-010 | Bare `except` leaks internals | log via `app.logger.exception()`; return sanitised JSON |
| R-011 | No pagination | cursor-based `GET /api/pdfs?after=&limit=` |
| R-012 | TOCTOU in `get_pdfs` | now DB-driven; `getsize` guarded historically |
| R-013 | No rate limiting | Flask-Limiter; configurable (`CRANE_UPLOAD_RATE`/`CRANE_WRITE_RATE`) |
| R-014 | 1,250-line inline JS | extracted to `static/main.js` |
| R-015 | Inaccessible `confirm()` | native `<dialog>` confirm |
| R-016 | JS/CSS breakpoint duplication | CSS custom properties read by JS |
| R-017 | No virtual scrolling | batched sidebar render via `IntersectionObserver` |
| R-018 | `download()` anchor timing | deferred anchor removal |
| R-019 | JSON file scalability | SQLite (`cranes`/`files`/`spec_events`) |
| R-020 | No audit trail | immutable `spec_events` log via `log_event()` |
| R-021 | No backup strategy | `GET /api/export` (partial — automated backup still open, RR-010) |
| R-022 | No structured logging | `python-json-logger`, one JSON line per request |
| R-023 | No health check | `GET /health` |
| R-024 | Hard-coded config | `CRANE_*` env vars |
| R-025 | Missing security headers | `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| R-026 | No E2E tests | Playwright suite (`tests/e2e/`) |
| R-027 | Proxy headers / limiter split-brain | `ProxyFix` behind `CRANE_TRUST_PROXY=1`; single Gunicorn worker (RR-011) |
| R-028 | Manual `chown` needed on volume | `docker-entrypoint.sh` remaps `PUID`/`PGID` and self-heals ownership |

## Timeline

- **Sessions 1–4 → v1.0.0** — closed the 26 audit findings across critical fixes, security
  hardening, ops readiness, testing, and scalability (SQLite, pagination, virtual scroll).
- **Deployment (Docker + nginx + tinyauth)** — raised and closed R-027 (proxy trust) and
  R-028 (PUID/PGID entrypoint); verified the tinyauth gate and `Secure` cookie in production.
- **v1.1–v1.3** — net-new features (multi-file cranes, in-PDF find, bulk import) plus the
  cache-busting/versioning that removed the post-deploy hard-refresh. See CHANGELOG.

## Still open (tracked in risk-register.md)

- **RR-001** — the app has no auth of its own; access depends entirely on the tinyauth/nginx
  gate staying configured. Re-verify with an incognito request after any nginx change.
- **RR-010** — no automated backup of `crane.db`; keep a copy of `/config` before upgrades.
- **RR-011** — MITIGATED; single proxy hop only, single Gunicorn worker.
