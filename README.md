# Crane Charts

A self-hosted Flask app for cataloguing crane load-chart PDFs. A **crane** is identified by
manufacturer, type, model, and rated capacity, and owns **one or more PDFs** (the main load
chart plus any supplementary sheets). The sidebar groups cranes hierarchically
(Manufacturer → Type → Model); the viewer renders PDFs inline with a self-hosted PDF.js and
can **search inside** the open document.

Current release: **v1.3.2** · Image: `ghcr.io/huttonhomehub/crane-charts`

```
┌───────────────────────────────────────────────────────────────┐
│  ▤ Crane Charts 1.3.2   🔍 search…          ☼  ?  [+ Upload]  │  app bar (+ version badge)
├──────────────┬────────────────────────────────────────────────┤
│ Manufacturer │  Manufacturer  Type  Model  Capacity           │  info bar
│  ⏵ Liebherr  ├────────────────────────────────────────────────┤
│  ⏵ Tadano ③  │  ★ Load Chart   Outrigger   + Add file   🔍     │  file strip (multi-file crane)
│              │                                                │
│ Models       │              [ PDF rendered here ]             │  canvas well
│  Crawler …   │                                                │
│  LTM1160 ②   │           ◀  1 / 20  ▶   −  88%  +  🔍 ⬇ ⤢     │  floating toolbar
└──────────────┴────────────────────────────────────────────────┘
```

## Features

- **Multiple files per crane** — attach supplementary PDFs (outrigger charts, transport
  dimensions, …) to a crane; pick which one is the **main** file that opens by default.
  Rename file labels inline; a badge marks cranes with more than one file.
- **Bulk import** — drop a pile of PDFs (or multi-select in the picker) and they're grouped
  into cranes by the `Manufacturer Model (Label).pdf` filename convention. Fill Type +
  Capacity (with "apply to all"), pick each crane's primary, and import in one pass.
- **Command palette** — `Ctrl/Cmd+K` jumps to any crane by make, model, or type, or filters by
  capacity with a range query (`>=150`, `150+`) that lists everything at or above that tonnage,
  smallest-first. Opening a crane deep-links the URL (`…/#crane/<id>`) so it's shareable and
  bookmarkable.
- **In-PDF find** — `Ctrl/Cmd+F` (or `/`) searches inside the open chart, highlights matches,
  and jumps between them. Ideal for locating a radius/capacity value in a dense table.
- **Consistent data** — the make/type fields autocomplete from your existing catalogue, and a
  **merge manufacturers** tool in Settings fixes a mistyped make (e.g. "Liebherri" → "Liebherr")
  by moving all its cranes across in one click.
- **Drag-and-drop** — drop one PDF to create a crane (or add to the open one), or many to
  bulk-import. The upload dialog's picker is itself a drop target.
- **Fast catalogue** — cursor-paginated API and a virtual-scrolled sidebar handle large
  libraries without lag.
- **Themes, keyboard shortcuts, mobile drawer, fullscreen** — see [QA-CHECKLIST.md](QA-CHECKLIST.md).

## Deploy (Docker)

The published image has no hardcoded data path. Point `CRANE_UPLOAD_DIR`/`CRANE_DB` at one
mounted directory (this stack's `/config` convention). A `docker-compose` service:

```yaml
services:
  crane-charts:
    container_name: crane-charts
    image: ghcr.io/huttonhomehub/crane-charts:1.3.2   # or :latest
    ports:
      - 5000:5000
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/London
      - CRANE_TRUST_PROXY=1              # required when behind a reverse proxy (nginx)
      - CRANE_UPLOAD_DIR=/config/uploads
      - CRANE_DB=/config/crane.db
    volumes:
      - /apps/crane-charts/config:/config
    restart: unless-stopped
```

`docker-entrypoint.sh` remaps the image's `crane` user to `PUID`/`PGID` and fixes ownership
of the mounted directory at start, so a fresh or root-owned host directory just works — no
manual `chown`. Deploying an update is `docker compose pull crane-charts && docker compose up -d
crane-charts`; assets are cache-busted, so no hard-refresh is needed (from v1.3.2 on). Confirm
the running version with the badge in the app-bar or `curl https://<host>/version`.

**Access control.** The app has no login of its own — it is designed to sit behind a gate.
In this deployment that's **tinyauth** via an nginx `auth_request` on every path (see
[docs/remediation/risk-register.md](docs/remediation/risk-register.md), RR-001). The nginx
`location /` must forward `X-Forwarded-Proto`/`X-Forwarded-For`/`Host` for `CRANE_TRUST_PROXY=1`
to work (the CSRF cookie's `Secure` flag and rate-limit keying depend on it).

### Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `CRANE_UPLOAD_DIR` | `uploads` | PDF storage directory |
| `CRANE_DB` | `crane.db` | SQLite database path |
| `CRANE_MAX_UPLOAD_MB` | `500` | Max upload size (MB) |
| `CRANE_MAX_FIELD_LEN` | `64` | Max characters per metadata field |
| `CRANE_UPLOAD_RATE` / `CRANE_WRITE_RATE` | `60 per minute` | Flask-Limiter limits for upload / other mutations |
| `CRANE_TRUST_PROXY` | `0` | Set `1` **only** behind a single reverse-proxy hop |
| `CRANE_VERSION` | `dev` | Release label (set from the image tag at build time) |
| `CRANE_BACKUP_DIR` | `<data>/backups` | Where periodic backups are written |
| `CRANE_BACKUP_INTERVAL_HOURS` | `24` | Backup interval |
| `CRANE_BACKUP_KEEP` | `7` | How many backups to retain |
| `CRANE_BACKUP_ENABLED` | `1` | Set `0` to disable the backup scheduler |
| `CRANE_BACKUP_INCLUDE_UPLOADS` | `1` | Set `0` for DB-only backups (when PDFs live on snapshotting storage) |
| `CRANE_MAX_RESTORE_MB` | `4096` | Max uncompressed size of a restore archive (zip-bomb guard) |

### Backups & restore

The app writes periodic **full backups** — a consistent `crane.db` snapshot plus a zip of
`uploads/` — to `CRANE_BACKUP_DIR`, pruned to `CRANE_BACKUP_KEEP`. The **Settings** panel (the
app-bar gear) shows backup status, a "Back up now" button, and a list of existing backups you can
download or **Restore** in place — plus an **Upload & restore** control to recover from a
downloaded zip on a fresh instance. A restore replaces the whole catalogue (database + PDFs) and
first takes a `…-prerestore.zip` safety backup, so it's reversible. (You can still restore by hand
if you prefer — `crane.db` and `uploads/` sit at the zip root.)

