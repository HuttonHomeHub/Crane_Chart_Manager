# Master Implementation Plan

Programme: Crane Charts Engineering Remediation  
Audit date: 2026-07-06  
Plan created: 2026-07-06 (Session 1)  
Last updated: 2026-07-06 (Session 4)

---

## Objective

Systematically resolve every finding from the 2026-07-06 engineering audit until each item is CLOSED, ACCEPTED_RISK, or SUPERSEDED. Maintain a living log of all decisions, risks, and progress throughout.

---

## Finding inventory

| ID | Title | Priority | Severity | Status |
|----|-------|----------|----------|--------|
| R-001 | delete_file missing metadata_lock() | P1 | CRITICAL | CLOSED |
| R-002 | No authentication | P2 | HIGH | ACCEPTED_RISK |
| R-003 | PDF magic bytes not validated | P3 | HIGH | CLOSED |
| R-004 | CDN PDF.js without SRI | P3 | HIGH | CLOSED |
| R-005 | Flask/Werkzeug mismatch | P4 | HIGH | CLOSED |
| R-006 | No production WSGI server | P5 | HIGH | CLOSED |
| R-007 | No Dockerfile | P5 | HIGH | CLOSED |
| R-008 | No CI/CD | P5 | HIGH | CLOSED |
| R-009 | No delete race condition test | P6 | HIGH | CLOSED |
| R-010 | Bare except blocks | P7 | MEDIUM | CLOSED |
| R-011 | No pagination | P8 | MEDIUM | CLOSED |
| R-012 | TOCTOU in get_pdfs | P7 | MEDIUM | CLOSED |
| R-013 | No rate limiting | P3 | MEDIUM | CLOSED |
| R-014 | Inline JS module | P7 | HIGH | CLOSED |
| R-015 | Native confirm() inaccessible | P7 | MEDIUM | CLOSED |
| R-016 | JS/CSS breakpoint duplication | P7 | MEDIUM | CLOSED |
| R-017 | No virtual scrolling | P8 | MEDIUM | CLOSED |
| R-018 | download() anchor timing | P8 | LOW | CLOSED |
| R-019 | JSON file scalability limit | P8 | HIGH | CLOSED |
| R-020 | No audit trail | P8 | MEDIUM | CLOSED |
| R-021 | No backup strategy | P8 | LOW | CLOSED |
| R-022 | No structured logging | P5 | MEDIUM | CLOSED |
| R-023 | No health check endpoint | P5 | MEDIUM | CLOSED |
| R-024 | Config hard-coded | P5 | MEDIUM | CLOSED |
| R-025 | Missing security headers | P3 | MEDIUM | CLOSED |
| R-026 | No E2E tests | P6 | MEDIUM | CLOSED |

**Session 1 totals:** 10 CLOSED · 1 ACCEPTED_RISK · 15 NOT_STARTED  
**Session 2 totals:** 19 CLOSED · 1 ACCEPTED_RISK · 6 NOT_STARTED  
**Session 3 totals:** 25 CLOSED · 1 ACCEPTED_RISK · 1 NOT_STARTED  
**Session 4 totals:** 26 CLOSED · 1 ACCEPTED_RISK · 0 NOT_STARTED — **programme complete**

---

## Phase structure

### Phase 1 — Critical fixes and foundations (Sessions 1–2)

Goal: Eliminate data loss risks, close critical/high P1–P4 items, establish CI.

| Item | Effort | Session |
|------|--------|---------|
| R-001 delete_file lock | 15 min | 1 ✓ |
| R-012 TOCTOU getsize | 15 min | 1 ✓ |
| R-010 bare except | 30 min | 1 ✓ |
| R-025 security headers | 30 min | 1 ✓ |
| R-023 health check | 15 min | 1 ✓ |
| R-024 env var config | 30 min | 1 ✓ |
| R-009 delete race test | 1 hour | 1 ✓ |
| R-003 PDF magic bytes | 1 hour | 1 ✓ |
| R-005 Flask/Werkzeug upgrade | 1 hour | 1 ✓ |
| R-008 CI/CD | 30 min | 1 ✓ |
| R-002 auth (ACCEPTED_RISK) | — | 1 ✓ |

### Phase 2 — Security hardening (Session 2–3)

Goal: Close remaining P3 security items.

| Item | Effort | Session |
|------|--------|---------|
| R-004 Self-host PDF.js | 2 days | 2 ✓ |
| R-013 Rate limiting | 1 day | 2 ✓ |

