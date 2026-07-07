"""End-to-end backend coverage. Exercises every mutating route through the CSRF
guard, the file lock, the field cap, and the round-trip into the metadata store.
"""
import io
import json
import os
import sqlite3
import threading
import time

import pytest

import app as app_module
from .conftest import upload, tiny_pdf_file, TINY_PDF


def _hdrs(token):
    return {'X-CSRF-Token': token, 'Cookie': f'{app_module.CSRF_COOKIE}={token}'}


def _add_file(client, token, crane_id, *, filename='extra.pdf', label='Outrigger', body=None):
    """Attach a supplementary PDF to an existing crane."""
    return client.post(
        f'/api/cranes/{crane_id}/files',
        data={'file': (io.BytesIO(body if body is not None else TINY_PDF), filename),
              'label': label},
        headers=_hdrs(token),
        content_type='multipart/form-data',
    )


# ----------------------------------------------------------------------
# Cookie + CSRF
# ----------------------------------------------------------------------

class TestCsrfAndCookies:
    def test_root_serves_html_and_sets_csrf_cookie(self, client):
        r = client.get('/')
        assert r.status_code == 200
        assert b'<dialog class="modal"' in r.data       # native dialog migration shipped
        assert b'Content-Security-Policy' not in r.data # CSP is a header, not body
        set_cookies = r.headers.getlist('Set-Cookie')
        assert any(h.startswith(f'{app_module.CSRF_COOKIE}=') for h in set_cookies)

    def test_forwarded_proto_ignored_without_trust_proxy(self, client):
        """R-027: unless CRANE_TRUST_PROXY=1 is set, X-Forwarded-Proto must not flip
        request.is_secure — otherwise any client could mint a 'Secure' CSRF cookie
        (or bypass rate-limit keying) just by sending a spoofed header directly."""
        r = client.get('/', headers={'X-Forwarded-Proto': 'https'})
        set_cookies = r.headers.getlist('Set-Cookie')
        csrf_cookie = next(h for h in set_cookies if h.startswith(f'{app_module.CSRF_COOKIE}='))
        assert '; Secure' not in csrf_cookie

    def test_csp_header_has_nonce_matching_inline_scripts(self, client):
        r = client.get('/')
        csp = r.headers['Content-Security-Policy']
        # Strict pieces we care about:
        assert "default-src 'self'" in csp
        assert "frame-ancestors 'none'" in csp
        assert "form-action 'self'" in csp
        # The CSP nonce should also appear on both inline <script> tags.
        nonce = csp.split("'nonce-", 1)[1].split("'", 1)[0]
        assert f'nonce="{nonce}"' in r.get_data(as_text=True)

    def test_mutating_without_csrf_header_is_rejected(self, client):
        client.get('/')                                # mint cookie
        r = client.delete('/api/delete/anything.pdf')  # no header → 403
        assert r.status_code == 403
        assert r.json['error']

    def test_get_endpoints_are_csrf_exempt(self, client):
        assert client.get('/api/pdfs').status_code == 200


# ----------------------------------------------------------------------
# Upload, edit, delete happy paths
# ----------------------------------------------------------------------

