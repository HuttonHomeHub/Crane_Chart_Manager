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
    """Create the SQLite schema if it does not exist. Safe to call multiple times."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS specs (
                filename         TEXT PRIMARY KEY,
                make             TEXT NOT NULL,
                type             TEXT NOT NULL,
                model            TEXT NOT NULL,
                capacity         TEXT NOT NULL,
                uploaded_at      TEXT NOT NULL,
                updated_at       TEXT,
                original_filename TEXT
            )
        ''')
        # R-020: immutable append-only audit log; never updated, only inserted.
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


def load_metadata():
    """Load all specs from SQLite. Returns {filename: {fields}} dict.
    Returns {} if the database is missing or corrupt."""
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute('SELECT * FROM specs').fetchall()
        result = {}
        for row in rows:
            rec = {
                'make': row['make'],
                'type': row['type'],
                'model': row['model'],
                'capacity': row['capacity'],
                'uploaded_at': row['uploaded_at'],
                'original_filename': row['original_filename'] or row['filename'],
            }
            if row['updated_at']:
                rec['updated_at'] = row['updated_at']
            result[row['filename']] = rec
        return result
    except sqlite3.DatabaseError as e:
        app.logger.warning('SQLite unreadable (%s); falling back to empty.', e)
        return {}


def save_metadata(metadata):
    """Persist the full metadata dict to SQLite via a DELETE+INSERT transaction.
    Preserves the same call signature as the old JSON implementation."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('DELETE FROM specs')
        for filename, rec in metadata.items():
            conn.execute(
                '''INSERT INTO specs
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

def generate_filename(make, model_type, model, capacity, original_ext='.pdf'):
    """Generate a standardized filename from metadata"""
    make_clean = make.replace(' ', '_').replace('/', '_').lower()
    type_clean = model_type.replace(' ', '_').replace('/', '_').lower()
    model_clean = model.replace(' ', '_').replace('/', '_').lower()
    capacity_clean = capacity.replace(' ', '_').replace('/', '_').lower()
    filename = f"{make_clean}_{type_clean}_{model_clean}_{capacity_clean}{original_ext}"
    filename = ''.join(c if c.isalnum() or c in '._-' else '' for c in filename)
    return filename


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/pdfs", methods=['GET'])
def get_pdfs():
    """List uploaded PDFs with metadata.

    R-011: supports cursor-based pagination via ?after=<filename>&limit=<n>.
    Returns {"items": [...], "total": <int>, "next_cursor": "<filename>" | null}.
    Omitting ?after / ?limit returns all items (backwards-compatible for callers
    that don't yet pass pagination params).
    """
    try:
        after = request.args.get('after', '')
        try:
            limit = int(request.args.get('limit', '0'))
        except ValueError:
            limit = 0

        metadata = load_metadata()
        files = []
        for filename in os.listdir(UPLOAD_FOLDER):
            if filename.lower().endswith('.pdf'):
                filepath = os.path.join(UPLOAD_FOLDER, filename)
                # R-012: file may be deleted between listdir and getsize (TOCTOU).
                try:
                    size = os.path.getsize(filepath)
                except OSError:
                    continue
                file_data = {
                    'name': filename,
                    'size': size,
                    'url': f"/uploads/{filename}",
                }
                if filename in metadata:
                    file_data.update(metadata[filename])
                files.append(file_data)

        files.sort(key=lambda x: x['name'])
        total = len(files)

        if after:
            idx = next((i for i, f in enumerate(files) if f['name'] == after), -1)
            files = files[idx + 1:] if idx >= 0 else files

        if limit > 0:
            page_items = files[:limit]
            # next_cursor is the last item of the current page; the caller sends
            # ?after=<next_cursor> to get items that come after it alphabetically.
            next_cursor = page_items[-1]['name'] if len(files) > limit else None
        else:
            page_items = files
            next_cursor = None

        return jsonify({'items': page_items, 'total': total, 'next_cursor': next_cursor})
    except Exception:
        app.logger.exception('get_pdfs failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/upload", methods=['POST'])
@limiter.limit("10 per minute")
def upload_file():
    """Upload a PDF file with metadata."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['file']
    make = request.form.get('make', 'Unknown')
    model_type = request.form.get('type', 'Unknown')
    model = request.form.get('model', 'Unknown')
    capacity = request.form.get('capacity', 'Unknown')

    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Only PDF files are allowed'}), 400

    # R-003: verify PDF magic bytes, not just the extension.
    if not is_valid_pdf(file):
        return jsonify({'error': 'Only PDF files are allowed'}), 400

    try:
        cap_field(make, 'Manufacturer')
        cap_field(model_type, 'Type')
        cap_field(model, 'Model')
        cap_field(capacity, 'Capacity')
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    try:
        filename = generate_filename(make, model_type, model, capacity, '.pdf')
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        with metadata_lock():
            if os.path.exists(filepath):
                return jsonify({'error': 'File with these specifications already exists'}), 409
            file.save(filepath)
            metadata = load_metadata()
            record = {
                'make': make,
                'type': model_type,
                'model': model,
                'capacity': capacity,
                'uploaded_at': datetime.now().isoformat(),
                'original_filename': secure_filename(file.filename),
            }
            metadata[filename] = record
            save_metadata(metadata)
            log_event('upload', filename, before=None, after=record)

        return jsonify({
            'success': True,
            'name': filename,
            'url': f"/uploads/{filename}",
            'make': make,
            'type': model_type,
            'model': model,
            'capacity': capacity,
        }), 201
    except Exception:
        app.logger.exception('upload_file failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/metadata/<filename>", methods=['PUT'])
@limiter.limit("30 per minute")
def update_metadata(filename):
    """Edit metadata for an existing PDF. Renames the file on disk if the
    derived filename changes (filename is a deterministic slug of make/type/model/capacity)."""
    try:
        filename = secure_filename(filename)
        old_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        if not os.path.exists(old_path):
            return jsonify({'error': 'File not found'}), 404

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
            metadata = load_metadata()
            existing = metadata.get(filename, {})
            preserved = {
                'uploaded_at': existing.get('uploaded_at', datetime.now().isoformat()),
                'original_filename': existing.get('original_filename', filename),
            }

            new_filename = generate_filename(make, model_type, model, capacity, '.pdf')
            new_path = os.path.join(app.config['UPLOAD_FOLDER'], new_filename)

            record = {
                'make': make,
                'type': model_type,
                'model': model,
                'capacity': capacity,
                'uploaded_at': preserved['uploaded_at'],
                'original_filename': preserved['original_filename'],
                'updated_at': datetime.now().isoformat(),
            }

            if new_filename == filename:
                metadata[filename] = record
                save_metadata(metadata)
                log_event('edit', filename, before=existing, after=record)
                return jsonify({
                    'success': True,
                    'renamed': False,
                    'name': filename,
                    'url': f"/uploads/{filename}",
                    **{k: record[k] for k in ('make', 'type', 'model', 'capacity')},
                }), 200

            if os.path.exists(new_path):
                return jsonify({'error': 'A specification with these details already exists'}), 409

            os.rename(old_path, new_path)
            try:
                metadata[new_filename] = record
                if filename in metadata:
                    del metadata[filename]
                save_metadata(metadata)
                log_event('edit', filename, before=existing, after={**record, 'new_filename': new_filename})
            except Exception:
                # Roll back the rename so disk and metadata stay in sync.
                if os.path.exists(new_path) and not os.path.exists(old_path):
                    os.rename(new_path, old_path)
                raise

        return jsonify({
            'success': True,
            'renamed': True,
            'old_name': filename,
            'name': new_filename,
            'url': f"/uploads/{new_filename}",
            **{k: record[k] for k in ('make', 'type', 'model', 'capacity')},
        }), 200
    except Exception:
        app.logger.exception('update_metadata failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/uploads/<path:filename>", methods=['GET'])
def download_file(filename):
    """Serve uploaded PDF files. Sanitize the error to avoid leaking absolute paths."""
    try:
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)
    except NotFound:
        return jsonify({'error': 'File not found'}), 404

@app.route("/api/delete/<filename>", methods=['DELETE'])
@limiter.limit("30 per minute")
def delete_file(filename):
    """Delete a PDF and its metadata record.

    R-001: the entire existence-check + remove + metadata-rewrite sequence is held
    inside metadata_lock() so it cannot race against a concurrent upload or edit.
    """
    try:
        filename = secure_filename(filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        with metadata_lock():
            if not os.path.exists(filepath):
                return jsonify({'error': 'File not found'}), 404
            metadata = load_metadata()
            before = metadata.get(filename)
            os.remove(filepath)
            if filename in metadata:
                del metadata[filename]
                save_metadata(metadata)
            log_event('delete', filename, before=before, after=None)

        return jsonify({'success': True}), 200
    except Exception:
        app.logger.exception('delete_file failed')
        return jsonify({'error': 'Internal server error'}), 500

@app.route("/api/export", methods=['GET'])
def export_metadata():
    """R-021: download the full catalogue as a JSON file for backup/migration."""
    try:
        metadata = load_metadata()
        resp = app.response_class(
            response=json.dumps(metadata, indent=2),
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
    """R-023: liveness probe for load balancers and uptime monitors."""
    try:
        upload_count = sum(
            1 for f in os.listdir(UPLOAD_FOLDER) if f.lower().endswith('.pdf')
        )
    except OSError:
        upload_count = -1
    return jsonify({'status': 'ok', 'uploads': upload_count}), 200


# R-019: initialise the database at import time. Tests monkeypatch DB_FILE and
# call init_db() again from their fixture after the patch, so each test gets its
# own isolated database in tmp_path.
init_db()
_migrate_from_json()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
