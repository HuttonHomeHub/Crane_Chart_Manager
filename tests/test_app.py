"""End-to-end backend coverage. Exercises every mutating route through the CSRF
guard, the file lock, the field cap, and the round-trip into the metadata store.
"""
import json
import os
import threading
import time

import pytest

import app as app_module
from .conftest import upload, tiny_pdf_file


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
        assert body['name'] == 'tadano_mobile_ac100_100t.pdf'
        assert os.path.exists(os.path.join(app_module.UPLOAD_FOLDER, body['name']))
        with open(app_module.METADATA_FILE) as f:
            stored = json.load(f)
        assert body['name'] in stored
        assert stored[body['name']]['make'] == 'Tadano'

    def test_upload_duplicate_returns_409(self, client, csrf):
        upload(client, csrf)
        r = upload(client, csrf)  # same fields → same derived filename
        assert r.status_code == 409

    def test_edit_with_rename(self, client, csrf):
        first = upload(client, csrf).json
        r = client.put(
            f'/api/metadata/{first["name"]}',
            json={'make': 'Tadano', 'type': 'Mobile', 'model': 'AC100', 'capacity': '200t'},
            headers={'X-CSRF-Token': csrf, 'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
        )
        assert r.status_code == 200
        assert r.json['renamed'] is True
        assert r.json['name'] == 'tadano_mobile_ac100_200t.pdf'
        # On-disk file renamed, old name gone.
        assert not os.path.exists(os.path.join(app_module.UPLOAD_FOLDER, first['name']))
        assert os.path.exists(os.path.join(app_module.UPLOAD_FOLDER, r.json['name']))

    def test_edit_in_place_preserves_uploaded_at(self, client, csrf):
        first = upload(client, csrf).json
        with open(app_module.METADATA_FILE) as f:
            uploaded_at_before = json.load(f)[first['name']]['uploaded_at']
        # Same fields → no rename, but updated_at added.
        client.put(
            f'/api/metadata/{first["name"]}',
            json={'make': 'Tadano', 'type': 'Mobile', 'model': 'AC100', 'capacity': '100t'},
            headers={'X-CSRF-Token': csrf, 'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
        )
        with open(app_module.METADATA_FILE) as f:
            after = json.load(f)[first['name']]
        assert after['uploaded_at'] == uploaded_at_before
        assert 'updated_at' in after

    def test_delete_removes_file_and_metadata(self, client, csrf):
        first = upload(client, csrf).json
        r = client.delete(
            f'/api/delete/{first["name"]}',
            headers={'X-CSRF-Token': csrf, 'Cookie': f'{app_module.CSRF_COOKIE}={csrf}'},
        )
        assert r.status_code == 200
        assert not os.path.exists(os.path.join(app_module.UPLOAD_FOLDER, first['name']))
        with open(app_module.METADATA_FILE) as f:
            assert first['name'] not in json.load(f)


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
    def test_save_metadata_is_atomic(self, app):
        with app.app_context():
            app_module.save_metadata({'a.pdf': {'make': 'A'}})
        # tmp file should be gone after replace
        assert not os.path.exists(app_module.METADATA_FILE + '.tmp')
        with open(app_module.METADATA_FILE) as f:
            assert json.load(f) == {'a.pdf': {'make': 'A'}}

    def test_load_metadata_recovers_from_corrupt_json(self, app):
        with open(app_module.METADATA_FILE, 'w') as f:
            f.write('not valid json {')
        with app.app_context():
            assert app_module.load_metadata() == {}

    def test_load_metadata_rejects_non_dict_shape(self, app):
        with open(app_module.METADATA_FILE, 'w') as f:
            f.write('[1, 2, 3]')
        with app.app_context():
            assert app_module.load_metadata() == {}

    def test_concurrent_metadata_writes_serialize(self, app):
        """Two-phase test of the fcntl lock under contention. Each worker holds the
        lock, reads, sleeps briefly (to widen the window for lost-update races),
        writes back. Without the lock, simultaneous read-modify-write would drop
        most entries; with it, all N persist."""
        N = 20
        errors = []

        def worker(i):
            try:
                with app.app_context():
                    with app_module.metadata_lock():
                        m = app_module.load_metadata()
                        time.sleep(0.001)  # broaden the race window
                        m[f'file_{i}.pdf'] = {'make': f'M{i}'}
                        app_module.save_metadata(m)
            except Exception as e:
                errors.append((i, repr(e)))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
        for t in threads: t.start()
        for t in threads: t.join(timeout=10)
        assert not errors, f'worker errors: {errors}'
        with open(app_module.METADATA_FILE) as f:
            stored = json.load(f)
        assert len(stored) == N, f'expected {N} entries, got {len(stored)}: {list(stored)}'


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
