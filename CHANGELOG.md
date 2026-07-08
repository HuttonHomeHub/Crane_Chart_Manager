# Changelog

All notable changes to Crane Charts. Versions are the published Docker image tags
(`ghcr.io/huttonhomehub/crane-charts:<version>`). Rationale for the bigger decisions is in
[docs/remediation/decision-log.md](docs/remediation/decision-log.md).

## v1.7.0 — find & data hygiene
- **Command palette** (`Ctrl/Cmd+K`, or click the search box's hint): jump to any crane by
  make, model, or type — fuzzy substring match — or filter by capacity with a range query
  (`>=150`, `>150`, `≥150`, or `150+`), which lists every crane at or above that tonnage
  sorted smallest-first. ↑↓ to navigate, ↵ to open, Esc to close.
- **Deep-link URLs**: opening a crane updates the address bar to `…/#crane/<id>`; sharing or
  bookmarking that link opens straight to the crane on load. Back/forward navigate between
  viewed cranes.
- **Manufacturer autocomplete**: the make and type fields (upload modal *and* bulk-import grid)
  now suggest existing values from your catalogue, so spellings stay consistent.
- **Merge manufacturers** tool in Settings: pick a mistyped make and the correct one, and every
  crane moves across — re-slugged where the target name is free, absorbed (files merged) where a
  crane already exists. Fixes "Liebherri" → "Liebherr" in one click.
- New: `GET /api/facets`, `POST /api/merge-make`. (DL-029)

## v1.6.0 — settings panel
- The app-bar **gear** opens a **Settings** panel: a **Backups** card (status, schedule,
  "Back up now", "Download fresh", and a list of existing backups you can download
  individually) and a **This instance** card (version, catalogue counts, data/PDF/backup
  paths, limits, proxy) — plus the metadata export link.
- It's **read-only** — deployment config stays in compose (some is read-once at start, and
  `CRANE_TRUST_PROXY` is a security control that shouldn't be UI-toggleable).
- New: `GET /api/info`, `GET /api/backup/download/<name>`. The standalone backup button became
  the Settings gear. (DL-028)

## v1.5.0 — automated backups
- Closes the last real risk (RR-010): the app now writes periodic **full backups** — a
  consistent `crane.db` snapshot (SQLite online-backup API) plus a zip of `uploads/` — to
  `CRANE_BACKUP_DIR` (default `<data>/backups`) on a schedule (`CRANE_BACKUP_INTERVAL_HOURS`,
  default 24), pruned to `CRANE_BACKUP_KEEP` (default 7). Point `CRANE_BACKUP_DIR` at a
  separate mount (e.g. a TrueNAS share) for off-host copies. Disable with
  `CRANE_BACKUP_ENABLED=0`.
- **Download backup** button in the app-bar (streams a fresh zip); `GET /api/backup` (status),
  `POST /api/backup` (backup now / host-cron hook), `GET /api/backup/download`.
- `CRANE_BACKUP_INCLUDE_UPLOADS=0` makes backups **DB-only** — for when the PDFs
  (`CRANE_UPLOAD_DIR`) live on storage that snapshots itself (e.g. TrueNAS/ZFS), so re-zipping
  them each run would be redundant. (DL-027)

## v1.4.3 — deterministic `:latest` (build fix)
- No app changes. Fixed the publish pipeline: previously both the main-branch build (which
  labelled itself `latest`) and the tag build (`1.4.x`) pushed `:latest` and raced, so the
  version badge on `:latest` flip-flopped between the real version and the word "latest".
  Images are now published **only on version tags**, so `:latest` is always the latest
  release and carries its real version. (CI still runs on every main push.)

## v1.4.2 — capacity placement + tooltip removal
- Capacity now sits **right after the model name** (`LTM1050-3.1 · 50t`, muted) instead of
  right-aligned by the edit buttons, which read as an awkward gap.
- Removed the model-row hover tooltip — with the name and capacity both on the row it only
  repeated what was already visible.

## v1.4.1 — inline capacity in the model list
- Capacity now sits on the same line as the model name (right-aligned) instead of stacked
  below it — halves the row height and lines capacities up in a scannable column. The
  file-count badge moves inline between the two.

## v1.4.0 — sidebar usability
- **Wider Models column** (sidebar rebalanced to `148px 1fr`, 430px) so model names like
  `LTM1090-4.1` aren't truncated; tighter model rows so long catalogues scroll less.
- **Collapsible type groups** — click a type header (now a button with a chevron + count) to
  fold that group away.
- **Smarter search** — a manufacturer stays in the list when the query matches any of its
  cranes' model/capacity/type/label, not just the make name (so searching `500t` keeps the
  makes that *have* a 500t crane); searching also expands any collapsed groups.
