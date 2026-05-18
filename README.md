# Crane Charts

A self-contained Flask app for cataloguing crane specification PDFs. Each upload is tagged
with manufacturer, type, model, and rated capacity; the sidebar groups documents
hierarchically (Manufacturer → Type → Model) and the viewer renders the PDF inline with
PDF.js.

```
┌───────────────────────────────────────────────────────────────┐
│  ▤ Crane Charts   🔍 search…                ☼  ?  [+ Upload]  │  app bar
├──────────────┬────────────────────────────────────────────────┤
│ Manufacturer │  Manufacturer  Type  Model  Capacity           │  info bar
│  ⏵ Liebherr  ├────────────────────────────────────────────────┤
│  ⏵ Gottwald  │                                                │
│              │              [ PDF rendered here ]             │  canvas well
│ Models       │                                                │
│  Crawler …   │                                                │
│  LR1160 160t │           ◀  1 / 20  ▶   −  88%  +   ⬇  ⤢      │  floating toolbar
└──────────────┴────────────────────────────────────────────────┘
```

## Run

```bash
flask --debug run                 # development server with auto-reload
pytest tests/                     # backend test suite (23 tests, ~0.2s)
```

The app is a single Flask process. State lives in two places: PDFs in `uploads/`, metadata
in `metadata.json`. There is no database.

## Architecture

```
app.py                  ← Flask app + 5 routes + CSRF guard + CSP header + file lock
templates/index.html    ← single template, inline ES-module script, native <dialog> modals
static/main.css         ← design tokens + components, dark/light themes via [data-theme]
uploads/                ← PDF storage; filename is a slug of make_type_model_capacity.pdf
metadata.json           ← per-file record keyed by filename (atomic write via tmp+rename)
metadata.json.lock      ← fcntl flock target — serialises concurrent metadata mutations
tests/                  ← pytest backend coverage
```

PDF.js loads from cdnjs as an ES module (`pdf.min.mjs`) plus a module worker
(`pdf.worker.min.mjs`). Both are preloaded in `<head>` to overlap fetch with parsing.

## API

All `/api/*` endpoints respond with JSON. Errors uniformly return
`{ "error": "<message>" }` via the global `HTTPException` handler.

| Method   | Path                          | Auth     | Body                                                | Returns                                                                                            |
|----------|-------------------------------|----------|-----------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `GET`    | `/`                           | —        | —                                                   | Renders the SPA. Sets the `crane_csrf` cookie if absent.                                           |
| `GET`    | `/api/pdfs`                   | —        | —                                                   | `[{ name, url, size, make, type, model, capacity, uploaded_at, updated_at?, original_filename }]`  |
| `POST`   | `/api/upload`                 | CSRF     | multipart: `file` + `make`/`type`/`model`/`capacity`| 201 `{ success, name, url, make, type, model, capacity }` · 409 if filename collides · 400/413     |
| `PUT`    | `/api/metadata/<filename>`    | CSRF     | JSON: `{ make, type, model, capacity }`             | 200 `{ success, renamed, name, url, [old_name], make, type, model, capacity }` · 404 / 400 / 409   |
| `DELETE` | `/api/delete/<filename>`      | CSRF     | —                                                   | 200 `{ success }` · 404                                                                            |
| `GET`    | `/uploads/<filename>`         | —        | —                                                   | Raw PDF bytes · 404 `{ error: "File not found" }`                                                  |

### CSRF (double-submit cookie)

* On every response the server sets a non-HttpOnly `crane_csrf` cookie (`SameSite=Strict`)
  containing a 32-byte URL-safe random token, if not already present.
* The client reads the cookie and echoes its value in the `X-CSRF-Token` header on every
  `POST`/`PUT`/`PATCH`/`DELETE`.
* `_csrf_guard` compares cookie to header with `secrets.compare_digest`.
* `GET` is exempt.

### Filename slug

`generate_filename(make, type, model, capacity)` lowercases each field, replaces spaces
and slashes with `_`, joins with `_`, appends `.pdf`, then strips anything that isn't
`[a-zA-Z0-9._-]`. Each field is capped at 64 characters; over-length inputs return 400.

Example: `("Liebherr", "Mobile Crane", "LTM 1200-3.1", "200 t")` → `liebherr_mobile_crane_ltm_1200-3.1_200_t.pdf`.

The filename is the storage key in both `uploads/` and `metadata.json`. Editing a field
that affects the slug renames the file on disk; the old metadata row is moved to the new
key (`renamed: true` in the response).

### Metadata schema

`metadata.json` is a flat JSON object keyed by filename:

