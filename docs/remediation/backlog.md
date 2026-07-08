# Remediation Backlog

Living backlog derived from the 2026-07-08 engineering audit (Phases 2–9). **No finding is
ever deleted** — completed items retain their resolution + evidence (rule #10). Statuses:
`NOT_STARTED · IN_ANALYSIS · BLOCKED · IN_PROGRESS · IMPLEMENTED · VALIDATED · CLOSED · ACCEPTED_RISK · SUPERSEDED`.

**Convention:** an item is `VALIDATED` when code is implemented, tests pass, and docs are
updated in the working tree; it becomes `CLOSED` when merged to `main` (the operator's ship gate).

Priority bands (audit §Phase 10): **P1** data-loss/integrity · **P2** authn/authz · **P3** security ·
**P4** dependency · **P5** deployment/ops · **P6** testing · **P7** maintainability · **P8** scalability.

Legend for Source: audit finding IDs — F=frontend, B=backend, D=database, S=security, O=devops, T=testing.

---

## Status summary (as of Session 1 — 2026-07-08)

| Band | Total | CLOSED/VALIDATED | ACCEPTED_RISK | Open (NOT_STARTED/IN_ANALYSIS) |
|------|-------|------------------|---------------|--------------------------------|
| P1 data/integrity | 5 | 0 | 2 | 3 |
| P2 authn/authz | 1 | 0 | 1 | 0 |
| P3 security | 6 | 4 | 2 | 0 |
| P4 dependency | 2 | 1 | 1 | 0 |
| P5 ops | 8 | 6 | 0 | 2 |
| P6 testing | 4 | 1 | 0 | 3 |
| P7 maintainability | 8 | 0 | 0 | 8 |
| P8 scalability | 4 | 0 | 1 | 3 |
| **Total** | **38** | **12** | **7** | **19** |

---

## P1 — Data-loss & integrity

| ID | Src | Sev | Status | Deps | Validation method | Completion criteria |
|----|-----|-----|--------|------|-------------------|---------------------|
| REM-DATA-01 | D1 | Medium | IN_ANALYSIS | REM-MAINT-03 (conn helper), migration | Unit test: delete crane → files gone; rename crane → files follow; orphan insert rejected | FK `files.crane_id→cranes.id` with `ON UPDATE/DELETE CASCADE`, `PRAGMA foreign_keys=ON` on every connection, table-rebuild migration for existing DBs |
| REM-DATA-02 | B8 | Medium | NOT_STARTED | — | Unit test: corrupt DB → route returns 503 (not empty 200) | `list_cranes()` distinguishes "empty" from "unreadable"; UI shows an error state, not a silent empty catalogue |
| REM-DATA-03 | D3 | Low | NOT_STARTED | REM-MAINT-03 | Unit test: index used; prune keeps N | Index on `spec_events(filename, occurred_at)`; optional retention prune; (viewer = separate feature) |
| REM-DATA-04 | D4 | Low | ACCEPTED_RISK | — | n/a | ISO-8601 string timestamps are a documented invariant; acceptable at this scale |
| REM-DATA-05 | D2 | Low | ACCEPTED_RISK | — | n/a | Capacity-as-text accepted per product decision (app is a chart *repository*; no numeric capacity querying). Revisit only if a capacity feature is ever built. |

## P2 — Authentication & access control

| ID | Src | Sev | Status | Deps | Validation method | Completion criteria |
|----|-----|-----|--------|------|-------------------|---------------------|
| REM-AUTH-01 | S1 | High* | ACCEPTED_RISK | — | Proxy config review (RR-001) | No app-layer auth; delegated to nginx+tinyauth. Accepted, *conditionally*: recommend defence-in-depth (shared-secret header) for destructive routes `delete`/`restore` if trust in the gate ever weakens. Tracked in risk-register RR-001. |

\*High only if the deployment's proxy-trust assumption changes.

## P3 — Security vulnerabilities

| ID | Src | Sev | Status | Deps | Validation method | Completion criteria |
|----|-----|-----|--------|------|-------------------|---------------------|
| SEC-DEP-01 | *new (pip-audit)* | High | VALIDATED | REM-SEC-02a | `pip-audit -r requirements.txt --strict` clean; suite green | Flask 3.1.1→3.1.3 (CVE-2026-27205) ✔ |
| REM-SEC-02a | S2 | Medium | VALIDATED | — | CI `pip-audit` step present & green | Dependency CVE scan enforced in CI ✔ |
| REM-SEC-02b | S2 | Medium | VALIDATED | — | `.github/dependabot.yml` present | Dependabot for pip + actions + docker ✔ |
| REM-SEC-02c | S2 | Medium | VALIDATED | — | Dockerfile `FROM …@sha256:` | Base image digest-pinned (verified digest) ✔ |
| REM-SEC-02d | S2 | Low | NOT_STARTED | — | `pip install --require-hashes` succeeds | Hash-pinned runtime deps / lockfile |
| REM-SEC-02e | *new (this cycle)* | Low | VALIDATED | — | Runtime `requirements.txt` excludes test/lint tools | Dev deps split into `requirements-dev.txt`; smaller image/attack surface ✔ |
| REM-SEC-03 | S3 | Low | VALIDATED | — | Code review: `debug=CRANE_DEBUG=='1'`; suite green | Werkzeug debugger opt-in only ✔ |
| REM-SEC-04 | S4 | Low | VALIDATED | — | `test_csp_header…` asserts `object-src 'none'` | CSP `object-src 'none'` ✔ (Content-Disposition on `/uploads` deferred — optional, low value) |
| REM-SEC-05 | S5 | Low | ACCEPTED_RISK | REM-SCALE-02 | n/a | Per-process/in-memory rate-limit counters accepted (single worker, gated). Reopens with SCALE-02. |
| REM-SEC-06 | B6 | Low | ACCEPTED_RISK | — | n/a | Header-only PDF validation accepted given the gated, single-user deployment + `nosniff` + sandboxed viewer. Revisit if exposed. |

## P4 — Dependency compatibility

| ID | Src | Sev | Status | Deps | Validation method | Completion criteria |
|----|-----|-----|--------|------|-------------------|---------------------|
| REM-DEP-01 | O5 | Low | ACCEPTED_RISK | REM-SEC-02b | n/a | Node-20 deprecation on GH actions is cosmetic; Dependabot `github-actions` will raise bumps automatically. Monitor. |
| REM-DEP-02 | S2 | — | SUPERSEDED | — | — | Superseded by SEC-DEP-01 / REM-SEC-02a–c (dependency posture now covered by scanning + Dependabot + pinning). |

## P5 — Deployment & operational readiness

| ID | Src | Sev | Status | Deps | Validation method | Completion criteria |
|----|-----|-----|--------|------|-------------------|---------------------|
| REM-OPS-01a | O1 | High | VALIDATED | — | CI `ruff check` green | Lint gate in CI ✔ |
| REM-OPS-01c | O1/T3 | High | VALIDATED | — | CI `--cov-fail-under=80` green (82.48%) | Coverage gate in CI ✔ |
| REM-OPS-01d | O1 | Medium | NOT_STARTED | — | CI `bandit` step green | SAST (bandit) in CI |
| REM-OPS-01e | O1 | Medium | NOT_STARTED | — | CI `trivy image` step | Container image scan in CI (needs build in pipeline) |
| REM-OPS-02 | O2 | Medium | VALIDATED | — | `deploy/compose.example.yml` present | Reference IaC committed ✔ |
| REM-OPS-03 | O3 | Medium | VALIDATED* | — | `test_backup_status_reports_scheduler_health` | Backup scheduler health surfaced in `/api/backup` ✔. *`/metrics` endpoint deferred (REM-OPS-06). |
| REM-OPS-04 | O4 | Low | VALIDATED | — | Dockerfile healthcheck `timeout=3` | Healthcheck fails fast ✔ |
| REM-OPS-06 | O3 | Low | NOT_STARTED | — | `/metrics` scrape | Prometheus metrics endpoint (optional for homelab) |

## P6 — Testing

| ID | Src | Sev | Status | Deps | Validation method | Completion criteria |
|----|-----|-----|--------|------|-------------------|---------------------|
| REM-TEST-01 | T1 | Medium | NOT_STARTED | REM-MAINT-02 | Vitest run green in CI | Unit tests for pure JS helpers (parseCapacity, naturalCompare, filename/capacity grammar) |
| REM-TEST-02 | T2 | Medium | NOT_STARTED | — | E2E pass with per-test isolation | Function-scoped server or per-test DB reset; remove order-coupling |
| REM-TEST-03 | T3 | — | SUPERSEDED | — | — | Superseded by REM-OPS-01c (coverage now measured + gated) |
| REM-TEST-04 | T4 | Medium | NOT_STARTED | REM-DATA-02, REM-MAINT-07 | New unit tests green | Cover: empty/colliding slug, corrupt-DB 503, DB-only restore keeps uploads, concurrent merge vs upload |

## P7 — Maintainability

| ID | Src | Sev | Status | Deps | Validation method | Completion criteria |
|----|-----|-----|--------|------|-------------------|---------------------|
| REM-MAINT-01 | F1 | High | NOT_STARTED | — | `tsc --checkJs` / editor clean | `// @ts-check` + JSDoc across `main.js` (or TS migration) |
| REM-MAINT-02 | F2 | Medium | NOT_STARTED | — | Build produces one bundle; E2E green | Split `main.js` into ES modules + esbuild step (enables REM-TEST-01) |
| REM-MAINT-03 | B3 | Medium | NOT_STARTED | — | Suite green after refactor | `db.py` connection-context + CRUD layer; one connection per op (fixes merge connection-per-loop); enables REM-DATA-01 |
| REM-MAINT-04 | B5 | Medium | NOT_STARTED | — | Import `app` has no side effects; tests via factory | `create_app()` factory; DB init/migrate/scheduler moved out of import |
| REM-MAINT-05 | F4 | Low | NOT_STARTED | REM-MAINT-02 | Manual: thrown render error caught | Global `window.onerror`/`unhandledrejection` → toast |
| REM-MAINT-06 | *new (this cycle)* | Low | NOT_STARTED | — | `ruff check` (I/B/UP) + `ruff format --check` green | Adopt `ruff format` + expand ruleset; fix the ~8 findings (incl. B904 raise-from at app.py:666) |
| REM-MAINT-07 | B7 | Low | NOT_STARTED | REM-TEST-04 | Unit test: empty/colliding slug → 400 | `generate_crane_id` rejects empty/duplicate derived slug explicitly |
| REM-MAINT-08 | F5 | Low | NOT_STARTED | REM-MAINT-02 | axe / manual SR check | Palette `role=listbox`/`aria-activedescendant` |

## P8 — Scalability

| ID | Src | Sev | Status | Deps | Validation method | Completion criteria |
|----|-----|-----|--------|------|-------------------|---------------------|
| REM-SCALE-01 | B1 | High | NOT_STARTED | REM-SCALE-04 | Unit test: page query hits SQL LIMIT; TestPagination green | `get_pdfs` paginates in SQL (`WHERE id > ? LIMIT ?` + files for page ids only) |
| REM-SCALE-02 | B2 | High | ACCEPTED_RISK | — | n/a | Single-process ceiling (threading.Lock + memory limiter + local WAL). Accepted for single-user homelab. Reopen (→ Redis limiter + shared lock) only if multi-worker/HA needed. |
| REM-SCALE-03 | B4 | Medium | NOT_STARTED | REM-MAINT-03 | Test: reader during merge/restore sees atomic before/after | Wrap merge/restore in single transactions; consistent reads |
| REM-SCALE-04 | F3 | Medium | NOT_STARTED | REM-SCALE-01 | Perf check at N cranes | Debounce palette; server-side search (FTS) for large catalogues |

---

## Change history
- **2026-07-08 (Session 1):** Backlog created from audit. Cycle 1 executed (P3–P5 quick wins).
  Newly discovered: SEC-DEP-01 (real Flask CVE via new scanner), REM-SEC-02e (image slimming),
  REM-MAINT-06 (ruff format). Dependency discovered: REM-DATA-01 now blocked-behind REM-MAINT-03
  + a table-rebuild migration (FK + id-rename interaction). REM-DEP-02, REM-TEST-03 superseded.