- Fixed a pre-existing bug: model names were centre-aligned (the row body is a `<button>`).
  (DL-026)

## v1.3.2 — asset cache-busting + version indicator
- `main.js`/`main.css` URLs now carry a content-hash `?v=` (`versioned_static()`), so a new
  deploy always serves fresh assets — **no more hard-refresh after updates** (from this
  release on; the upgrade *to* 1.3.2 still needs one).
- Version badge in the app-bar; `GET /version` endpoint; `version` added to `/health`.
- `CRANE_VERSION` flows from the image tag via a Docker build-arg. (DL-025)

## v1.3.1 — modal drop target + inline errors
- The upload dialog's "Click to choose a PDF" box is now a real drop target.
- Errors during a modal action (e.g. duplicate upload) show **inline in the dialog** instead
  of a toast that rendered behind the native `<dialog>` top-layer backdrop. (DL-024)

## v1.3.0 — bulk import
- Drop many PDFs (or multi-select) → a grid groups them into cranes by the
  `Manufacturer Model (Label).pdf` convention. Fill Type + Capacity ("apply to all"), pick
  each multi-file crane's primary, import sequentially with per-row ✓/✗ and 429 retry.
- Single-file upload now prefills make/model from the filename.
- Upload rate limit raised to 60/min and made configurable (`CRANE_UPLOAD_RATE`/
  `CRANE_WRITE_RATE`); `POST /api/upload` accepts an optional `label`.
- Fixed: `Ctrl+F` (find) also toggled fullscreen. (DL-023)

## v1.2.0 — editable labels, drag-to-add, in-PDF find
- Rename a file's label from its strip chip (`PATCH /api/cranes/<id>/files/<file_id>`).
- Dropping a PDF while a crane is open offers to add it to that crane (with a "new crane
  instead" escape).
- **In-PDF find**: `Ctrl/Cmd+F` or `/` searches the open document, highlights matches, and
  navigates between them. (DL-022)

## v1.1.0 — multiple files per crane
- Broke the original 1:1 "a crane *is* its PDF" model into `cranes` (1) → `files` (N). The
  crane slug stays the identity (`cranes.id` + the `uploads/<crane_id>/` directory);
  `cranes.primary_file` points at the default-open file.
- Viewer "file strip": switch files, set the main one (★), delete, add. Sidebar file-count
  badge.
- One-time, idempotent migration of the old single-file `specs` table into the new model on
  first boot. (DL-021)

## v1.0.1 — PUID/PGID entrypoint
- `docker-entrypoint.sh` remaps the container user to `PUID`/`PGID` and self-heals bind-mount
  ownership, so no host-side `chown` is needed. Added `.dockerignore`. (R-028)

## v1.0.0 — engineering remediation programme
Resolved every finding from the 2026-07-06 engineering deep-dive (see
[docs/remediation/](docs/remediation/)). Headlines:
- **Data & concurrency**: SQLite (`cranes`/`files`/`spec_events`) replacing the flat
  `metadata.json`; `threading.Lock`; audit trail; cursor pagination; export endpoint.
- **Security**: CSRF double-submit cookie, strict CSP with per-request nonce, self-hosted
  PDF.js, rate limiting, secondary security headers, PDF magic-byte validation.
- **Ops**: Gunicorn, Dockerfile, GitHub Actions CI + image publish, structured JSON logging,
  health check, env-var configuration, reverse-proxy (`ProxyFix`) support.
- **Frontend & quality**: JS extracted to `static/main.js`, accessible `<dialog>` confirms,
  virtual-scrolled sidebar, Playwright E2E suite.

---

*Deployment: `docker compose pull crane-charts && docker compose up -d crane-charts`. No
database migration is needed for any release after v1.1.0. Always keep a copy of the mounted
`/config` directory before a major upgrade (there is no automated backup yet — see RR-010).*
