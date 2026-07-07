from flask import Flask, render_template, request, jsonify, send_from_directory, g
from werkzeug.exceptions import HTTPException, NotFound, RequestEntityTooLarge
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.utils import secure_filename
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from pythonjsonlogger.json import JsonFormatter
import contextlib
import json
import logging
import os
import re
import secrets
import shutil
import sqlite3
import threading
from datetime import datetime

app = Flask(__name__)

# R-027: when running behind a reverse proxy (e.g. nginx), Flask otherwise sees the
# proxy's own IP/scheme rather than the real client's — silently breaking the CSRF
# cookie's Secure flag (request.is_secure) and rate-limit keying (get_remote_address).
# Only trust X-Forwarded-* when explicitly told there's exactly one proxy hop in front;
# trusting them unconditionally would let any client spoof its own IP/scheme.
if os.environ.get('CRANE_TRUST_PROXY', '0') == '1':
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# R-022: structured JSON logging — one line per request, machine-readable.
_handler = logging.StreamHandler()
_handler.setFormatter(JsonFormatter('%(asctime)s %(levelname)s %(name)s %(message)s'))
logging.getLogger().addHandler(_handler)
logging.getLogger().setLevel(logging.INFO)
app.logger.setLevel(logging.INFO)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[],
    storage_uri="memory://",
)

# CSRF protection via the double-submit-cookie pattern. The server sets a non-HttpOnly
# cookie containing a random token; the JS reads it and echoes it in the X-CSRF-Token
# header on every mutating request. Same-origin policy keeps third-party sites from
# reading the cookie, and the X-CSRF-Token header can't be forged across origins without
# the matching cookie. No new Python deps; no SECRET_KEY required.
CSRF_COOKIE = 'crane_csrf'
CSRF_HEADER = 'X-CSRF-Token'
MUTATING_METHODS = {'POST', 'PUT', 'DELETE', 'PATCH'}

@app.before_request
def _request_id():
    g.request_id = secrets.token_hex(8)

@app.after_request
def _log_request(resp):
    app.logger.info(
        'request',
        extra={
            'request_id': getattr(g, 'request_id', '-'),
            'method': request.method,
            'path': request.path,
            'status': resp.status_code,
        },
    )
    return resp

@app.before_request
def _csrf_guard():
    if request.method not in MUTATING_METHODS:
        return None
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not secrets.compare_digest(cookie, header):
        return jsonify({'error': 'CSRF token missing or invalid'}), 403
    return None

@app.after_request
def _csrf_issue(resp):
    # Ensure a CSRF cookie exists on every response so the JS always has a fresh token.
    if not request.cookies.get(CSRF_COOKIE):
        resp.set_cookie(
            CSRF_COOKIE,
            secrets.token_urlsafe(32),
            samesite='Strict',
            secure=request.is_secure,
            httponly=False,  # JS must read it
        )
    return resp

# Strict Content-Security-Policy. Per-request nonce is generated in before_request,
# made available to templates via the context processor below, and stamped onto the two
# inline <script> blocks. Inline <style> blocks/attributes were extracted to CSS classes
# so we don't need 'unsafe-inline' on style-src.
@app.before_request
def _csp_nonce():
    g.csp_nonce = secrets.token_urlsafe(16)

@app.after_request
def _csp_header(resp):
    nonce = getattr(g, 'csp_nonce', '')
    fonts_css = 'https://fonts.googleapis.com'
    fonts_files = 'https://fonts.gstatic.com'
    # script-src is strict (nonces only). style-src keeps 'unsafe-inline' because PDF.js
    # rendering sets canvas.style.width/height per-frame with dynamic values that can't
    # become CSS classes.
    resp.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        f"script-src 'self' 'nonce-{nonce}'; "
        "worker-src 'self'; "
        f"style-src 'self' 'unsafe-inline' {fonts_css}; "
        f"font-src 'self' {fonts_files}; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    # R-025: secondary defence-in-depth headers
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    resp.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    return resp