For real safety, point `CRANE_BACKUP_DIR` at a **separate mount** (e.g. a NAS share) so a
single-disk failure doesn't take the backups with it:

```yaml
    environment:
      - CRANE_BACKUP_DIR=/backups
    volumes:
      - /apps/crane-charts/config:/config
      - /mnt/truenas/crane-backups:/backups
```

Note: keep the *live* `crane.db` on local/block storage — SQLite's WAL locking is unreliable
over NFS/SMB. The PDFs, being plain write-once files, are safe on a network share, so a good
split is **DB local, `CRANE_UPLOAD_DIR` on a NAS**:

```yaml
    environment:
      - CRANE_DB=/config/crane.db               # database → local
      - CRANE_UPLOAD_DIR=/pdfs                   # PDFs → NAS
      - CRANE_BACKUP_INCLUDE_UPLOADS=0           # NAS/ZFS already snapshots the PDFs
    volumes:
      - /apps/crane-charts/config:/config
      - /mnt/truenas/crane-pdfs:/pdfs
```

With PDFs on storage that snapshots itself (e.g. TrueNAS/ZFS), set
`CRANE_BACKUP_INCLUDE_UPLOADS=0` so backups are DB-only — small and fast — and rely on the
NAS's own snapshots for the documents.

## Develop

```bash
pip install -r requirements.txt        # Flask 3.1.1, gunicorn, Flask-Limiter, pytest-playwright
python -m playwright install chromium  # once, for the E2E suite
make dev                               # Flask debug server on :5000 (or: flask --debug run)
make serve                             # Gunicorn, as in production

pytest tests/                          # unit + integration (64 tests, ~1s)
pytest tests/e2e/                      # Playwright E2E (15 tests; needs Chromium)
```

Architecture, invariants, and the full route/behaviour reference for contributors (and AI
assistants) live in **[CLAUDE.md](CLAUDE.md)**. Version history is in
**[CHANGELOG.md](CHANGELOG.md)**.

## Architecture (short)

Single Flask process. State is the `uploads/<crane_id>/` directories plus `crane.db` (SQLite:
`cranes`, `files`, `spec_events` audit log). The frontend is an extracted ES module
[static/main.js](static/main.js) loaded by [templates/index.html](templates/index.html);
PDF.js is self-hosted under `static/vendor/`. Security: CSRF double-submit cookie, strict CSP
with per-request nonce, rate limiting, `ProxyFix` behind the proxy. See [CLAUDE.md](CLAUDE.md).

### API

All `/api/*` endpoints return JSON; errors are uniformly `{ "error": "…" }`. Mutating routes
(`POST`/`PUT`/`PATCH`/`DELETE`) require the `X-CSRF-Token` header matching the `crane_csrf`
cookie.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/pdfs?after=<id>&limit=<n>` | List cranes (paginated); each item has `files[]` + primary `url` |
| `POST` | `/api/upload` | Create a crane from its first PDF (+ optional `label`) |
| `POST` | `/api/cranes/<id>/files` | Attach a supplementary PDF (+ optional `label`) |
| `PUT` | `/api/cranes/<id>/primary` | Set the main file (`{file_id}`) |
| `PATCH` | `/api/cranes/<id>/files/<file_id>` | Rename a file's label |
| `DELETE` | `/api/cranes/<id>/files/<file_id>` | Delete one file (last file → deletes the crane) |
| `PUT` | `/api/metadata/<id>` | Edit crane make/type/model/capacity |
| `DELETE` | `/api/delete/<id>` | Delete a whole crane |
| `GET` | `/api/export` | Download the catalogue as JSON (backup) |
| `GET` | `/uploads/<id>/<file>` | Serve a stored PDF |
| `GET` | `/health`, `/version` | Liveness + running version |

## History

Crane Charts began as a small app and was hardened by a 2026-07-06 engineering deep-dive
(all findings resolved — see [docs/remediation/](docs/remediation/)), then grew the feature
set above across v1.1–v1.3. See [CHANGELOG.md](CHANGELOG.md) for the release-by-release story
and [docs/remediation/decision-log.md](docs/remediation/decision-log.md) for the rationale
behind the notable design decisions.
