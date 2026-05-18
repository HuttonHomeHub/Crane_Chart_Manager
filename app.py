from flask import Flask, render_template, request, jsonify, send_from_directory, g
from werkzeug.exceptions import HTTPException, NotFound, RequestEntityTooLarge
from werkzeug.utils import secure_filename
import contextlib
import fcntl
import os
import json
import re
import secrets
from datetime import datetime

app = Flask(__name__)

# J: CSRF protection via the double-submit-cookie pattern. The server sets a non-HttpOnly
# cookie containing a random token; the JS reads it and echoes it in the X-CSRF-Token
# header on every mutating request. Same-origin policy keeps third-party sites from
# reading the cookie, and the X-CSRF-Token header can't be forged across origins without
# the matching cookie. No new Python deps; no SECRET_KEY required.
CSRF_COOKIE = 'crane_csrf'
CSRF_HEADER = 'X-CSRF-Token'
MUTATING_METHODS = {'POST', 'PUT', 'DELETE', 'PATCH'}

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

# I: strict Content-Security-Policy. Per-request nonce is generated in before_request,
# made available to templates via the context processor below, and stamped onto the two
# inline <script> blocks. Inline <style> blocks/attributes were extracted to CSS classes
# so we don't need 'unsafe-inline' on style-src.
@app.before_request
def _csp_nonce():
    g.csp_nonce = secrets.token_urlsafe(16)

@app.after_request
def _csp_header(resp):
    nonce = getattr(g, 'csp_nonce', '')
    cdnjs = 'https://cdnjs.cloudflare.com'
    fonts_css = 'https://fonts.googleapis.com'
    fonts_files = 'https://fonts.gstatic.com'
    # script-src is strict (nonces only). style-src keeps 'unsafe-inline' because PDF.js
    # rendering sets canvas.style.width/height per-frame with dynamic values that can't
    # become CSS classes. This is the standard pragmatic CSP shape: tight on JS, looser
    # on CSS where the realistic XSS impact is cosmetic.
    resp.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        f"script-src 'self' 'nonce-{nonce}' {cdnjs}; "
        f"worker-src 'self' {cdnjs}; "
        f"style-src 'self' 'unsafe-inline' {fonts_css}; "
        f"font-src 'self' {fonts_files}; "
        "img-src 'self' data:; "
        f"connect-src 'self' {cdnjs}; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    return resp

# Configuration
UPLOAD_FOLDER = 'uploads'
METADATA_FILE = 'metadata.json'
METADATA_LOCK = METADATA_FILE + '.lock'
ALLOWED_EXTENSIONS = {'pdf'}
MAX_CONTENT_LENGTH = 500 * 1024 * 1024  # 500MB max file size
MAX_FIELD_LEN = 64                       # B: per-field char cap on make/type/model/capacity

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

@app.errorhandler(RequestEntityTooLarge)
def handle_too_large(_e):
    """Friendly message instead of Flask's default HTML body for 413."""
    limit_mb = MAX_CONTENT_LENGTH // (1024 * 1024)
    return jsonify({'error': f'File too large. Maximum upload size is {limit_mb} MB.'}), 413

@app.errorhandler(HTTPException)
def handle_http_exception(e):
    """A: route every HTTPException (400, 404, 405, etc.) through JSON so the
    XHR client doesn't end up parsing an HTML error page into 'Upload failed (NNN)'."""
    return jsonify({'error': e.description or e.name}), e.code

@contextlib.contextmanager
def metadata_lock():
    """H: exclusive POSIX file lock around load+modify+save of metadata.json.
    Prevents two concurrent uploads/edits from clobbering each other's writes."""
    with open(METADATA_LOCK, 'a') as lock_f:
        fcntl.flock(lock_f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_f, fcntl.LOCK_UN)

def cap_field(value, name):
    """B: validate per-field length. Raises a ValueError that the caller converts to a 400."""
    if len(value) > MAX_FIELD_LEN:
        raise ValueError(f'{name} is too long (max {MAX_FIELD_LEN} characters).')
    return value

# E: render kbd hints with the right glyph on first paint (no FOUC).
# We detect via User-Agent server-side and the JS still re-checks in case UA lied.
_MAC_UA_RE = re.compile(r'mac|iphone|ipad|ipod', re.IGNORECASE)

