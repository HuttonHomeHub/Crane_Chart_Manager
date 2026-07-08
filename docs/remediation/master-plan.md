# Remediation Master Plan

Programme to drive every finding from the 2026-07-08 engineering audit to a terminal state
(`CLOSED`, `ACCEPTED_RISK`, or `SUPERSEDED`). This is the control document; the live item
state lives in [backlog.md](backlog.md), rationale in [decision-log.md](decision-log.md),
residual risk in [risk-register.md](risk-register.md), and per-session deltas in
[progress-report.md](progress-report.md).

## Objective & definition of done

The programme is complete when **all 38 backlog items** are `CLOSED`, `ACCEPTED_RISK`, or
`SUPERSEDED`, and every decision is recorded. "Fixed" is not enough — an item may terminate as
accepted risk (with conditions) or superseded (with the replacing item named).

## Prioritisation policy

Primary ordering is the audit's P1→P8 bands (data-loss → authn → security → dependency → ops →
testing → maintainability → scalability). **Within** a band, work is selected by *value ÷ effort*
and by dependency readiness. Two deliberate deviations from strict band order, both justified:

1. **Security/dependency quick wins were pulled forward in Cycle 1.** The audit's own conclusion
   was that CI security guardrails are the single highest-leverage work (nothing automatically
   caught a vulnerable dependency). Cycle 1 proved this immediately — the new scanner found a live
   Flask CVE.
2. **P1 data-integrity item REM-DATA-01 (foreign keys) was *not* done first**, despite its band,
   because impact analysis (below) revealed it depends on other work. Doing it naively would break
   the crane-rename path. This is exactly the reordering the programme mandates.

## The implementation cycle (run every session)

1. **Review backlog** — load all five artefacts, reconstruct state.
2. **Identify dependencies** — for candidate items, check `Deps` and downstream effects.
3. **Select highest-value work** — P-band × readiness × value/effort.
4. **Implement** — smallest cohesive change; never bundle unrelated churn.
5. **Run tests** — full suite (`pytest tests/`), ruff, pip-audit; add tests for new behaviour.
6. **Update backlog** — statuses, resolutions, evidence; record newly-discovered items/deps.
7. **Recalculate priorities** — retire superseded items; reorder on new dependencies.

An item may not pass to `VALIDATED` until: code implemented · tests pass · docs updated ·
dependent items reviewed. It passes to `CLOSED` on merge to `main`.

## Impact-analysis ledger (dependencies discovered by analysis, not just listed in the audit)

| When | Change considered | Impact discovered | Backlog effect |
|------|-------------------|-------------------|----------------|
| Cycle 1 | Enable FK constraints (REM-DATA-01) | `UPDATE cranes SET id=…` in the rename/merge paths would violate a naive FK; existing DBs need a table rebuild to gain the constraint | DATA-01 → `IN_ANALYSIS`; now depends on REM-MAINT-03 (connection helper) + `ON UPDATE/DELETE CASCADE` + migration. Deferred out of Cycle 1. |
| Cycle 1 | Add `pip-audit` to CI (REM-SEC-02a) | Immediately surfaced Flask CVE-2026-27205 | New item **SEC-DEP-01** created and fixed same cycle |
| Cycle 1 | Move dev tools to CI | They were being installed into the runtime image via `requirements.txt` | New item **REM-SEC-02e** (split runtime/dev deps) — done; smaller image |
| Cycle 1 | Expand ruff ruleset | I/B/UP + `ruff format` would rewrite the whole tree (noisy) incl. a real `raise…from` fix | New item **REM-MAINT-06**; kept enforced gate on default rules only |
| Cycle 1 | Coverage gate (REM-OPS-01c) | Makes standalone T3 redundant | **REM-TEST-03 → SUPERSEDED** |

## Sequenced roadmap (tranches)

- **Tranche 1 — Security/Ops quick wins (Cycle 1, DONE):** SEC-DEP-01, REM-SEC-02a/b/c/e,
  REM-SEC-03, REM-SEC-04, REM-OPS-01a/c, REM-OPS-02, REM-OPS-03, REM-OPS-04. *All VALIDATED.*
- **Tranche 2 — Ops hardening finish:** REM-OPS-01d (bandit), REM-OPS-01e (trivy), REM-SEC-02d
  (hash-pin). Low-risk CI-only.
- **Tranche 3 — Backend integrity foundation:** REM-MAINT-03 (`db.py`) → unlocks REM-DATA-01
  (FK+cascade+migration) and REM-SCALE-03 (transactional merge/restore) and REM-DATA-02
  (corrupt-DB 503). Do the connection layer first, then FK, then the read-consistency work.
- **Tranche 4 — Scalability P8:** REM-SCALE-01 (SQL pagination) + REM-SCALE-04 (client search),
  co-designed so the client stops eager-loading all pages.
- **Tranche 5 — Frontend maintainability + testing:** REM-MAINT-02 (module split) → REM-TEST-01
  (Vitest) → REM-MAINT-01 (types) → REM-MAINT-05/08 (error boundary, a11y). REM-TEST-02 (E2E
  isolation) alongside.
- **Tranche 6 — Cleanups:** REM-MAINT-04 (app factory), REM-MAINT-06 (ruff format), REM-DATA-03
  (audit index), REM-MAINT-07 + REM-TEST-04 (slug edge cases), REM-OPS-06 (/metrics).
- **Accepted-risk register (no code):** REM-AUTH-01, REM-SCALE-02, REM-SEC-05, REM-SEC-06,
  REM-DATA-04, REM-DATA-05, REM-DEP-01 — documented, revisit triggers noted.

## Remaining-effort estimate (rough, engineer-days)

| Tranche | Items | Est. |
|---------|-------|------|
| 1 (done) | 12 | — |
| 2 | 3 | 0.5 |
| 3 | 4 | 3–4 |
| 4 | 2 | 1.5–2 |
| 5 | 5 | 4–6 |
| 6 | 5 | 2 |
| **Remaining total** | **19** | **≈ 11–14 d** |

Accepted-risk items carry 0 implementation effort (documentation only, already done).