class TestUploadEditDelete:
    def test_upload_creates_file_and_metadata(self, client, csrf):
        r = upload(client, csrf, make='Tadano', model='AC100', capacity='100t')
        assert r.status_code == 201
        body = r.json
        assert body['success'] is True
        assert body['id'] == 'tadano_mobile_ac100_100t'
        assert body['name'] == body['id']          # sidebar keying compat
        assert body['file_count'] == 1
        primary = body['files'][0]
        assert primary['is_primary'] is True
        # The PDF lives under the crane's directory: uploads/<crane_id>/<stored_name>.
        stored_path = os.path.join(app_module.UPLOAD_FOLDER, body['id'], primary['stored_name'])
        assert os.path.exists(stored_path)
        crane = app_module.get_crane(body['id'])
        assert crane is not None
        assert crane['make'] == 'Tadano'

    def test_upload_duplicate_returns_409(self, client, csrf):
        upload(client, csrf)
        r = upload(client, csrf)  # same fields → same crane id
        assert r.status_code == 409

    def test_upload_accepts_primary_label(self, client, csrf):
        """The bulk importer passes a label for the crane's first file."""
        r = client.post(
            '/api/upload',
            data={'file': tiny_pdf_file(), 'make': 'Liebherr', 'type': 'Mobile',
                  'model': 'LTM1100', 'capacity': '100t', 'label': 'Load Chart'},
            headers=_hdrs(csrf),
            content_type='multipart/form-data',
        )
        assert r.status_code == 201
        assert r.json['files'][0]['label'] == 'Load Chart'

    def test_edit_with_rename(self, client, csrf):
        first = upload(client, csrf).json
        r = client.put(
            f'/api/metadata/{first["id"]}',
            json={'make': 'Tadano', 'type': 'Mobile', 'model': 'AC100', 'capacity': '200t'},
            headers=_hdrs(csrf),
        )
        assert r.status_code == 200
        assert r.json['renamed'] is True
        assert r.json['id'] == 'tadano_mobile_ac100_200t'
        # The crane directory is renamed; the old one is gone.
        assert not os.path.isdir(os.path.join(app_module.UPLOAD_FOLDER, first['id']))
        assert os.path.isdir(os.path.join(app_module.UPLOAD_FOLDER, r.json['id']))
        assert app_module.get_crane(first['id']) is None
        assert app_module.get_crane(r.json['id']) is not None

    def test_edit_in_place_preserves_uploaded_at(self, client, csrf):
        first = upload(client, csrf).json
        uploaded_at_before = app_module.get_crane(first['id'])['uploaded_at']
        # Same fields → no rename, but updated_at is set.
        client.put(
            f'/api/metadata/{first["id"]}',
            json={'make': 'Tadano', 'type': 'Mobile', 'model': 'AC100', 'capacity': '100t'},
            headers=_hdrs(csrf),
        )
        after = app_module.get_crane(first['id'])
        assert after['uploaded_at'] == uploaded_at_before
        assert after['updated_at'] is not None

    def test_delete_removes_file_and_metadata(self, client, csrf):
        first = upload(client, csrf).json
        r = client.delete(f'/api/delete/{first["id"]}', headers=_hdrs(csrf))
        assert r.status_code == 200
        assert not os.path.isdir(os.path.join(app_module.UPLOAD_FOLDER, first['id']))
        assert app_module.get_crane(first['id']) is None


# ----------------------------------------------------------------------
# Validation + error handling
# ----------------------------------------------------------------------

