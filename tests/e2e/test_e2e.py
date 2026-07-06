"""R-026: Playwright end-to-end tests for Crane Charts.

These tests run against a live Flask server (see conftest.py) and exercise
the golden path through the browser UI. They complement the unit/integration
tests in tests/test_app.py which cover validation edge-cases and concurrency.
"""
import base64
import json
import os

import pytest
from playwright.sync_api import Page, expect


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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

_PDF_B64 = base64.b64encode(TINY_PDF).decode()


def _csrf_token(page: Page) -> str:
    """Return the crane_csrf cookie value (minted on the first GET to the server)."""
    for c in page.context.cookies():
        if c['name'] == 'crane_csrf':
            return c['value']
    raise RuntimeError('crane_csrf cookie not found — call page.goto() first')


def _api_upload(page: Page, base_url: str, *, make: str, model_type: str,
                model: str, capacity: str) -> dict:
    """Upload a PDF via the API from within the browser context (bypasses drag-drop
    for test setup) and return the parsed JSON response."""
    csrf = _csrf_token(page)
    return page.evaluate(
        '''async ([url, csrf, make, model_type, model, capacity, pdfB64]) => {
            const bytes = Uint8Array.from(atob(pdfB64), c => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const fd = new FormData();
            fd.append('file', blob, 'test.pdf');
            fd.append('make', make);
            fd.append('type', model_type);
            fd.append('model', model);
            fd.append('capacity', capacity);
            const r = await fetch(url + '/api/upload', {
                method: 'POST',
                headers: { 'X-CSRF-Token': csrf },
                body: fd,
            });
            return r.json();
        }''',
        [base_url, csrf, make, model_type, model, capacity, _PDF_B64],
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPageLoad:
    def test_app_loads_and_shows_expected_ui(self, page: Page, live_server: str):
        """The root URL returns the app shell with required elements."""
        page.goto(live_server)
        expect(page).to_have_title('Crane Charts')
        expect(page.locator('#upload-trigger')).to_be_visible()
        # The confirm modal exists in the DOM (hidden until needed).
        expect(page.locator('#confirm-modal')).to_be_attached()

    def test_health_endpoint_returns_ok(self, page: Page, live_server: str):
        """GET /health returns JSON {status: ok}. Use the request API, not page.content()."""
        resp = page.request.get(f'{live_server}/health')
        assert resp.status == 200
        body = resp.json()
        assert body.get('status') == 'ok'
        assert 'uploads' in body


class TestUploadFlow:
    def test_upload_via_ui_file_picker(self, page: Page, live_server: str, tmp_path):
        """Select a PDF via the hidden file-input inside the upload modal."""
        pdf_path = str(tmp_path / 'ui_upload.pdf')
        with open(pdf_path, 'wb') as f:
            f.write(TINY_PDF)

        page.goto(live_server)
        # Open the upload modal via the app-bar button.
        page.locator('#upload-trigger').click()
        expect(page.locator('#metadata-modal')).to_be_visible(timeout=3000)

        # Playwright can set files on hidden inputs directly.
        page.locator('#file-input').set_input_files(pdf_path)
        page.locator('#make-input').fill('Liebherr')
        page.locator('#type-input').fill('Mobile')
        page.locator('#model-input').fill('LTM100')
        page.locator('#capacity-input').fill('100t')

        page.locator('#form-submit-btn').click()

        # Modal closes on success.
        expect(page.locator('#metadata-modal')).not_to_be_visible(timeout=5000)

        # The uploaded file should appear in the sidebar after the JS reloads the list.
        expect(page.locator('.make-item').first).to_be_visible(timeout=5000)

    def test_api_upload_appears_in_sidebar(self, page: Page, live_server: str):
        """Upload via fetch API then verify the manufacturer appears in the sidebar.
        Because the raw fetch bypasses the JS upload handler, we reload to trigger
        a fresh /api/pdfs fetch and sidebar render."""
        page.goto(live_server)
        result = _api_upload(page, live_server,
                              make='Tadano', model_type='All Terrain',
                              model='AC100', capacity='100t')
        assert result.get('success'), f'Upload failed: {result}'

        page.reload()
        page.wait_for_load_state('networkidle')
        expect(page.locator('.make-item').filter(has_text='Tadano')).to_be_visible(timeout=5000)


class TestEditFlow:
    def test_edit_metadata_via_action_button(self, page: Page, live_server: str):
        """Click the per-model edit action and save with a changed capacity field."""
        page.goto(live_server)

        result = _api_upload(page, live_server,
                              make='Grove', model_type='Crawler',
                              model='GHC130', capacity='130t')
        assert result.get('success'), f'Upload failed: {result}'

        # Reload to get the freshly uploaded file into the sidebar.
        page.reload()
        page.wait_for_load_state('networkidle')

        # The make button must appear; click it to populate the model list.
        make_btn = page.locator('.make-item').filter(has_text='Grove')
        expect(make_btn).to_be_visible(timeout=5000)
        make_btn.click()

        # Wait for the model row to appear and click the edit action.
        edit_btn = page.locator('.model-item__action--edit').first
        expect(edit_btn).to_be_visible(timeout=5000)
        edit_btn.click()

        # Modal opens in edit mode.
        expect(page.locator('#metadata-modal')).to_be_visible(timeout=3000)

        cap_input = page.locator('#capacity-input')
        cap_input.clear()
        cap_input.fill('140t')

        page.locator('#form-submit-btn').click()

        # Modal closes on success.
        expect(page.locator('#metadata-modal')).not_to_be_visible(timeout=5000)


class TestDeleteFlow:
    def test_delete_file_via_action_button(self, page: Page, live_server: str):
        """Click the per-model delete action, confirm the dialog, verify the file row
        is removed from the DOM and from the API catalogue."""
        page.goto(live_server)

        result = _api_upload(page, live_server,
                              make='Manitowoc', model_type='Crawler',
                              model='18000', capacity='2300t')
        assert result.get('success'), f'Upload failed: {result}'
        filename = result['name']

        page.reload()
        page.wait_for_load_state('networkidle')

        make_btn = page.locator('.make-item').filter(has_text='Manitowoc')
        expect(make_btn).to_be_visible(timeout=5000)
        make_btn.click()

        # The specific model row identified by data-filename must be visible first.
        target_row = page.locator(f'.model-item[data-filename="{filename}"]')
        expect(target_row).to_be_visible(timeout=5000)

        target_row.locator('.model-item__action--delete').click()

        # The confirm dialog must appear.
        expect(page.locator('#confirm-modal')).to_be_visible(timeout=3000)
        page.locator('#confirm-ok').click()

        # After the sidebar refresh the target row must be gone from the DOM.
        expect(target_row).not_to_be_attached(timeout=5000)

        # Also verify the file is absent from the API catalogue.
        resp = page.request.get(f'{live_server}/api/pdfs')
        assert all(f['name'] != filename for f in resp.json()['items']), \
            f'{filename} still present in /api/pdfs after deletion'


class TestVirtualScrolling:
    def test_large_make_renders_incrementally(self, page: Page, live_server: str, uploads_dir):
        """R-017: seed enough files to exceed one render batch
        (MODEL_RENDER_BATCH_SIZE = 60 in static/main.js) by writing them directly
        into the uploads folder — bypassing the 10/min upload rate limit — with no
        metadata row, so they group under the 'Unknown' make. Verifies the sidebar
        renders only a first batch, then reveals the rest as #model-list is
        scrolled (the IntersectionObserver sentinel firing)."""
        total = 75
        for i in range(total):
            with open(os.path.join(uploads_dir, f'vscroll_{i:03d}.pdf'), 'wb') as f:
                f.write(TINY_PDF)

        page.goto(live_server)
        page.wait_for_load_state('networkidle')

        make_btn = page.locator('.make-item').filter(has_text='Unknown')
        expect(make_btn).to_be_visible(timeout=5000)
        make_btn.click()

        rendered_first = page.locator('.model-item').count()
        assert 0 < rendered_first < total, (
            f'expected a partial first batch, got {rendered_first} of {total} rows'
        )

        # Scroll the sentinel into view to trigger subsequent batches.
        model_list = page.locator('#model-list')
        for _ in range(10):
            if page.locator('.model-item').count() >= total:
                break
            model_list.evaluate('el => el.scrollTo(0, el.scrollHeight)')
            page.wait_for_timeout(150)

        expect(page.locator('.model-item')).to_have_count(total, timeout=5000)