# R-024: read configuration from environment variables so the app can be deployed
# in different environments without code changes. Defaults match original behaviour.
UPLOAD_FOLDER = os.environ.get('CRANE_UPLOAD_DIR', 'uploads')
# R-019: SQLite replaces the flat metadata.json file. CRANE_DB lets tests and
# container deployments point at an isolated database path.
DB_FILE = os.environ.get('CRANE_DB', 'crane.db')
ALLOWED_EXTENSIONS = {'pdf'}
MAX_CONTENT_LENGTH = int(os.environ.get('CRANE_MAX_UPLOAD_MB', '500')) * 1024 * 1024
MAX_FIELD_LEN = int(os.environ.get('CRANE_MAX_FIELD_LEN', '64'))

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
# R-013 rate limits. Defaults are generous enough for the bulk importer (one
# authenticated user behind the reverse-proxy gate); tune down via env if the app
# is ever exposed more broadly. Read through app.config so the decorators (which
# pass a callable) pick up test overrides.
app.config['UPLOAD_RATE'] = os.environ.get('CRANE_UPLOAD_RATE', '60 per minute')
app.config['WRITE_RATE'] = os.environ.get('CRANE_WRITE_RATE', '60 per minute')
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

@app.errorhandler(RequestEntityTooLarge)
def handle_too_large(_e):
    """Friendly message instead of Flask's default HTML body for 413."""
    limit_mb = MAX_CONTENT_LENGTH // (1024 * 1024)
    return jsonify({'error': f'File too large. Maximum upload size is {limit_mb} MB.'}), 413

@app.errorhandler(429)
def handle_rate_limit(_e):
    return jsonify({'error': 'Too many requests — please slow down'}), 429

@app.errorhandler(HTTPException)
def handle_http_exception(e):
    """Route every HTTPException (400, 404, 405, etc.) through JSON so the
    XHR client doesn't end up parsing an HTML error page into 'Upload failed (NNN)'."""
    return jsonify({'error': e.description or e.name}), e.code

# R-019: threading.Lock replaces fcntl.flock. fcntl is POSIX-only; threading.Lock
# works on all platforms and plays correctly with SQLite's own WAL-mode locking.
# The lock serialises the application-level read-modify-write cycle so two concurrent
# requests can't both read stale state and then overwrite each other.
_metadata_lock_obj = threading.Lock()

@contextlib.contextmanager
def metadata_lock():
    """Exclusive application-level mutex around the metadata read-modify-write cycle."""
    with _metadata_lock_obj:
        yield


def init_db():
    """Create the SQLite schema if it does not exist. Safe to call multiple times.

    Data model (multi-file per crane): a `cranes` row is one crane specification
    (make/type/model/capacity — the identity), owning one-or-many `files` rows.
    `cranes.primary_file` points at the file that opens by default; NULL falls back
    to the earliest-uploaded file. Files live on disk at uploads/<crane_id>/<stored_name>.
    """
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS cranes (
                id           TEXT PRIMARY KEY,
                make         TEXT NOT NULL,
                type         TEXT NOT NULL,
                model        TEXT NOT NULL,
                capacity     TEXT NOT NULL,
                uploaded_at  TEXT NOT NULL,
                updated_at   TEXT,
                primary_file INTEGER
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS files (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                crane_id          TEXT NOT NULL,
                stored_name       TEXT NOT NULL,
                original_filename TEXT,
                label             TEXT,
                uploaded_at       TEXT NOT NULL,
                UNIQUE(crane_id, stored_name)
            )
        ''')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_files_crane ON files(crane_id)')
        # R-020: immutable append-only audit log; never updated, only inserted.
        # `filename` holds the crane id (or affected file identifier) for the event.
        conn.execute('''
            CREATE TABLE IF NOT EXISTS spec_events (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type       TEXT NOT NULL,
                filename         TEXT NOT NULL,
                occurred_at      TEXT NOT NULL,
                snapshot_before  TEXT,
                snapshot_after   TEXT
            )
        ''')
        conn.commit()


def _migrate_from_json():
    """One-time migration from legacy metadata.json to SQLite.
    No-op if the file is absent. Renames the source to metadata.json.migrated on success."""
    if not os.path.exists('metadata.json'):
        return
    try:
        with open('metadata.json', 'r') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return
        with sqlite3.connect(DB_FILE) as conn:
            for filename, rec in data.items():
                conn.execute(
                    '''INSERT OR IGNORE INTO specs
                       (filename, make, type, model, capacity, uploaded_at, updated_at, original_filename)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                    (
                        filename,
                        rec.get('make', ''),
                        rec.get('type', ''),
                        rec.get('model', ''),
                        rec.get('capacity', ''),
                        rec.get('uploaded_at', datetime.now().isoformat()),
                        rec.get('updated_at'),
                        rec.get('original_filename', filename),
                    ),
                )
            conn.commit()
        os.rename('metadata.json', 'metadata.json.migrated')
        app.logger.info('migrated %d records from metadata.json to SQLite', len(data))
    except Exception:
        app.logger.exception('_migrate_from_json failed — continuing without migration')