class TestValidation:
    def test_upload_rejects_non_pdf(self, client, csrf):
        import io
        r = client.post(
            '/api/upload',
            data={'file': (io.BytesIO(b'<html>'), 'evil.html'),
                  'make': 'X', 'type': 'X', 'model': 'X', 'capacity': '1t'},
            headers={'X-CSRF-Token': csrf, 'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
            content_type='multipart/form-data',
        )
        assert r.status_code == 400
        assert 'PDF' in r.json['error']

    @pytest.mark.parametrize('field,value', [
        ('make', 'X' * (app_module.MAX_FIELD_LEN + 1)),
        ('type_', 'Y' * (app_module.MAX_FIELD_LEN + 1)),
        ('model', 'Z' * (app_module.MAX_FIELD_LEN + 1)),
        ('capacity', 'W' * (app_module.MAX_FIELD_LEN + 1)),
    ])
    def test_field_length_cap_returns_400(self, client, csrf, field, value):
        r = upload(client, csrf, **{field: value})
        assert r.status_code == 400
        assert 'too long' in r.json['error']

    def test_edit_missing_fields_returns_400(self, client, csrf):
        first = upload(client, csrf).json
        r = client.put(
            f'/api/metadata/{first["name"]}',
            json={'make': '', 'type': 'X', 'model': 'X', 'capacity': '1t'},
            headers={'X-CSRF-Token': csrf, 'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
        )
        assert r.status_code == 400

    def test_http_exceptions_serialize_as_json(self, client, csrf):
        # PUT on an unknown filename → NotFound → @app.errorhandler(HTTPException)
        # routes it through jsonify rather than HTML.
        r = client.put(
            '/api/metadata/nonexistent.pdf',
            json={'make': 'A', 'type': 'B', 'model': 'C', 'capacity': '1t'},
            headers={'X-CSRF-Token': csrf, 'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
        )
        assert r.status_code == 404
        assert r.is_json
        assert r.json['error']

    def test_download_missing_does_not_leak_path(self, client):
        r = client.get('/uploads/no-such-file.pdf')
        assert r.status_code == 404
        assert r.is_json
        # The sanitized error: just "File not found", no /workspaces/... path.
        assert app_module.UPLOAD_FOLDER not in r.get_data(as_text=True)


# ----------------------------------------------------------------------
# Metadata persistence (load/save/lock)
# ----------------------------------------------------------------------

class TestMetadataPersistence:
    def test_list_cranes_empty_returns_empty_list(self, app):
        """A freshly initialised database (no rows) must return []."""
        with app.app_context():
            assert app_module.list_cranes() == []

    def test_get_crane_missing_returns_none(self, app):
        with app.app_context():
            assert app_module.get_crane('does_not_exist') is None

    def test_list_cranes_recovers_from_corrupt_db(self, app):
        """A corrupt SQLite file must not raise — it returns [] and logs a warning."""
        with open(app_module.DB_FILE, 'wb') as f:
            f.write(b'not a sqlite database')
        with app.app_context():
            assert app_module.list_cranes() == []

    def test_concurrent_metadata_writes_serialize(self, app):
        """Guardrail for metadata_lock() under contention. Each worker holds the lock,
        reads all crane rows, sleeps (to widen the window for lost-update races), and
        rewrites the table (DELETE + INSERT-all — the same read-modify-write pattern the
        routes rely on). Without the lock, simultaneous cycles would drop most rows;
        with it, all N persist."""
        N = 20
        errors = []

        def worker(i):
            try:
                with app.app_context():
                    with app_module.metadata_lock():
                        with sqlite3.connect(app_module.DB_FILE) as c:
                            c.row_factory = sqlite3.Row
                            rows = [dict(r) for r in c.execute('SELECT * FROM cranes')]
                            time.sleep(0.001)  # broaden the race window
                            rows.append({'id': f'c{i}', 'make': f'M{i}', 'type': 'T',
                                         'model': 'Md', 'capacity': '1t',
                                         'uploaded_at': '2026-01-01', 'updated_at': None,
                                         'primary_file': None})
                            c.execute('DELETE FROM cranes')
                            for r in rows:
                                c.execute(
                                    '''INSERT INTO cranes
                                       (id, make, type, model, capacity, uploaded_at, updated_at, primary_file)
                                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                                    (r['id'], r['make'], r['type'], r['model'], r['capacity'],
                                     r['uploaded_at'], r['updated_at'], r['primary_file']),
                                )
                            c.commit()
            except Exception as e:
                errors.append((i, repr(e)))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
        for t in threads: t.start()
        for t in threads: t.join(timeout=10)
        assert not errors, f'worker errors: {errors}'
        stored = app_module.list_cranes()
        assert len(stored) == N, f'expected {N} cranes, got {len(stored)}'


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

class TestHelpers:
    def test_generate_filename_sanitises_special_chars(self):
        out = app_module.generate_filename('Lieb herr', 'Mobile Crane', 'LTM 1200-3.1', '200 t')
        # Slug of "lieb_herr_mobile_crane_ltm_1200-3.1_200_t.pdf"
        assert out == 'lieb_herr_mobile_crane_ltm_1200-3.1_200_t.pdf'
        # No slashes or other path-traversal chars survive.
        assert '/' not in out and '..' not in out.replace('-3.1', '')

    def test_allowed_file(self):
        assert app_module.allowed_file('foo.pdf') is True
        assert app_module.allowed_file('FOO.PDF') is True
        assert app_module.allowed_file('foo.txt') is False
        assert app_module.allowed_file('foo') is False

    def test_is_valid_pdf_accepts_pdf_magic(self):
        """R-003: files starting with %PDF- pass the magic byte check."""
        from werkzeug.datastructures import FileStorage
        buf = io.BytesIO(b'%PDF-1.4 rest of content')
        fs = FileStorage(stream=buf, filename='test.pdf')
        assert app_module.is_valid_pdf(fs) is True
        assert buf.tell() == 0  # stream rewound

    def test_is_valid_pdf_rejects_non_pdf(self):
        """R-003: files with wrong magic bytes are rejected even with .pdf extension."""
        from werkzeug.datastructures import FileStorage
        buf = io.BytesIO(b'<html>not a pdf</html>')
        fs = FileStorage(stream=buf, filename='evil.pdf')
        assert app_module.is_valid_pdf(fs) is False


# ----------------------------------------------------------------------
# R-003: PDF magic bytes via upload endpoint
# ----------------------------------------------------------------------

class TestPdfMagicValidation:
    def test_upload_rejects_non_pdf_magic_with_pdf_extension(self, client, csrf):
        """R-003: a file named .pdf but containing HTML must be rejected with 400."""
        r = client.post(
            '/api/upload',
            data={
                'file': (io.BytesIO(b'<html>not a pdf</html>'), 'sneaky.pdf'),
                'make': 'X', 'type': 'X', 'model': 'X', 'capacity': '1t',
            },
            headers={'X-CSRF-Token': csrf, 'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
            content_type='multipart/form-data',
        )
        assert r.status_code == 400
        assert 'PDF' in r.json['error']


# ----------------------------------------------------------------------
# R-023: Health check endpoint
# ----------------------------------------------------------------------

class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        r = client.get('/health')
        assert r.status_code == 200
        assert r.json['status'] == 'ok'
        assert 'uploads' in r.json

    def test_health_is_csrf_exempt(self, client):
        """GET /health must work without CSRF cookie."""
        r = client.get('/health')
        assert r.status_code == 200

    def test_health_reflects_upload_count(self, client, csrf):
        r0 = client.get('/health')
        before = r0.json['uploads']
        upload(client, csrf)
        r1 = client.get('/health')
        assert r1.json['uploads'] == before + 1


# ----------------------------------------------------------------------
# R-025: Security headers
# ----------------------------------------------------------------------

class TestSecurityHeaders:
    def test_x_content_type_options(self, client):
        r = client.get('/')
        assert r.headers.get('X-Content-Type-Options') == 'nosniff'

    def test_referrer_policy(self, client):
        r = client.get('/')
        assert r.headers.get('Referrer-Policy') == 'strict-origin-when-cross-origin'

    def test_permissions_policy(self, client):
        r = client.get('/')
        pp = r.headers.get('Permissions-Policy', '')
        assert 'camera=()' in pp
        assert 'microphone=()' in pp
        assert 'geolocation=()' in pp


# ----------------------------------------------------------------------
# R-001: delete_file lock — concurrent delete cannot lose a concurrent upload
# ----------------------------------------------------------------------

class TestDeleteFileLock:
    def test_delete_does_not_lose_concurrent_upload(self, app, client, csrf):
        """R-001 regression: uploading N files while concurrently deleting each one
        must not drop any surviving file's metadata due to a missing lock.

        Strategy: upload N files sequentially so they all exist, then run N uploader
        threads (each uploading a *new* file) concurrently with N deleter threads
        (each deleting one of the pre-existing files). After all threads finish, every
        newly uploaded file must appear in metadata.
        """
        N = 10

        # Phase 1: pre-upload N cranes to be deleted later.
        victims = []
        for i in range(N):
            r = upload(client, csrf, make=f'Del{i}', type_='T', model='M', capacity='1t')
            assert r.status_code == 201, f'pre-upload {i} failed: {r.json}'
            victims.append(r.json['id'])

        # Reset rate-limit counters so the concurrent phase starts with a clean slate.
        app_module.limiter.reset()

        # Phase 2: concurrently upload N new files and delete the N victims.
        new_names = [f'new_{i}' for i in range(N)]
        errors = []

        def do_upload(i):
            try:
                r = upload(client, csrf, make=f'New{i}', type_='T', model='M', capacity='2t')
                if r.status_code != 201:
                    errors.append(('upload', i, r.json))
            except Exception as e:
                errors.append(('upload_exc', i, repr(e)))

        def do_delete(name):
            try:
                r = client.delete(
                    f'/api/delete/{name}',
                    headers={'X-CSRF-Token': csrf,
                             'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
                )
                if r.status_code not in (200, 404):
                    errors.append(('delete', name, r.json))
            except Exception as e:
                errors.append(('delete_exc', name, repr(e)))

        threads = (
            [threading.Thread(target=do_upload, args=(i,)) for i in range(N)]
            + [threading.Thread(target=do_delete, args=(v,)) for v in victims]
        )
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=15)

        assert not errors, f'thread errors: {errors}'

        # Every new upload must be present as a crane.
        stored_ids = {c['id'] for c in app_module.list_cranes()}

        missing = []
        for i in range(N):
            expected = app_module.generate_crane_id(f'New{i}', 'T', 'M', '2t')
            if expected not in stored_ids:
                missing.append(expected)

        assert not missing, f'metadata lost for: {missing}'


# ----------------------------------------------------------------------
# R-013: Rate limiting
# ----------------------------------------------------------------------

class TestRateLimiting:
    def test_upload_rate_limit_returns_429(self, app, client, csrf):
        """Exceeding the configured upload rate from the same IP triggers a 429.
        The limit is a config-driven callable, so the test pins it low."""
        app.config['UPLOAD_RATE'] = '5 per minute'
        app_module.limiter.reset()
        succeeded = 0
        hit_limit = False
        for i in range(15):
            r = upload(client, csrf, make=f'RL{i}', type_='T', model='M', capacity=f'{i}t')
            if r.status_code == 201:
                succeeded += 1
            elif r.status_code == 429:
                hit_limit = True
                assert r.is_json
                assert 'error' in r.json
                break
        assert hit_limit, f'expected a 429 after 5 uploads; got {succeeded} successes with no 429'


# ----------------------------------------------------------------------
# R-011: Cursor-based pagination
# ----------------------------------------------------------------------

class TestPagination:
    def test_get_pdfs_returns_new_shape(self, client, csrf):
        """R-011: GET /api/pdfs must return {items, total, next_cursor}."""
        r = client.get('/api/pdfs')
        assert r.status_code == 200
        body = r.json
        assert 'items' in body
        assert 'total' in body
        assert 'next_cursor' in body

    def test_get_pdfs_cursor_pagination(self, client, csrf):
        """R-011: ?after=<filename>&limit=N returns correct slice and next_cursor."""
        # Upload 3 files so we have a= bc= cd= set to paginate over.
        names = []
        for i in range(3):
            r = upload(client, csrf, make=f'Pg{i:02}', type_='T', model='M', capacity='1t')
            assert r.status_code == 201
            names.append(r.json['name'])
        names.sort()

        # Page 1: first 2 items. next_cursor is the last item on this page.
        r1 = client.get('/api/pdfs?limit=2')
        assert r1.json['total'] == 3
        assert len(r1.json['items']) == 2
        assert [f['name'] for f in r1.json['items']] == names[:2]
        assert r1.json['next_cursor'] == names[1]  # last of page 1

        # Page 2: send ?after=<last-of-page-1> to get items that come after it.
        cursor = r1.json['next_cursor']
        r2 = client.get(f'/api/pdfs?after={cursor}&limit=2')
        assert len(r2.json['items']) == 1
        assert r2.json['next_cursor'] is None
        assert r2.json['items'][0]['name'] == names[2]

    def test_get_pdfs_no_limit_returns_all(self, client, csrf):
        """R-011: omitting ?limit returns all items with next_cursor=null."""
        upload(client, csrf, make='All1', type_='T', model='M', capacity='1t')
        upload(client, csrf, make='All2', type_='T', model='M', capacity='1t')
        r = client.get('/api/pdfs')
        assert r.json['next_cursor'] is None
        assert r.json['total'] == len(r.json['items'])


# ----------------------------------------------------------------------
# R-021: Export endpoint
# ----------------------------------------------------------------------

class TestExportEndpoint:
    def test_export_returns_json_attachment(self, client, csrf):
        """R-021: GET /api/export returns application/json with a Content-Disposition attachment."""
        upload(client, csrf)
        r = client.get('/api/export')
        assert r.status_code == 200
        assert r.content_type.startswith('application/json')
        assert 'attachment' in r.headers.get('Content-Disposition', '')
        body = json.loads(r.data)
        assert isinstance(body, dict)
        assert len(body) == 1

    def test_export_empty_catalogue(self, client):
        """R-021: export on an empty catalogue returns an empty JSON object."""
        r = client.get('/api/export')
        assert r.status_code == 200
        assert json.loads(r.data) == {}

    def test_export_is_csrf_exempt(self, client):
        """GET /api/export must work without a CSRF token (GET is exempt)."""
        r = client.get('/api/export')
        assert r.status_code == 200


# ----------------------------------------------------------------------
# R-020: Audit trail
# ----------------------------------------------------------------------

class TestAuditTrail:
    def test_upload_logs_audit_event(self, app, client, csrf):
        """R-020: a successful upload must create an 'upload' event in spec_events."""
        r = upload(client, csrf)
        assert r.status_code == 201
        with sqlite3.connect(app_module.DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM spec_events WHERE event_type='upload'"
            ).fetchall()
        assert len(rows) == 1
        assert rows[0]['filename'] == r.json['name']
        assert rows[0]['snapshot_before'] is None
        assert rows[0]['snapshot_after'] is not None

    def test_delete_logs_audit_event(self, app, client, csrf):
        """R-020: a successful delete must create a 'delete' event in spec_events."""
        r = upload(client, csrf)
        name = r.json['name']
        client.delete(
            f'/api/delete/{name}',
            headers={'X-CSRF-Token': csrf, 'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
        )
        with sqlite3.connect(app_module.DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM spec_events WHERE event_type='delete'"
            ).fetchall()
        assert len(rows) == 1
        assert rows[0]['filename'] == name
        assert rows[0]['snapshot_before'] is not None
        assert rows[0]['snapshot_after'] is None

    def test_edit_logs_audit_event(self, app, client, csrf):
        """R-020: a successful edit must create an 'edit' event in spec_events."""
        r = upload(client, csrf)
        name = r.json['name']
        client.put(
            f'/api/metadata/{name}',
            json={'make': 'Tadano', 'type': 'Mobile', 'model': 'AC100', 'capacity': '200t'},
            headers={'X-CSRF-Token': csrf, 'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
        )
        with sqlite3.connect(app_module.DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM spec_events WHERE event_type='edit'"
            ).fetchall()
        assert len(rows) == 1
        assert rows[0]['snapshot_before'] is not None
        assert rows[0]['snapshot_after'] is not None

    def test_add_file_logs_event(self, app, client, csrf):
        """A supplementary file upload must log a 'file_add' event."""
        crane = upload(client, csrf).json
        _add_file(client, csrf, crane['id'], label='Outrigger')
        with sqlite3.connect(app_module.DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM spec_events WHERE event_type='file_add'"
            ).fetchall()
        assert len(rows) == 1
        assert rows[0]['filename'] == crane['id']


# ----------------------------------------------------------------------
# Multi-file per crane (files, primary selection, per-file delete)
# ----------------------------------------------------------------------

class TestMultiFile:
    def test_add_file_to_crane(self, client, csrf):
        crane = upload(client, csrf).json
        r = _add_file(client, csrf, crane['id'], filename='outrigger.pdf', label='Outrigger chart')
        assert r.status_code == 201
        assert r.json['file_count'] == 2
        labels = [f['label'] for f in r.json['files']]
        assert 'Outrigger chart' in labels
        # Exactly one primary remains after adding a supplementary file.
        assert sum(1 for f in r.json['files'] if f['is_primary']) == 1
        # Both files live on disk under the crane directory.
        crane_dir = os.path.join(app_module.UPLOAD_FOLDER, crane['id'])
        assert len(os.listdir(crane_dir)) == 2

    def test_add_file_to_missing_crane_returns_404(self, client, csrf):
        r = _add_file(client, csrf, 'no_such_crane', label='x')
        assert r.status_code == 404

    def test_add_file_rejects_non_pdf(self, client, csrf):
        crane = upload(client, csrf).json
        r = _add_file(client, csrf, crane['id'], filename='evil.pdf', body=b'<html>nope</html>')
        assert r.status_code == 400
        assert 'PDF' in r.json['error']

    def test_add_file_dedupes_stored_name(self, client, csrf):
        """Two supplementary files with the same original name don't collide on disk."""
        crane = upload(client, csrf).json
        _add_file(client, csrf, crane['id'], filename='dims.pdf', label='A')
        r = _add_file(client, csrf, crane['id'], filename='dims.pdf', label='B')
        assert r.status_code == 201
        stored = sorted(f['stored_name'] for f in r.json['files'])
        assert len(set(stored)) == len(stored)  # all unique

    def test_set_primary_switches_default_file(self, client, csrf):
        crane = upload(client, csrf).json
        add = _add_file(client, csrf, crane['id']).json
        supp = next(f for f in add['files'] if not f['is_primary'])
        r = client.put(
            f'/api/cranes/{crane["id"]}/primary',
            json={'file_id': supp['id']},
            headers=_hdrs(csrf),
        )
        assert r.status_code == 200
        assert r.json['primary_file_id'] == supp['id']
        primary = next(f for f in r.json['files'] if f['is_primary'])
        assert primary['id'] == supp['id']
        # The crane's convenience `url` now points at the new primary.
        assert r.json['url'] == primary['url']

    def test_set_primary_unknown_file_returns_404(self, client, csrf):
        crane = upload(client, csrf).json
        r = client.put(
            f'/api/cranes/{crane["id"]}/primary',
            json={'file_id': 999999},
            headers=_hdrs(csrf),
        )
        assert r.status_code == 404

    def test_set_primary_missing_file_id_returns_400(self, client, csrf):
        crane = upload(client, csrf).json
        r = client.put(f'/api/cranes/{crane["id"]}/primary', json={}, headers=_hdrs(csrf))
        assert r.status_code == 400

    def test_delete_one_file_keeps_crane(self, client, csrf):
        crane = upload(client, csrf).json
        add = _add_file(client, csrf, crane['id']).json
        supp = next(f for f in add['files'] if not f['is_primary'])
        r = client.delete(f'/api/cranes/{crane["id"]}/files/{supp["id"]}', headers=_hdrs(csrf))
        assert r.status_code == 200
        assert r.json['crane_deleted'] is False
        assert r.json['file_count'] == 1
        assert app_module.get_crane(crane['id']) is not None

    def test_delete_last_file_deletes_crane(self, client, csrf):
        crane = upload(client, csrf).json
        only = crane['files'][0]
        r = client.delete(f'/api/cranes/{crane["id"]}/files/{only["id"]}', headers=_hdrs(csrf))
        assert r.status_code == 200
        assert r.json['crane_deleted'] is True
        assert app_module.get_crane(crane['id']) is None
        assert not os.path.isdir(os.path.join(app_module.UPLOAD_FOLDER, crane['id']))

    def test_delete_primary_falls_back_to_remaining(self, client, csrf):
        crane = upload(client, csrf).json
        primary = crane['files'][0]
        add = _add_file(client, csrf, crane['id']).json
        supp = next(f for f in add['files'] if not f['is_primary'])
        r = client.delete(f'/api/cranes/{crane["id"]}/files/{primary["id"]}', headers=_hdrs(csrf))
        assert r.status_code == 200
        assert r.json['crane_deleted'] is False
        remaining = r.json['files']
        assert len(remaining) == 1
        assert remaining[0]['id'] == supp['id']
        assert remaining[0]['is_primary'] is True

    def test_delete_file_on_missing_crane_returns_404(self, client, csrf):
        r = client.delete('/api/cranes/nope/files/1', headers=_hdrs(csrf))
        assert r.status_code == 404

    def test_edit_file_label(self, client, csrf):
        crane = upload(client, csrf).json
        fid = crane['files'][0]['id']
        r = client.patch(
            f'/api/cranes/{crane["id"]}/files/{fid}',
            json={'label': 'Primary load chart'},
            headers=_hdrs(csrf),
        )
        assert r.status_code == 200
        edited = next(f for f in r.json['files'] if f['id'] == fid)
        assert edited['label'] == 'Primary load chart'

    def test_edit_label_too_long_returns_400(self, client, csrf):
        crane = upload(client, csrf).json
        fid = crane['files'][0]['id']
        r = client.patch(
            f'/api/cranes/{crane["id"]}/files/{fid}',
            json={'label': 'X' * (app_module.MAX_FIELD_LEN + 1)},
            headers=_hdrs(csrf),
        )
        assert r.status_code == 400

    def test_edit_label_unknown_file_returns_404(self, client, csrf):
        crane = upload(client, csrf).json
        r = client.patch(
            f'/api/cranes/{crane["id"]}/files/999999',
            json={'label': 'x'},
            headers=_hdrs(csrf),
        )
        assert r.status_code == 404