@app.context_processor
def inject_platform():
    # Context processors only run inside a request context, so `request` is always
    # valid here. user_agent.string is '' (not None) when the header is missing.
    return {
        'is_mac': bool(_MAC_UA_RE.search(request.user_agent.string or '')),
        'csp_nonce': getattr(g, 'csp_nonce', ''),
    }

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def load_metadata():
    """Load metadata from JSON file. Survives a corrupted file by returning {}.
    Also rejects valid JSON that isn't a top-level object (C: shape validation)."""
    if not os.path.exists(METADATA_FILE):
        return {}
    try:
        with open(METADATA_FILE, 'r') as f:
            parsed = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        app.logger.warning('metadata.json unreadable (%s); falling back to empty.', e)
        return {}
    if not isinstance(parsed, dict):
        app.logger.warning('metadata.json is not a JSON object (%r); falling back to empty.', type(parsed).__name__)
        return {}
    return parsed

def save_metadata(metadata):
    """Atomically persist metadata. Writes a sibling .tmp file and renames it
    so a crash mid-write can never produce a half-written / empty metadata.json."""
    # ε: write to a temp file in the same directory, then os.replace (atomic on POSIX
    # and on Windows when both paths sit on the same volume).
    tmp_path = METADATA_FILE + '.tmp'
    with open(tmp_path, 'w') as f:
        json.dump(metadata, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, METADATA_FILE)

def generate_filename(make, model_type, model, capacity, original_ext='.pdf'):
    """Generate a standardized filename from metadata"""
    # Sanitize inputs - remove special characters and replace spaces
    make_clean = make.replace(' ', '_').replace('/', '_').lower()
    type_clean = model_type.replace(' ', '_').replace('/', '_').lower()
    model_clean = model.replace(' ', '_').replace('/', '_').lower()
    capacity_clean = capacity.replace(' ', '_').replace('/', '_').lower()
    
    # Create filename: make_type_model_capacity.pdf
    filename = f"{make_clean}_{type_clean}_{model_clean}_{capacity_clean}{original_ext}"
    
    # Remove any remaining special characters except underscore and dot
    filename = ''.join(c if c.isalnum() or c in '._-' else '' for c in filename)
    
    return filename

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/pdfs", methods=['GET'])
def get_pdfs():
    """List all uploaded PDFs with metadata"""
    try:
        metadata = load_metadata()
        files = []
        for filename in os.listdir(UPLOAD_FOLDER):
            if filename.lower().endswith('.pdf'):
                filepath = os.path.join(UPLOAD_FOLDER, filename)
                file_data = {
                    'name': filename,
                    'size': os.path.getsize(filepath),
                    'url': f"/uploads/{filename}"
                }
                # Add metadata if available
                if filename in metadata:
                    file_data.update(metadata[filename])
                files.append(file_data)
        return jsonify(sorted(files, key=lambda x: x['name']))
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route("/api/upload", methods=['POST'])
def upload_file():
    """Upload a PDF file with metadata"""
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

    # B: enforce per-field length cap with a clean 400.
    try:
        cap_field(make, 'Manufacturer')
        cap_field(model_type, 'Type')
        cap_field(model, 'Model')
        cap_field(capacity, 'Capacity')
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    try:
        # Generate filename from metadata
        filename = generate_filename(make, model_type, model, capacity, '.pdf')
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        # H: lock around the load+save sequence so concurrent uploads can't lose entries.
        with metadata_lock():
            if os.path.exists(filepath):
                return jsonify({'error': 'File with these specifications already exists'}), 409
            file.save(filepath)
            metadata = load_metadata()
            metadata[filename] = {
                'make': make,
                'type': model_type,
                'model': model,
                'capacity': capacity,
                'uploaded_at': datetime.now().isoformat(),
                'original_filename': secure_filename(file.filename),
            }
            save_metadata(metadata)

        return jsonify({
            'success': True,
            'name': filename,
            'url': f"/uploads/{filename}",
            'make': make,
            'type': model_type,
            'model': model,
            'capacity': capacity
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route("/api/metadata/<filename>", methods=['PUT'])
def update_metadata(filename):
    """Edit metadata for an existing PDF. Renames the file on disk if the
    derived filename changes (because the filename is a deterministic slug
    of make/type/model/capacity)."""
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

        # B: enforce per-field length cap.
        try:
            cap_field(make, 'Manufacturer')
            cap_field(model_type, 'Type')
            cap_field(model, 'Model')
            cap_field(capacity, 'Capacity')
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

        # H: full lock around the load+rename+save sequence.
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
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route("/uploads/<path:filename>", methods=['GET'])
def download_file(filename):
    """Serve uploaded PDF files. Sanitize the error so we don't leak absolute server
    paths in the response body for missing files."""
    try:
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)
    except NotFound:
        return jsonify({'error': 'File not found'}), 404

@app.route("/api/delete/<filename>", methods=['DELETE'])
def delete_file(filename):
    """Delete a PDF file"""
    try:
        filename = secure_filename(filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        # Delete file
        os.remove(filepath)
        
        # Delete metadata
        metadata = load_metadata()
        if filename in metadata:
            del metadata[filename]
            save_metadata(metadata)
        
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)