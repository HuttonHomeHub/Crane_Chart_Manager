"""Shared fixtures for the Crane Charts test suite.

Each test gets its own temp `uploads/` directory and a fresh `metadata.json`,
so tests are isolated from the developer's real catalogue and from each other.
"""
import io
import os
import sys

import pytest

# Make the parent directory importable so we can `import app`.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Flask 2.3.2 + Werkzeug 3.x mismatch: Flask's test_client reads `werkzeug.__version__`
# which Werkzeug 3 removed. Patch in a stub so the test client can construct itself.
# The runtime app doesn't hit this code path.
import werkzeug  # noqa: E402
if not hasattr(werkzeug, '__version__'):
    werkzeug.__version__ = 'unknown'

import app as app_module  # noqa: E402


TINY_PDF = (
    b'%PDF-1.4\n'
    b'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    b'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    b'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<<>>/Contents 4 0 R>>endobj\n'
    b'4 0 obj<</Length 23>>stream\nBT /F1 12 Tf 30 100 Td (hi) Tj ET\nendstream endobj\n'
    b'xref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n'
    b'0000000098 00000 n \n0000000171 00000 n \n'
    b'trailer<</Size 5/Root 1 0 R>>\nstartxref\n240\n%%EOF\n'
)


@pytest.fixture
def app(tmp_path, monkeypatch):
    """Flask app pinned to a per-test scratch UPLOAD_FOLDER + METADATA_FILE."""
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    metadata = tmp_path / "metadata.json"
    lock = tmp_path / "metadata.json.lock"

    monkeypatch.setattr(app_module, 'UPLOAD_FOLDER', str(uploads))
    monkeypatch.setattr(app_module, 'METADATA_FILE', str(metadata))
    monkeypatch.setattr(app_module, 'METADATA_LOCK', str(lock))
    app_module.app.config['UPLOAD_FOLDER'] = str(uploads)

    app_module.app.config['TESTING'] = True
    return app_module.app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def csrf(client):
    """Hit any GET to mint the CSRF cookie, return the token string for header echo.
    Parses Set-Cookie from the response headers (works in Werkzeug 2.x and 3.x)."""
    r = client.get('/api/pdfs')
    for header in r.headers.getlist('Set-Cookie'):
        if header.startswith(f'{app_module.CSRF_COOKIE}='):
            return header.split('=', 1)[1].split(';', 1)[0]
    raise RuntimeError('CSRF cookie was not set on response')


def tiny_pdf_file():
    """Fresh BytesIO so each upload gets an unread stream."""
    return (io.BytesIO(TINY_PDF), 'tiny.pdf')


def upload(client, token, *, make='Tadano', type_='Mobile', model='AC100', capacity='100t'):
    return client.post(
        '/api/upload',
        data={
            'file': tiny_pdf_file(),
            'make': make,
            'type': type_,
            'model': model,
            'capacity': capacity,
        },
        headers={
            'X-CSRF-Token': token,
            'Cookie': f'{app_module.CSRF_COOKIE}={token}',
        },
        content_type='multipart/form-data',
    )
