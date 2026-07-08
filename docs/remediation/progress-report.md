# Remediation Progress Report

Per-session log of the remediation programme. Newest first. See [backlog.md](backlog.md) for
live item state and [master-plan.md](master-plan.md) for sequencing.

---

## Session 1 — 2026-07-08

**Focus:** Stand up the programme (5 artefacts) and run Cycle 1 — the security/ops quick wins the
audit rated highest-leverage.

### Delivered (all VALIDATED — implemented, tests green, docs updated; CLOSE on merge)

| ID | What | Evidence |
|----|------|----------|
| SEC-DEP-01 | **Flask 3.1.1 → 3.1.3 (CVE-2026-27205)** — found by the new scanner | `pip-audit` now reports *no known vulnerabilities* |
| REM-SEC-02a | `pip-audit --strict` CI gate | `.github/workflows/ci.yml` quality job |
| REM-SEC-02b | Dependabot (pip + actions + docker) | `.github/dependabot.yml` |
| REM-SEC-02c | Base image digest-pinned | `Dockerfile` `FROM python:3.12-slim@sha256:423ed6…` (verified via `docker inspect`) |
| REM-SEC-02e | Runtime/dev dependency split (smaller image) | `requirements.txt` (runtime) + `requirements-dev.txt` |
| REM-SEC-03 | Werkzeug debugger opt-in (`CRANE_DEBUG`) | `app.py` `__main__` |
| REM-SEC-04 | CSP `object-src 'none'` | `test_csp_header_has_nonce_matching_inline_scripts` |
| REM-OPS-01a | Ruff lint CI gate | ci.yml; `ruff check` clean (fixed 7 test-only lint issues) |
| REM-OPS-01c | Coverage gate `--cov-fail-under=80` | ci.yml; measured **82.48%** |
| REM-OPS-02 | Reference compose (IaC) | `deploy/compose.example.yml` |
| REM-OPS-03 | Backup-scheduler health in `/api/backup` | `test_backup_status_reports_scheduler_health` |
| REM-OPS-04 | Healthcheck `urlopen(timeout=3)` | `Dockerfile` |

### Test status
- **88 backend + 24 E2E = 112 passing** (was 87 + 24). Backend coverage 82.48% (gate 80%).
- Ruff clean; pip-audit clean.

### Risks removed
- **Live Flask CVE-2026-27205** eliminated (was shipping in every image).
- **Silent vulnerable-dependency drift** — now caught by pip-audit gate + Dependabot.
- **Non-reproducible base image** — pinned by digest.
- **Invisible backup-scheduler failure** — now surfaced via API.
- **Debug-server RCE footgun** — debugger no longer on by default.

### Risks introduced
- Digest pin means base-image security updates require an explicit refresh (Dependabot `docker`
  ecosystem mitigates; refresh command documented in the Dockerfile).
- `--cov-fail-under=80` can now fail CI on a coverage regression (intended).

### Dependencies changed / discovered
- **REM-DATA-01 (FK) reclassified `IN_ANALYSIS`** — depends on REM-MAINT-03 (connection helper),
  `ON UPDATE/DELETE CASCADE`, and a table-rebuild migration (naive FK breaks the crane-rename path).
- **REM-TEST-03 → SUPERSEDED** by REM-OPS-01c (coverage now gated).
- **REM-DEP-02 → SUPERSEDED** by the SEC-02 dependency-posture items.
- New items created: SEC-DEP-01, REM-SEC-02e, REM-MAINT-06.

### Backlog movement
- Opened programme with **38 items**. After Cycle 1: **12 VALIDATED**, **7 ACCEPTED_RISK**,
  **2 SUPERSEDED**, **17 open** (1 IN_ANALYSIS, 16 NOT_STARTED).

### Remaining effort
≈ **11–14 engineer-days** across Tranches 2–6 (see master-plan).

### Next session (highest priority)
1. **Tranche 2** CI hardening: REM-OPS-01d (bandit), REM-OPS-01e (trivy image scan), REM-SEC-02d
   (hash-pinned deps). Low-risk, finishes the security-gate story.
2. Then **Tranche 3**: REM-MAINT-03 (`db.py`) as the enabler for the FK + read-consistency work.

### Ship note
All Cycle-1 changes are on branch `remediation/cycle-1`, tests green, awaiting the operator's
merge decision. Items move `VALIDATED → CLOSED` on merge to `main`.