def _table_exists(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def _migrate_from_specs():
    """One-time migration from the single-file `specs` table to the multi-file
    cranes+files model. Each specs row becomes one crane with one (primary) file,
    and its PDF is moved from uploads/<slug>.pdf to uploads/<slug>/<slug>.pdf.

    Idempotent: skips cranes that already exist, so a partial run resumes safely.
    Renames `specs` to `specs_legacy` on completion so it never re-migrates (and the
    old rows are retained for rollback/history)."""
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            if not _table_exists(conn, 'specs'):
                return
            rows = conn.execute('SELECT * FROM specs').fetchall()
            migrated = 0
            for row in rows:
                filename = row['filename']
                crane_id = filename[:-4] if filename.lower().endswith('.pdf') else filename
                if conn.execute('SELECT 1 FROM cranes WHERE id=?', (crane_id,)).fetchone():
                    continue
                # Move the flat file into its crane directory.
                src = os.path.join(UPLOAD_FOLDER, filename)
                crane_dir = os.path.join(UPLOAD_FOLDER, crane_id)
                dest = os.path.join(crane_dir, filename)
                if os.path.exists(src) and not os.path.exists(dest):
                    os.makedirs(crane_dir, exist_ok=True)
                    os.rename(src, dest)
                conn.execute(
                    '''INSERT INTO cranes (id, make, type, model, capacity, uploaded_at, updated_at, primary_file)
                       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)''',
                    (crane_id, row['make'], row['type'], row['model'], row['capacity'],
                     row['uploaded_at'], row['updated_at']),
                )
                cur = conn.execute(
                    '''INSERT INTO files (crane_id, stored_name, original_filename, label, uploaded_at)
                       VALUES (?, ?, ?, ?, ?)''',
                    (crane_id, filename, row['original_filename'] or filename, '', row['uploaded_at']),
                )
                conn.execute('UPDATE cranes SET primary_file=? WHERE id=?', (cur.lastrowid, crane_id))
                migrated += 1
            conn.execute('ALTER TABLE specs RENAME TO specs_legacy')
            conn.commit()
        if migrated:
            app.logger.info('migrated %d specs rows to cranes/files model', migrated)
    except Exception:
        app.logger.exception('_migrate_from_specs failed — continuing without migration')


def _file_url(crane_id, stored_name):
    return f"/uploads/{crane_id}/{stored_name}"


def _crane_from_rows(crane_row, file_rows):
    """Assemble the API dict for a crane from its DB row and its file rows.
    Resolves the effective primary (explicit pointer, else earliest file) and
    orders files primary-first."""
    files = []
    for f in file_rows:
        files.append({
            'id': f['id'],
            'crane_id': crane_row['id'],
            'stored_name': f['stored_name'],
            'original_filename': f['original_filename'] or f['stored_name'],
            'label': f['label'] or '',
            'uploaded_at': f['uploaded_at'],
            'url': _file_url(crane_row['id'], f['stored_name']),
        })
    primary = next((f for f in files if f['id'] == crane_row['primary_file']), None)
    if primary is None and files:
        primary = min(files, key=lambda f: (f['uploaded_at'], f['id']))
    primary_id = primary['id'] if primary else None
    for f in files:
        f['is_primary'] = (f['id'] == primary_id)
    files.sort(key=lambda f: (not f['is_primary'], f['uploaded_at'], f['id']))
    return {
        'id': crane_row['id'],
        'name': crane_row['id'],   # sidebar/keying compat (was the .pdf filename)
        'make': crane_row['make'],
        'type': crane_row['type'],
        'model': crane_row['model'],
        'capacity': crane_row['capacity'],
        'uploaded_at': crane_row['uploaded_at'],
        'updated_at': crane_row['updated_at'],
        'files': files,
        'primary_file_id': primary_id,
        'file_count': len(files),
        # Primary-file conveniences so the sidebar can open a crane with one field.
        'url': primary['url'] if primary else None,
        'original_filename': primary['original_filename'] if primary else None,
    }


def list_cranes():
    """Return all cranes (each with its files + resolved primary), sorted by id.
    Returns [] if the database is missing or corrupt."""
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            cranes = conn.execute('SELECT * FROM cranes ORDER BY id').fetchall()
            by_crane = {}
            for f in conn.execute('SELECT * FROM files').fetchall():
                by_crane.setdefault(f['crane_id'], []).append(f)
        return [_crane_from_rows(c, by_crane.get(c['id'], [])) for c in cranes]
    except sqlite3.DatabaseError as e:
        app.logger.warning('SQLite unreadable (%s); falling back to empty.', e)
        return []


def get_crane(crane_id):
    """Return one crane dict (with files) or None."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        crane = conn.execute('SELECT * FROM cranes WHERE id=?', (crane_id,)).fetchone()
        if crane is None:
            return None
        files = conn.execute('SELECT * FROM files WHERE crane_id=?', (crane_id,)).fetchall()
    return _crane_from_rows(crane, files)


def log_event(event_type, filename, before=None, after=None):
    """R-020: append an immutable audit event to spec_events. Never raises."""
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute(
                '''INSERT INTO spec_events
                   (event_type, filename, occurred_at, snapshot_before, snapshot_after)
                   VALUES (?, ?, ?, ?, ?)''',
                (
                    event_type,
                    filename,
                    datetime.now().isoformat(),
                    json.dumps(before) if before is not None else None,
                    json.dumps(after) if after is not None else None,
                ),
            )
            conn.commit()
    except Exception:
        app.logger.exception('log_event failed for %s %s', event_type, filename)


def cap_field(value, name):
    """Validate per-field length. Raises a ValueError that the caller converts to a 400."""
    if len(value) > MAX_FIELD_LEN:
        raise ValueError(f'{name} is too long (max {MAX_FIELD_LEN} characters).')
    return value

# Render kbd hints with the right glyph on first paint (no FOUC).
# Detect via User-Agent server-side; JS re-checks in case UA lied.
_MAC_UA_RE = re.compile(r'mac|iphone|ipad|ipod', re.IGNORECASE)

@app.context_processor
def inject_platform():
    return {
        'is_mac': bool(_MAC_UA_RE.search(request.user_agent.string or '')),
        'csp_nonce': getattr(g, 'csp_nonce', ''),
    }

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# R-003: PDF magic bytes validation. Checks that the uploaded file actually starts
# with the PDF signature rather than relying on the filename extension alone.
_PDF_MAGIC = b'%PDF-'

def is_valid_pdf(file_storage) -> bool:
    header = file_storage.stream.read(5)
    file_storage.stream.seek(0)
    return header == _PDF_MAGIC

def generate_crane_id(make, model_type, model, capacity):
    """Deterministic slug identifying a crane: make_type_model_capacity, lowercased,
    with non-[A-Za-z0-9._-] characters stripped. This is the cranes.id PK and the
    per-crane directory name under uploads/."""
    parts = (make, model_type, model, capacity)
    joined = '_'.join(p.replace(' ', '_').replace('/', '_').lower() for p in parts)
    return ''.join(c if c.isalnum() or c in '._-' else '' for c in joined)


def generate_filename(make, model_type, model, capacity, original_ext='.pdf'):
    """Standardised filename from metadata (the crane slug plus an extension).
    Retained for the legacy single-file naming and its unit test."""
    return generate_crane_id(make, model_type, model, capacity) + original_ext


def _sanitize_stored_name(original):
    """Turn an uploaded filename into a safe, PDF-suffixed on-disk name."""
    name = secure_filename(original or '') or 'document.pdf'
    if not name.lower().endswith('.pdf'):
        name += '.pdf'
    return name


def _dedupe_stored_name(crane_dir, stored_name):
    """Ensure stored_name doesn't collide with an existing file in crane_dir by
    appending _2, _3, … before the extension."""
    if not os.path.exists(os.path.join(crane_dir, stored_name)):
        return stored_name
    base, ext = os.path.splitext(stored_name)
    i = 2
    while os.path.exists(os.path.join(crane_dir, f"{base}_{i}{ext}")):
        i += 1
    return f"{base}_{i}{ext}"


def _crane_dir(crane_id):
    return os.path.join(app.config['UPLOAD_FOLDER'], crane_id)


def _reject_bad_pdf(file):
    """Shared upload validation (upload + add-file). Returns an error response
    tuple, or None if the file is a valid PDF."""
    if file is None or file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': 'Only PDF files are allowed'}), 400
    # R-003: verify PDF magic bytes, not just the extension.
    if not is_valid_pdf(file):
        return jsonify({'error': 'Only PDF files are allowed'}), 400
    return None


def _audit_snapshot(crane):
    """Compact metadata snapshot for the spec_events audit log."""
    if not crane:
        return None
    return {
        'id': crane['id'],
        'make': crane['make'],
        'type': crane['type'],
        'model': crane['model'],
        'capacity': crane['capacity'],
        'files': [
            {'label': f['label'], 'stored_name': f['stored_name'], 'is_primary': f['is_primary']}
            for f in crane['files']
        ],
    }


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/pdfs", methods=['GET'])
def get_pdfs():
    """List cranes, each with its files and resolved primary.

    R-011: cursor-based pagination via ?after=<crane_id>&limit=<n>.
    Returns {"items": [...], "total": <int>, "next_cursor": "<crane_id>" | null}.
    Each item is a crane: {id, name, make, type, model, capacity, url (primary),
    files: [{id, url, label, is_primary, ...}], file_count, primary_file_id}.
    """
    try:
        after = request.args.get('after', '')
        try:
            limit = int(request.args.get('limit', '0'))
        except ValueError:
            limit = 0

        cranes = list_cranes()   # already sorted by id
        total = len(cranes)

        if after:
            idx = next((i for i, c in enumerate(cranes) if c['id'] == after), -1)
            cranes = cranes[idx + 1:] if idx >= 0 else cranes

        if limit > 0:
            page_items = cranes[:limit]
            next_cursor = page_items[-1]['id'] if len(cranes) > limit else None
        else:
            page_items = cranes
            next_cursor = None

        return jsonify({'items': page_items, 'total': total, 'next_cursor': next_cursor})
    except Exception:
        app.logger.exception('get_pdfs failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/upload", methods=['POST'])
@limiter.limit(lambda: app.config['UPLOAD_RATE'])
def upload_file():
    """Create a new crane from its first (primary) PDF + metadata."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['file']
    make = request.form.get('make', 'Unknown')
    model_type = request.form.get('type', 'Unknown')
    model = request.form.get('model', 'Unknown')
    capacity = request.form.get('capacity', 'Unknown')
    # Optional label for the crane's first file (used by the bulk importer to carry
    # the "(...)" parenthetical from the filename onto the primary file).
    label = (request.form.get('label') or '').strip()

    bad = _reject_bad_pdf(file)
    if bad:
        return bad

    try:
        cap_field(make, 'Manufacturer')
        cap_field(model_type, 'Type')
        cap_field(model, 'Model')
        cap_field(capacity, 'Capacity')
        cap_field(label, 'Label')
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    try:
        crane_id = generate_crane_id(make, model_type, model, capacity)
        crane_dir = _crane_dir(crane_id)
        now = datetime.now().isoformat()

        with metadata_lock():
            if get_crane(crane_id) is not None:
                return jsonify({'error': 'File with these specifications already exists'}), 409
            os.makedirs(crane_dir, exist_ok=True)
            stored_name = _dedupe_stored_name(crane_dir, _sanitize_stored_name(file.filename))
            file.save(os.path.join(crane_dir, stored_name))
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute(
                    '''INSERT INTO cranes (id, make, type, model, capacity, uploaded_at, updated_at, primary_file)
                       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)''',
                    (crane_id, make, model_type, model, capacity, now),
                )
                cur = conn.execute(
                    '''INSERT INTO files (crane_id, stored_name, original_filename, label, uploaded_at)
                       VALUES (?, ?, ?, ?, ?)''',
                    (crane_id, stored_name, secure_filename(file.filename), label, now),
                )
                conn.execute('UPDATE cranes SET primary_file=? WHERE id=?', (cur.lastrowid, crane_id))
                conn.commit()
            crane = get_crane(crane_id)
            log_event('upload', crane_id, before=None, after=_audit_snapshot(crane))

        return jsonify({'success': True, **crane}), 201
    except Exception:
        app.logger.exception('upload_file failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/cranes/<crane_id>/files", methods=['POST'])
@limiter.limit(lambda: app.config['WRITE_RATE'])
def add_crane_file(crane_id):
    """Attach a supplementary PDF to an existing crane, with an optional label."""
    crane_id = secure_filename(crane_id)
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    label = (request.form.get('label') or '').strip()

    bad = _reject_bad_pdf(file)
    if bad:
        return bad
    try:
        cap_field(label, 'Label')
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    try:
        with metadata_lock():
            if get_crane(crane_id) is None:
                return jsonify({'error': 'Crane not found'}), 404
            crane_dir = _crane_dir(crane_id)
            os.makedirs(crane_dir, exist_ok=True)
            stored_name = _dedupe_stored_name(crane_dir, _sanitize_stored_name(file.filename))
            file.save(os.path.join(crane_dir, stored_name))
            now = datetime.now().isoformat()
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute(
                    '''INSERT INTO files (crane_id, stored_name, original_filename, label, uploaded_at)
                       VALUES (?, ?, ?, ?, ?)''',
                    (crane_id, stored_name, secure_filename(file.filename), label, now),
                )
                conn.commit()
            crane = get_crane(crane_id)
            log_event('file_add', crane_id, before=None,
                      after={'stored_name': stored_name, 'label': label})

        return jsonify({'success': True, **crane}), 201
    except Exception:
        app.logger.exception('add_crane_file failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/cranes/<crane_id>/primary", methods=['PUT'])
@limiter.limit(lambda: app.config['WRITE_RATE'])
def set_primary_file(crane_id):
    """Designate which file opens by default for a crane."""
    crane_id = secure_filename(crane_id)
    data = request.get_json(silent=True) or {}
    try:
        file_id = int(data.get('file_id'))
    except (TypeError, ValueError):
        return jsonify({'error': 'file_id is required'}), 400

    try:
        with metadata_lock():
            crane = get_crane(crane_id)
            if crane is None:
                return jsonify({'error': 'Crane not found'}), 404
            if not any(f['id'] == file_id for f in crane['files']):
                return jsonify({'error': 'File not found on this crane'}), 404
            before = {'primary_file_id': crane['primary_file_id']}
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute('UPDATE cranes SET primary_file=? WHERE id=?', (file_id, crane_id))
                conn.commit()
            crane = get_crane(crane_id)
            log_event('primary_change', crane_id, before=before, after={'primary_file_id': file_id})

        return jsonify({'success': True, **crane}), 200
    except Exception:
        app.logger.exception('set_primary_file failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/cranes/<crane_id>/files/<int:file_id>", methods=['PATCH'])
@limiter.limit(lambda: app.config['WRITE_RATE'])
def update_file_label(crane_id, file_id):
    """Rename a file's label (the human-readable name shown on its strip chip)."""
    crane_id = secure_filename(crane_id)
    data = request.get_json(silent=True) or {}
    label = (data.get('label') or '').strip()
    try:
        cap_field(label, 'Label')
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    try:
        with metadata_lock():
            crane = get_crane(crane_id)
            if crane is None:
                return jsonify({'error': 'Crane not found'}), 404
            target = next((f for f in crane['files'] if f['id'] == file_id), None)
            if target is None:
                return jsonify({'error': 'File not found on this crane'}), 404
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute('UPDATE files SET label=? WHERE id=? AND crane_id=?',
                             (label, file_id, crane_id))
                conn.commit()
            crane = get_crane(crane_id)
            log_event('label_edit', crane_id,
                      before={'label': target['label']}, after={'label': label})

        return jsonify({'success': True, **crane}), 200
    except Exception:
        app.logger.exception('update_file_label failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/cranes/<crane_id>/files/<int:file_id>", methods=['DELETE'])
@limiter.limit(lambda: app.config['WRITE_RATE'])
def delete_crane_file(crane_id, file_id):
    """Delete one file from a crane. Deleting the crane's last file deletes the
    whole crane; deleting the primary lets it fall back to the earliest remaining."""
    try:
        crane_id = secure_filename(crane_id)
        with metadata_lock():
            crane = get_crane(crane_id)
            if crane is None:
                return jsonify({'error': 'Crane not found'}), 404
            target = next((f for f in crane['files'] if f['id'] == file_id), None)
            if target is None:
                return jsonify({'error': 'File not found on this crane'}), 404

            fpath = os.path.join(_crane_dir(crane_id), target['stored_name'])
            if os.path.exists(fpath):
                os.remove(fpath)

            was_last = len(crane['files']) == 1
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute('DELETE FROM files WHERE id=?', (file_id,))
                if was_last:
                    conn.execute('DELETE FROM cranes WHERE id=?', (crane_id,))
                elif crane['primary_file_id'] == file_id:
                    conn.execute('UPDATE cranes SET primary_file=NULL WHERE id=?', (crane_id,))
                conn.commit()

            if was_last:
                shutil.rmtree(_crane_dir(crane_id), ignore_errors=True)
                log_event('delete', crane_id, before=_audit_snapshot(crane), after=None)
                result = {'success': True, 'crane_deleted': True}
            else:
                updated = get_crane(crane_id)
                log_event('file_remove', crane_id,
                          before={'stored_name': target['stored_name']}, after=None)
                result = {'success': True, 'crane_deleted': False, **updated}

        return jsonify(result), 200
    except Exception:
        app.logger.exception('delete_crane_file failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/metadata/<crane_id>", methods=['PUT'])
@limiter.limit(lambda: app.config['WRITE_RATE'])
def update_metadata(crane_id):
    """Edit a crane's metadata. Renames its uploads/<slug>/ directory (a single
    atomic rename covering all its files) when the derived slug changes."""
    try:
        crane_id = secure_filename(crane_id)

        data = request.get_json(silent=True) or {}
        make = (data.get('make') or '').strip()
        model_type = (data.get('type') or '').strip()
        model = (data.get('model') or '').strip()
        capacity = (data.get('capacity') or '').strip()

        if not (make and model_type and model and capacity):
            return jsonify({'error': 'make, type, model, and capacity are required'}), 400

        try:
            cap_field(make, 'Manufacturer')
            cap_field(model_type, 'Type')
            cap_field(model, 'Model')
            cap_field(capacity, 'Capacity')
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

        with metadata_lock():
            crane = get_crane(crane_id)
            if crane is None:
                return jsonify({'error': 'File not found'}), 404

            new_id = generate_crane_id(make, model_type, model, capacity)
            now = datetime.now().isoformat()
            before = _audit_snapshot(crane)

            if new_id == crane_id:
                with sqlite3.connect(DB_FILE) as conn:
                    conn.execute(
                        'UPDATE cranes SET make=?, type=?, model=?, capacity=?, updated_at=? WHERE id=?',
                        (make, model_type, model, capacity, now, crane_id),
                    )
                    conn.commit()
                updated = get_crane(crane_id)
                log_event('edit', crane_id, before=before, after=_audit_snapshot(updated))
                result = {'success': True, 'renamed': False, 'old_name': crane_id, **updated}
            else:
                if get_crane(new_id) is not None:
                    return jsonify({'error': 'A specification with these details already exists'}), 409

                old_dir = _crane_dir(crane_id)
                new_dir = _crane_dir(new_id)
                if os.path.exists(old_dir):
                    os.rename(old_dir, new_dir)
                try:
                    with sqlite3.connect(DB_FILE) as conn:
                        conn.execute(
                            'UPDATE cranes SET id=?, make=?, type=?, model=?, capacity=?, updated_at=? WHERE id=?',
                            (new_id, make, model_type, model, capacity, now, crane_id),
                        )
                        conn.execute('UPDATE files SET crane_id=? WHERE crane_id=?', (new_id, crane_id))
                        conn.commit()
                except Exception:
                    # Roll back the directory rename so disk and DB stay in sync.
                    if os.path.exists(new_dir) and not os.path.exists(old_dir):
                        os.rename(new_dir, old_dir)
                    raise
                updated = get_crane(new_id)
                log_event('edit', crane_id, before=before,
                          after={**_audit_snapshot(updated), 'new_id': new_id})
                result = {'success': True, 'renamed': True, 'old_name': crane_id, **updated}

        return jsonify(result), 200
    except Exception:
        app.logger.exception('update_metadata failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/uploads/<path:filename>", methods=['GET'])
def download_file(filename):
    """Serve uploaded PDF files (uploads/<crane_id>/<stored_name>).
    send_from_directory safe-joins the path, preventing traversal."""
    try:
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)
    except NotFound:
        return jsonify({'error': 'File not found'}), 404

@app.route("/api/delete/<crane_id>", methods=['DELETE'])
@limiter.limit(lambda: app.config['WRITE_RATE'])
def delete_file(crane_id):
    """Delete a whole crane — all its files, its directory, and its rows.

    R-001: the entire existence-check + remove + row-delete sequence is held inside
    metadata_lock() so it cannot race against a concurrent upload or edit.
    """
    try:
        crane_id = secure_filename(crane_id)
        with metadata_lock():
            crane = get_crane(crane_id)
            if crane is None:
                return jsonify({'error': 'File not found'}), 404
            before = _audit_snapshot(crane)
            shutil.rmtree(_crane_dir(crane_id), ignore_errors=True)
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute('DELETE FROM files WHERE crane_id=?', (crane_id,))
                conn.execute('DELETE FROM cranes WHERE id=?', (crane_id,))
                conn.commit()
            log_event('delete', crane_id, before=before, after=None)

        return jsonify({'success': True}), 200
    except Exception:
        app.logger.exception('delete_file failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/export", methods=['GET'])
def export_metadata():
    """R-021: download the full catalogue (cranes + files) as a JSON file."""
    try:
        catalogue = {c['id']: c for c in list_cranes()}
        resp = app.response_class(
            response=json.dumps(catalogue, indent=2),
            status=200,
            mimetype='application/json',
        )
        resp.headers['Content-Disposition'] = 'attachment; filename="crane_export.json"'
        return resp
    except Exception:
        app.logger.exception('export_metadata failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/health", methods=['GET'])
def health():
    """R-023: liveness probe for load balancers and uptime monitors.
    Reports the total number of stored files across all cranes."""
    try:
        with sqlite3.connect(DB_FILE) as conn:
            upload_count = conn.execute('SELECT COUNT(*) FROM files').fetchone()[0]
    except Exception:
        upload_count = -1
    return jsonify({'status': 'ok', 'uploads': upload_count}), 200


# R-019: initialise the database at import time. Tests monkeypatch DB_FILE and
# call init_db() again from their fixture after the patch, so each test gets its
# own isolated database in tmp_path.
init_db()
_migrate_from_json()   # legacy metadata.json -> specs (inert once done)
_migrate_from_specs()  # single-file specs -> multi-file cranes/files

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
