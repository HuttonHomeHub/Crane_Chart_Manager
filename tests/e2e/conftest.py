"""Live-server fixture for Playwright E2E tests.

Each test session gets a single Flask instance on a free port backed by a
temporary SQLite database in tmp_path. The server runs in a daemon thread so
it shuts down automatically when the test process exits.
"""
import os
import socket
import sys
import threading
import time

import pytest
from werkzeug.serving import make_server

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
import app as app_module


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


@pytest.fixture(scope='session')
def live_server(tmp_path_factory):
    """Start Flask in a background thread; yield the base URL."""
    base = tmp_path_factory.mktemp('e2e')
    db_path = str(base / 'e2e.db')
    uploads_path = str(base / 'uploads')
    os.makedirs(uploads_path)

    # Redirect storage globals before the server starts serving requests.
    app_module.DB_FILE = db_path
    app_module.UPLOAD_FOLDER = uploads_path
    app_module.app.config['UPLOAD_FOLDER'] = uploads_path
    app_module.init_db()

    port = _free_port()
    server = make_server('127.0.0.1', port, app_module.app)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    # Brief pause — make_server is synchronous but the socket needs a tick to bind.
    time.sleep(0.2)

    yield f'http://127.0.0.1:{port}'

    server.shutdown()


@pytest.fixture(scope='session')
def uploads_dir(live_server):
    """The live server's upload folder, for tests that seed files directly on
    disk (bypassing the API and its rate limiter)."""
    return app_module.UPLOAD_FOLDER
