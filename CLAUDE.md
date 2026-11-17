# CLAUDE.md

Guidance for AI assistants working in this repository. The rules in `~/projects/CLAUDE.md` apply here too. If the two ever disagree, the stricter one wins. This file holds only Crane Charts' own facts.

## Project

**Crane Charts**: a catalogue of crane load-chart PDFs. A crane (make, type, model, capacity) owns one or more PDFs; the sidebar groups cranes Manufacturer → Type → Model; the viewer renders PDFs with PDF.js and searches inside them. Node 22 and TypeScript: Express 5 on `@hhh/server`, React on `@hhh/ui`, the same platform as PhotoMapper. It was a Flask app until 2.0 (history in `CHANGELOG.md` and `docs/remediation/`).

## CT 106 (dev box)

- **Checks:** `sh scripts/check.sh`, from the repo root, runs exactly what CI runs (`ci.yml`'s one job calls the same script): `npm ci && npm run check` in the `node:22-bookworm` container (vendored-platform check, typecheck of the server, browser and e2e code, lint, Prettier, Vitest with coverage, the Vite build, `npm audit`), then `scripts/e2e.sh`. It writes only the gitignored `node_modules/`, `dist/`, `coverage/` and `e2e-results/`.
- **End-to-end tests:** `sh scripts/e2e.sh [filter]` builds the image, runs it on a throwaway Docker network as host `crane` with an in-memory `/config` (test data only) and roomy rate limits, and runs `e2e/` from the pinned Playwright image. The user has agreed to these running on CT 106. The tests share one server, so each makes cranes with names of its own (`uniq()` in `e2e/fixtures.ts`, which also writes real PDFs with text). The app is plain HTTP there: Chrome's notice that it ignored `Cross-Origin-Opener-Policy` is expected and allowed, nothing else. Browser-only APIs that need HTTPS (`crypto.randomUUID`, clipboard reads) must not be relied on.
- **Screenshots:** `SCREENSHOTS=1 sh scripts/e2e.sh screenshots` writes `docs/screenshots/` (both themes, desktop and phone). After a visual change, retake them and look at every one before committing.
- **Test stack:** the git-excluded `compose.yaml` (in `.git/info/exclude`) builds from the Dockerfile, keeps `/config` in the `crane-config` volume, sets `TRUST_PROXY=0` and publishes port 5000. `docker compose up -d --build`. Test data only.
- **Dev server:** `npm run server` (API on :5000) and `npm run dev` (Vite, proxying `/api`, `/uploads` and `/version`), in the Node image.

## Shared platform

- `vendor/hhh-platform/` is a vendored hhh-platform release (version in its `VERSION`). Never edit it: `npm run vendor:check` fails CI if it differs from the release. Upgrade with `node vendor/hhh-platform/scripts/vendor.ts X.Y.Z` in its own PR. The Dockerfile copies `vendor/` before `npm ci`, and into the runtime image (`@hhh/server` runs from it). `.gitignore` must say `/dist/`, not `dist/`, or the vendored `packages/server/dist` is dropped.
- TypeScript, ESLint, Prettier and Vitest come from `@hhh/config`. Three TypeScript projects: `tsconfig.json` (server, `shared/`, Node tests), `tsconfig.app.json` (browser, JSX, `tests/*.tsx`), `tsconfig.e2e.json` (Playwright tests, with the DOM for code run in the page). Imports name the `.ts`/`.tsx` file. The API's shapes live once in `shared/api.ts`; never redeclare them.
- Coverage gate: the standard's 80% of lines (measured: 96%). New code comes with tests.

## Settings

- Read once in `server/config.ts` with the kit's `loadSettings`: the shared names (`LOG_LEVEL`, `TRUST_PROXY`, `DATA_DIR`, `DB_PATH`, `UPLOADS_DIR`, `APP_VERSION`) plus Crane's own (`PORT`, `MAX_UPLOAD_MB`, `MAX_FIELD_LEN`, `UPLOAD_RATE`, `WRITE_RATE`, `BACKUP_*`, `MAX_RESTORE_MB`). Old `CRANE_` names still work (`CRANE_DB`, `CRANE_UPLOAD_DIR`, `CRANE_VERSION`, otherwise `CRANE_` + name) and are logged as deprecated by `server/index.ts`. A bad value stops startup. The full table is in the README.
- `server/paths.ts` resolves `DATA_DIR`, `DB_PATH` (`crane.db`), `UPLOADS_DIR` and `BACKUP_DIR` (`backups/` beside the database). `docker-entrypoint.sh` resolves the same paths, old names included.
- `TRUST_PROXY` is a hop count; live is `1` (nginx restores the visitor's IP from `CF-Connecting-IP`). Never set it higher than the real number of proxies.
- `deploy/compose.example.yml` is the live layout.

## Release

- Version: the `VERSION` file (`X.Y.Z`); `package.json` has none. `CHANGELOG.md` has an `## Unreleased` section with `### Added` / `### Changed` / `### Fixed`; every PR into `dev` adds its line there.
- A release is merging `dev` into `main`. `.github/workflows/publish-image.yml` then runs CI, fails if `vX.Y.Z` already exists, publishes `ghcr.io/huttonhomehub/crane-charts` as `X.Y.Z`, `X.Y`, `latest` and `sha-<short>` (passing `APP_VERSION`), and creates the `vX.Y.Z` tag and GitHub Release from that CHANGELOG section. Pushing a tag publishes nothing.
- "Ship It" follows `.claude/skills/ship-it/SKILL.md`, which sets `VERSION` and the CHANGELOG on `dev` before merging the release PR.
- `ci.yml` runs on pushes to `dev` and `claude/**` and PRs into `dev` and `main`. Its one job, `build`, is the required check.
- Dependabot (`.github/dependabot.yml`) opens weekly PRs into `dev` for npm, GitHub Actions and the Node base image. New Node major versions aren't proposed, nor `@types/node` majors: changing Node also means changing `scripts/check.sh`, the Dockerfile and `@types/node` together.

## File map

```
server/
  index.ts            Entry: settings warnings, open the database, rename 1.x backups, listen, schedule backups, graceful shutdown
  app.ts              createBaseApp … finishApp: routers, /uploads (static, range requests), the built front end
  config.ts paths.ts  Settings and data locations
  db.ts               openDb/getDb/closeDb (the handle changes after a restore), kit migrations
  migrations/         Numbered SQL (001 = 1.x's schema with IF NOT EXISTS); never edit an applied one
  cranes.ts           Every crane query, the API shape (craneFromRows), the audit log
  names.ts            1.x's naming rules: crane slug, secure_filename, _2 de-duplication, local ISO timestamps
  lock.ts             withLock: every change to files and rows together
  routes/cranes.ts    The crane API (1.x's routes and JSON)
  routes/backups.ts   /api/backup…, /api/info (the shared shapes, as PhotoMapper)
  services/backups.ts The kit's backups with prefix crane-backup; 1.x backup renaming
shared/api.ts         Request and reply types for server and browser
src/
  App.tsx             Layout, the open crane (from the #crane/<id> address), dialogs, global shortcuts
  components/         Sidebar, Viewer (file strip), PdfView (canvas, toolbar, find), MetadataDialog,
                      BulkImport, DropZone, CommandPalette, SettingsDialog, ShortcutsDialog …
  hooks/              Every API call (apiFetch, or upload() for progress): catalogue, crane and file actions, settings, the hash
  lib/                catalogue.ts (sort, group, search, palette, filename parsing), pdf.ts (fit, zoom, find, highlights),
                      pdfjs.ts (the only PDF.js import, loaded on first use), upload.ts (XHR with progress, 429 retry), keys.ts
  styles/index.css    Crane's layout on the @hhh/ui tokens
tests/                Vitest: *.test.ts (server, Node), *.test.tsx (components and hooks, jsdom)
e2e/                  Playwright, against the built image
```

## Invariants

- **The slug is the crane.** `generateCraneId(make, type, model, capacity)` is the `cranes.id` and the folder name under `uploads/`. Editing the four fields renames the folder, then updates the rows in one transaction; if that fails the folder is renamed back. Keep the pair atomic. Merge-make does the same per crane, or moves files into an existing crane when the new slug is taken.
- **Every change runs inside `withLock`**, so a file and its rows never disagree, and backups and restores never see them half-done.
- **The crane routes keep 1.x's JSON** (snake_case included): scripts and the bulk importer depend on it. The primary file is `cranes.primary_file`, else the earliest file; files are listed primary first.
- **The audit log** (`spec_events`) is append-only: `upload`, `file_add`, `primary_change`, `label_edit`, `file_remove`, `edit`, `delete`, `merge`, `restore`. `logEvent` never throws.
- **Writes need the CSRF header**: browser code calls the API through `apiFetch` (or `upload()` in `src/lib/upload.ts`, which sends the same header), never bare `fetch`; server tests write through `write()` in `tests/server.ts`.
- **Errors stay inside dialogs.** A `<dialog>` sits in the browser's top layer, so a toast shown while one is open is hidden behind it. Validation and API errors show in the dialog; toasts are for confirmations after it closes.
- **Stale async work is discarded**: `PdfView` is keyed by file URL and `Viewer` by crane id, so a slow load or render can't paint over a newer one; documents are destroyed when left.
- The sidebar renders long makes 60 rows at a time as the list scrolls; a search renders every match. Don't assume every `.model-item` is in the DOM.

## Conventions

- Named exports only; no `any`, no `!` (use `must()` in tests), no dynamic `delete`. React: no `setState` directly in an effect (derive the value, or adjust state during render when a prop changes).
- Never hard-code a colour or font size: `@hhh/ui` tokens only, in both themes. Accent text never sits on `--bg-surface-sunken`.
- New API calls go in a hook under `src/hooks/`; components never call `fetch` or `apiFetch`.
- Commits: imperative and focused.