```jsonc
{
  "liebherr_mobile_crane_telescopic_ltm1030-2_30_t.pdf": {
    "make": "Liebherr",                              // displayed; used in slug
    "type": "Mobile Crane (Telescopic)",             // displayed; used in slug
    "model": "LTM1030-2",                            // displayed; used in slug
    "capacity": "30 t",                              // displayed; used in slug
    "uploaded_at": "2026-05-18T08:59:12.972104",     // ISO; preserved across edits
    "original_filename": "Liebherr_LTM1030-2.1.pdf", // user's original; used for download
    "updated_at": "2026-05-18T10:19:58.622483"       // optional; set only on edit
  }
}
```

Writes are atomic (write `metadata.json.tmp` → fsync → `os.replace`), and the whole
load-mutate-save sequence is serialised by an `fcntl.flock` on `metadata.json.lock` so
concurrent uploads/edits can't lose entries.

If the file is unreadable or contains valid-but-not-an-object JSON, `load_metadata`
logs and returns `{}`; the next write rewrites a valid file.

## Frontend

Single inline ES module. The module performs `await import(...)` of PDF.js, then divides
its body into labelled regions: `STATE`, `API`, `TOAST`, `THEME`, `MODAL`, `METADATA MODAL`,
`SHORTCUTS`, `DROPZONE`, `SIDEBAR`, `VIEWER`, `INIT`. Top-of-module helpers (`$`, `$$`,
`csrfToken`, `isMac`, `localizeKbds`) are shared across regions.

Modals use the native `<dialog>` element — `showModal()` gives focus trap, Esc handling,
top-layer rendering, and a `::backdrop` pseudo-element. There is no manual stack management.

Themes are CSS-only: design tokens in `:root` + `:root[data-theme="light"]`, with a tiny
pre-paint script in `<head>` that reads `localStorage.crane.theme` and applies it before
the stylesheet evaluates (so there's no flash of wrong theme on reload).

Keyboard shortcuts: `⌘/Ctrl + K` focus search, `⌘/Ctrl + U` open upload, `← →` page,
`+ −` zoom, `F` fullscreen, `?` shortcuts overlay, `Esc` close. The kbd hint chips are
rendered with the correct modifier glyph at first paint via server-side `User-Agent`
detection (no FOUC), then re-checked client-side as a fallback.

## Content Security Policy

Every response carries:

```
default-src 'self';
script-src 'self' 'nonce-<random>' https://cdnjs.cloudflare.com;
worker-src 'self' https://cdnjs.cloudflare.com;
style-src  'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src   'self' https://fonts.gstatic.com;
img-src    'self' data:;
connect-src 'self' https://cdnjs.cloudflare.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

The two inline `<script>` blocks (pre-paint theme + main module) each carry a fresh
per-request nonce. `script-src` is strict — no `'unsafe-inline'`, no `'unsafe-eval'`.
`style-src` retains `'unsafe-inline'` because PDF.js dynamically sets
`canvas.style.width/height` per-frame; everywhere else, inline styles were extracted to
CSS classes.

## Testing

The pytest suite at `tests/test_app.py` covers:

* CSRF guard (rejection without header, exemption of GETs, nonce match in CSP)
* Upload / edit (rename + in-place) / delete round trip
* Validation (non-PDF rejection, per-field 64-char cap, missing fields, JSON
  serialisation of HTTPExceptions, no-path-leak on missing-file download)
* Metadata persistence (atomic write, corrupted-JSON recovery, non-dict shape rejection)
* Concurrent metadata writes through `metadata_lock()` — N=20 contended threads, all
  entries persist
* `generate_filename` slug sanitisation and `allowed_file`

Tests use per-test temp `uploads/` and `metadata.json` (pytest `tmp_path`) so they
never touch the developer's real catalogue.

```bash
pytest tests/ -v
# 23 passed in 0.17s
```

## Manual QA

After substantial changes, run through `QA-CHECKLIST.md` in a browser. It covers the
flows that pytest can't see — theme toggle, drag-drop, modals, mobile drawer,
fullscreen, keyboard shortcuts, focus restoration on delete.

## File layout

```
.
├── app.py                  # Flask app — routes, CSRF, CSP, lock, helpers
├── templates/
│   └── index.html          # Single template; inline ES module
├── static/
│   └── main.css            # Design tokens + components; dark/light themes
├── uploads/                # PDF storage — your data
├── metadata.json           # Per-file record (atomic writes)
├── metadata.json.lock      # fcntl lock file (gitignored)
├── tests/                  # pytest suite
│   ├── conftest.py
│   └── test_app.py
├── requirements.txt        # Flask + pytest
├── QA-CHECKLIST.md         # Manual browser QA list
├── README.md               # this file
└── .gitignore              # __pycache__/, .venv/, metadata.json.{lock,tmp}
```