### Phase 3 — Operational readiness (Session 3–4)

Goal: Close P5 deployment and observability items.

| Item | Effort | Session |
|------|--------|---------|
| R-006 Gunicorn / WSGI | 1 day | 2 ✓ |
| R-007 Dockerfile | 1 day | 2 ✓ |
| R-022 Structured logging | 1 day | 2 ✓ |

### Phase 4 — Maintainability and frontend (Sessions 4–5)

Goal: Close P7 maintainability items and extract JS.

| Item | Effort | Session |
|------|--------|---------|
| R-014 Extract JS to static/main.js | 3 days | 2 ✓ |
| R-015 Replace confirm() with dialog | 1 day | 2 ✓ |
| R-016 CSS/JS breakpoint sync | 2 hours | 2 ✓ |
| R-018 download() anchor timing | 30 min | 2 ✓ |

### Phase 5 — Testing coverage (Session 3)

Goal: Close P6 testing items.

| Item | Effort | Session |
|------|--------|---------|
| R-026 Playwright E2E suite | 2 weeks | 3 ✓ |

### Phase 6 — Scalability (Session 3)

Goal: Close P8 scalability items.

| Item | Effort | Session |
|------|--------|---------|
| R-019 SQLite migration | 2 weeks | 3 ✓ |
| R-020 Audit trail (with SQLite) | 3 days | 3 ✓ |
| R-021 Backup strategy | 1 day | 3 ✓ |
| R-011 Pagination (after SQLite) | 1 week | 3 ✓ |
| R-017 Virtual scrolling | 1 week | 4 ✓ |

---

## Dependency graph

```
R-001 (lock fix)
  └─► R-009 (delete race test)
  └─► R-019 (SQLite migration — lock semantics must be correct first)

R-005 (Flask upgrade)
  └─► R-008 (CI must run with new versions)

R-004 (self-host PDF.js)
  └─► R-014 (JS extraction — do R-004 first to fix import path once)
      └─► R-015 (confirm dialog — implement in clean extracted file)
      └─► R-016 (CSS/JS breakpoints — implement in clean extracted file)
      └─► R-018 (download anchor — implement in clean extracted file)
      └─► R-026 (E2E tests — stable file structure needed)

R-010 (bare except)
  └─► R-022 (structured logging — correct logger must exist first)

R-019 (SQLite)
  └─► R-011 (pagination — much easier with SQL)
      └─► R-017 (virtual scroll — needs paginated API)
  └─► R-020 (audit trail — implement in same migration)
  └─► R-021 (backup — SQLite .backup() API)

R-008 (CI)
  └─► R-026 (E2E — needs CI to run)
  └─► R-004 (self-hosting — validate in CI)
```

---

## Completed items — Session 1 summary

All nine P1–P4 implementation items and the three P5 quick-wins were completed in Session 1.

See progress-report.md for detailed evidence.

---

## Completed items — Session 2 summary

All P3 security hardening items (R-004, R-013), all P5 ops-readiness items (R-006, R-007, R-022), and all P7 maintainability items (R-014, R-015, R-016, R-018) were completed in Session 2.

See progress-report.md for detailed evidence.

---

## Completed items — Session 3 summary

R-019 (SQLite migration), R-020 (audit trail), R-021 (export endpoint), R-026 (Playwright E2E suite), and R-011 (cursor-based pagination) were all completed in Session 3. Only R-017 (virtual scrolling) remains.

See progress-report.md for detailed evidence.

---

## Completed items — Session 4 summary

R-017 (virtual scrolling) closed. `sidebar.selectMake()` in `static/main.js` now renders the model list in batches of `MODEL_RENDER_BATCH_SIZE` (60), driven by an `IntersectionObserver` sentinel at the bottom of `#model-list`; `api.listPdfs()` requests bounded pages (`PDFS_PAGE_SIZE = 200`) and `loadFileList()` repaints as pages stream in. New E2E test `TestVirtualScrolling` verifies incremental rendering against a real browser.

This closes the last open finding. **Programme status: 26/26 resolved (25 CLOSED + 1 ACCEPTED_RISK) — 100%.**

See progress-report.md for detailed evidence.

---

## Next session objectives

None outstanding. All findings are CLOSED or ACCEPTED_RISK (R-002, re-evaluate only on a hosting-model change per RR-001). Future work is net-new feature request territory, not remediation backlog.
