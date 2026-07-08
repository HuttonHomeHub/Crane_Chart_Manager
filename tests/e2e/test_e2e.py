"""R-026: Playwright end-to-end tests for Crane Charts.

These tests run against a live Flask server (see conftest.py) and exercise
the golden path through the browser UI. They complement the unit/integration
tests in tests/test_app.py which cover validation edge-cases and concurrency.
"""
import base64
import json
import os
import re
import sqlite3

import pytest
from playwright.sync_api import Page, expect

import app as app_module


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


def _make_text_pdf(lines) -> str:
    """Build a minimal single-page PDF (Helvetica) whose text PDF.js can extract,
    one text item per line. Returns base64. Used by the in-PDF find test."""
    def esc(s):
        return s.replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)')
    show = "BT /F1 24 Tf 40 150 Td "
    for i, ln in enumerate(lines):
        if i:
            show += "0 -40 Td "
        show += f"({esc(ln)}) Tj "
    show += "ET"
    stream = show.encode('latin-1')
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj\n" + body + b"\nendobj\n"
    xref_pos = len(out)
    n = len(objs) + 1
    out += b"xref\n0 " + str(n).encode() + b"\n0000000000 65535 f \n"
    for off in offsets:
        out += ("%010d 00000 n \n" % off).encode()
    out += b"trailer\n<< /Size " + str(n).encode() + b" /Root 1 0 R >>\nstartxref\n"
    out += str(xref_pos).encode() + b"\n%%EOF\n"
    return base64.b64encode(bytes(out)).decode()


def _api_upload(page: Page, base_url: str, *, make: str, model_type: str,
                model: str, capacity: str, pdf_b64: str = _PDF_B64) -> dict:
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
        [base_url, csrf, make, model_type, model, capacity, pdf_b64],
    )


def _api_add_file(page: Page, base_url: str, crane_id: str, *, label='Extra') -> dict:
    """Attach a supplementary PDF to an existing crane from the browser context."""
    csrf = _csrf_token(page)
    return page.evaluate(
        '''async ([url, csrf, craneId, label, pdfB64]) => {
            const bytes = Uint8Array.from(atob(pdfB64), c => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const fd = new FormData();
            fd.append('file', blob, 'extra.pdf');
            fd.append('label', label);
            const r = await fetch(url + '/api/cranes/' + encodeURIComponent(craneId) + '/files', {
                method: 'POST',
                headers: { 'X-CSRF-Token': csrf },
                body: fd,
            });
            return r.json();
        }''',
        [base_url, csrf, crane_id, label, _PDF_B64],
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

    def test_version_label_and_endpoint(self, page: Page, live_server: str):
        """The app-bar shows a version label, and GET /version reports the same value."""
        ver = page.request.get(f'{live_server}/version').json()['version']
        assert ver
        page.goto(live_server)
        label = page.locator('.app-bar__version')
        expect(label).to_have_text(ver)


class TestUploadFlow:
    def test_duplicate_upload_shows_inline_error(self, page: Page, live_server: str, tmp_path):
        """A 409 on upload must surface INSIDE the dialog (a toast would render behind
        the native <dialog> top-layer backdrop)."""
        pdf_path = str(tmp_path / 'dup.pdf')
        with open(pdf_path, 'wb') as f:
            f.write(TINY_PDF)
        page.goto(live_server)
        # Seed a crane via the API.
        result = _api_upload(page, live_server, make='Dupe', model_type='Mobile',
                             model='DX1', capacity='50t')
        assert result.get('success')

        page.reload()
        page.locator('#upload-trigger').click()
        expect(page.locator('#metadata-modal')).to_be_visible(timeout=3000)
        page.locator('#file-input').set_input_files(pdf_path)
        page.locator('#make-input').fill('Dupe')
        page.locator('#type-input').fill('Mobile')
        page.locator('#model-input').fill('DX1')
        page.locator('#capacity-input').fill('50t')
        page.locator('#form-submit-btn').click()

        # Error shows inline; the dialog stays open.
        err = page.locator('#modal-error')
        expect(err).to_be_visible(timeout=5000)
        expect(err).to_contain_text('exist')
        expect(page.locator('#metadata-modal')).to_be_visible()

    def test_drop_pdf_on_picker_sets_and_prefills(self, page: Page, live_server: str):
        """Dropping a PDF onto the modal's file-picker box selects it and prefills
        make/model from the filename (the box looked droppable but wasn't)."""
        page.goto(live_server)
        page.locator('#upload-trigger').click()
        expect(page.locator('#metadata-modal')).to_be_visible(timeout=3000)
        page.evaluate('''() => {
            const dt = new DataTransfer();
            const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
            const file = new File([bytes], 'Grove GMK5150 (Load Chart).pdf', { type: 'application/pdf' });
            dt.items.add(file);
            document.getElementById('file-field').dispatchEvent(
                new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        }''')
        expect(page.locator('#file-picker-text')).to_have_text('Grove GMK5150 (Load Chart).pdf')
        expect(page.locator('#make-input')).to_have_value('Grove')
        expect(page.locator('#model-input')).to_have_value('GMK5150')

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
        """R-017: seed enough cranes to exceed one render batch
        (MODEL_RENDER_BATCH_SIZE = 60 in static/main.js) by inserting rows directly
        into the DB — bypassing the 10/min upload rate limit. All share one make
        ('Vscroll') so a single make click lists them all. Verifies the sidebar
        renders only a first batch, then reveals the rest as #model-list is scrolled
        (the IntersectionObserver sentinel firing)."""
        total = 75
        with sqlite3.connect(app_module.DB_FILE) as conn:
            for i in range(total):
                cid = f'vscroll_bulk_m{i:03d}_1t'
                conn.execute(
                    '''INSERT OR IGNORE INTO cranes (id, make, type, model, capacity, uploaded_at, updated_at, primary_file)
                       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)''',
                    (cid, 'Vscroll', 'Bulk', f'M{i:03d}', '1t', '2026-01-01'),
                )
                crane_dir = os.path.join(uploads_dir, cid)
                os.makedirs(crane_dir, exist_ok=True)
                with open(os.path.join(crane_dir, 'f.pdf'), 'wb') as fh:
                    fh.write(TINY_PDF)
                cur = conn.execute(
                    '''INSERT INTO files (crane_id, stored_name, original_filename, label, uploaded_at)
                       VALUES (?, ?, ?, ?, ?)''',
                    (cid, 'f.pdf', 'f.pdf', '', '2026-01-01'),
                )
                conn.execute('UPDATE cranes SET primary_file=? WHERE id=?', (cur.lastrowid, cid))
            conn.commit()

        page.goto(live_server)
        page.wait_for_load_state('networkidle')

        make_btn = page.locator('.make-item').filter(has_text='Vscroll')
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


class TestMultiFileUI:
    def test_file_strip_switch_and_set_primary(self, page: Page, live_server: str):
        """Upload a crane, attach a second file, then drive the viewer file strip:
        the row badge shows 2, opening the crane shows two chips, and setting the
        supplementary file as main flips the primary indicator."""
        page.goto(live_server)
        result = _api_upload(page, live_server,
                             make='Kobelco', model_type='Crawler',
                             model='CK1100', capacity='110t')
        assert result.get('success'), f'upload failed: {result}'
        crane_id = result['id']

        add = _api_add_file(page, live_server, crane_id, label='Outrigger chart')
        assert add.get('file_count') == 2, f'add-file failed: {add}'

        page.reload()
        page.wait_for_load_state('networkidle')

        make_btn = page.locator('.make-item').filter(has_text='Kobelco')
        expect(make_btn).to_be_visible(timeout=5000)
        make_btn.click()

        row = page.locator(f'.model-item[data-filename="{crane_id}"]')
        expect(row).to_be_visible(timeout=5000)
        expect(row.locator('.model-item__filecount')).to_have_text('2')

        row.locator('.model-item__body').click()

        # The strip appears with one chip per file.
        expect(page.locator('#file-strip')).to_be_visible(timeout=5000)
        expect(page.locator('.file-chip')).to_have_count(2)

        # Set the supplementary file as the main file via its star action.
        outrigger = page.locator('.file-chip').filter(has_text='Outrigger chart')
        expect(outrigger).to_have_count(1)
        outrigger.locator('.file-chip__action--primary').click()
        expect(outrigger).to_have_class(re.compile(r'\bis-primary\b'), timeout=5000)

        # Verify server-side that the primary actually changed.
        pdfs = page.request.get(f'{live_server}/api/pdfs').json()['items']
        crane = next(c for c in pdfs if c['id'] == crane_id)
        primary = next(f for f in crane['files'] if f['is_primary'])
        assert primary['label'] == 'Outrigger chart'

    def test_delete_supplementary_file_keeps_crane(self, page: Page, live_server: str):
        """Deleting a non-primary file via the strip removes just that chip and
        leaves the crane in place."""
        page.goto(live_server)
        result = _api_upload(page, live_server,
                             make='Sany', model_type='Crawler',
                             model='SCC8100', capacity='100t')
        assert result.get('success'), f'upload failed: {result}'
        crane_id = result['id']
        _api_add_file(page, live_server, crane_id, label='Transport dims')

        page.reload()
        page.wait_for_load_state('networkidle')

        page.locator('.make-item').filter(has_text='Sany').click()
        row = page.locator(f'.model-item[data-filename="{crane_id}"]')
        expect(row).to_be_visible(timeout=5000)
        row.locator('.model-item__body').click()

        expect(page.locator('.file-chip')).to_have_count(2)

        # Delete the supplementary file; confirm the dialog.
        supp = page.locator('.file-chip').filter(has_text='Transport dims')
        supp.locator('.file-chip__action--delete').click()
        expect(page.locator('#confirm-modal')).to_be_visible(timeout=3000)
        page.locator('#confirm-ok').click()

        # One chip remains; the crane still exists in the catalogue.
        expect(page.locator('.file-chip')).to_have_count(1, timeout=5000)
        pdfs = page.request.get(f'{live_server}/api/pdfs').json()['items']
        assert any(c['id'] == crane_id for c in pdfs)

    def test_rename_file_label(self, page: Page, live_server: str):
        """Feature 1a: the chip's edit action renames a file's label."""
        page.goto(live_server)
        result = _api_upload(page, live_server, make='Renamer', model_type='Crawler',
                             model='RN1', capacity='90t')
        crane_id = result['id']
        _api_add_file(page, live_server, crane_id, label='Old label')

        page.reload()
        page.wait_for_load_state('networkidle')
        page.locator('.make-item').filter(has_text='Renamer').click()
        row = page.locator(f'.model-item[data-filename="{crane_id}"]')
        expect(row).to_be_visible(timeout=5000)
        row.locator('.model-item__body').click()

        chip = page.locator('.file-chip').filter(has_text='Old label')
        expect(chip).to_have_count(1)
        chip.locator('.file-chip__action--edit').click()

        expect(page.locator('#metadata-modal')).to_be_visible(timeout=3000)
        page.locator('#label-input').fill('New label')
        page.locator('#form-submit-btn').click()
        expect(page.locator('#metadata-modal')).not_to_be_visible(timeout=5000)

        expect(page.locator('.file-chip').filter(has_text='New label')).to_have_count(1)
        expect(page.locator('.file-chip').filter(has_text='Old label')).to_have_count(0)


class TestFind:
    def test_in_pdf_find_highlights_and_navigates(self, page: Page, live_server: str):
        """Feature 2: search inside the open PDF — count, highlights, and next/prev."""
        pdf_b64 = _make_text_pdf(['Load chart 250t', 'Max radius 250t'])
        page.goto(live_server)
        result = _api_upload(page, live_server, make='FindCo', model_type='Mobile',
                             model='FX1', capacity='250t', pdf_b64=pdf_b64)
        assert result.get('success'), f'upload failed: {result}'

        page.reload()
        page.wait_for_load_state('networkidle')
        page.locator('.make-item').filter(has_text='FindCo').click()
        row = page.locator(f'.model-item[data-filename="{result["id"]}"]')
        expect(row).to_be_visible(timeout=5000)
        row.locator('.model-item__body').click()
        expect(page.locator('#pdf-canvas')).to_be_visible(timeout=5000)
        # Wait for the document to finish loading (page-total is set post-load).
        expect(page.locator('#page-total')).to_have_text('1', timeout=5000)

        # Open the find bar and search a term present on both lines.
        page.locator('#find-btn').click()
        expect(page.locator('#find-bar')).to_be_visible()
        page.locator('#find-input').fill('250t')

        expect(page.locator('#find-count')).to_have_text('1/2', timeout=5000)
        expect(page.locator('.pdf-highlight')).to_have_count(2)
        expect(page.locator('.pdf-highlight.is-current')).to_have_count(1)

        # Next advances the counter.
        page.locator('#find-next').click()
        expect(page.locator('#find-count')).to_have_text('2/2')

        # A miss reports 0/0 and clears highlights.
        page.locator('#find-input').fill('zzzznotfound')
        expect(page.locator('#find-count')).to_have_text('0/0', timeout=5000)
        expect(page.locator('.pdf-highlight')).to_have_count(0)


class TestBulkImport:
    def test_bulk_import_groups_and_creates_cranes(self, page: Page, live_server: str):
        """Select several PDFs → grouped into cranes by 'Manufacturer Model (Label)',
        fill Type/Capacity, pick a primary, submit → grouped cranes created."""
        page.goto(live_server)
        # Multi-select on the upload modal's picker routes to the bulk importer.
        page.locator('#upload-trigger').click()
        expect(page.locator('#metadata-modal')).to_be_visible(timeout=3000)
        page.locator('#file-input').set_input_files([
            {"name": "Liebherr LTM1100 (Load Chart).pdf", "mimeType": "application/pdf", "buffer": TINY_PDF},
            {"name": "Liebherr LTM1100 (Outrigger).pdf", "mimeType": "application/pdf", "buffer": TINY_PDF},
            {"name": "Tadano AC100 (Load Chart).pdf", "mimeType": "application/pdf", "buffer": TINY_PDF},
        ])

        expect(page.locator('#bulk-modal')).to_be_visible(timeout=3000)
        # 3 files, but the two Liebherr files group into one crane → 2 cranes.
        expect(page.locator('#bulk-summary')).to_contain_text('3 files')
        expect(page.locator('#bulk-summary')).to_contain_text('2 cranes')
        rows = page.locator('.bulk__row:not(.bulk__row--head)')
        expect(rows).to_have_count(2)

        # Make/Model came from the filenames.
        expect(page.locator('.bulk__input[aria-label="make"]').first).to_have_value('Liebherr')

        # Fill Type for all rows at once, Capacity per row.
        page.locator('#bulk-fill-type').fill('Mobile')
        page.locator('#bulk-fill-type-apply').click()
        for cap in page.locator('.bulk__row:not(.bulk__row--head) input[aria-label="capacity"]').all():
            cap.fill('100t')

        # On the Liebherr crane, choose the Outrigger file as the main one.
        liebherr = page.locator('.bulk__row').filter(has_text='Outrigger')
        liebherr.locator('.bulk__file').filter(has_text='Outrigger').locator('input[type=radio]').check()

        page.locator('#bulk-submit').click()
        expect(page.locator('#bulk-modal')).not_to_be_visible(timeout=10000)

        # Verify server-side: two cranes, Liebherr has 2 files with Outrigger primary.
        by_id = {c['id']: c for c in page.request.get(f'{live_server}/api/pdfs').json()['items']}
        assert 'liebherr_mobile_ltm1100_100t' in by_id
        assert 'tadano_mobile_ac100_100t' in by_id
        lieb = by_id['liebherr_mobile_ltm1100_100t']
        assert lieb['file_count'] == 2
        primary = next(f for f in lieb['files'] if f['is_primary'])
        assert primary['label'] == 'Outrigger'


class TestSidebarUX:
    def test_type_group_collapses(self, page: Page, live_server: str):
        """Clicking a type header folds that group's model rows away."""
        page.goto(live_server)
        _api_upload(page, live_server, make='Kato', model_type='Rough Terrain', model='KR1', capacity='25t')
        _api_upload(page, live_server, make='Kato', model_type='All Terrain', model='KA1', capacity='50t')
        page.reload()
        page.wait_for_load_state('networkidle')
        page.locator('.make-item').filter(has_text='Kato').click()

        group = page.locator('.type-group').filter(has_text='Rough Terrain')
        row = group.locator('.model-item')
        expect(row).to_be_visible(timeout=5000)
        group.locator('.type-header').click()
        expect(group).to_have_class(re.compile(r'\bis-collapsed\b'))
        expect(row).to_be_hidden()
        # Clicking again expands it.
        group.locator('.type-header').click()
        expect(row).to_be_visible()

    def test_search_keeps_makes_with_matching_models(self, page: Page, live_server: str):
        """Searching a capacity keeps makes whose models match, even though the make
        NAME doesn't contain the query."""
        page.goto(live_server)
        _api_upload(page, live_server, make='Alphacrane', model_type='Mobile', model='AX1', capacity='500t')
        _api_upload(page, live_server, make='Betacrane', model_type='All Terrain', model='BX1', capacity='500t')
        _api_upload(page, live_server, make='Gammacrane', model_type='Mobile', model='GX1', capacity='60t')
        page.reload()
        page.wait_for_load_state('networkidle')

        page.locator('#search-input').fill('500t')
        expect(page.locator('.make-item').filter(has_text='Alphacrane')).to_be_visible()
        expect(page.locator('.make-item').filter(has_text='Betacrane')).to_be_visible()
        expect(page.locator('.make-item').filter(has_text='Gammacrane')).to_be_hidden()


class TestSettingsPanel:
    def test_settings_backup_flow_and_info(self, page: Page, live_server: str):
        """The gear opens Settings; it shows instance info, backs up on demand, lists the
        backup, and downloads it; plus a fresh-backup download."""
        page.goto(live_server)
        _api_upload(page, live_server, make='Setco', model_type='Mobile', model='SC1', capacity='10t')
        page.reload()
        page.wait_for_load_state('networkidle')

        page.locator('#settings-btn').click()
        expect(page.locator('#settings-modal')).to_be_visible(timeout=3000)

        # Instance info renders (version + paths).
        expect(page.locator('#settings-info')).to_contain_text('Version')
        expect(page.locator('#settings-info')).to_contain_text('Database')

        # Back up now → the backup appears in the list.
        page.locator('#settings-backup-now').click()
        expect(page.locator('.settings__backup-name')).to_have_count(1, timeout=5000)

        # Download that specific backup.
        with page.expect_download() as dl:
            page.locator('.settings__backup-name').first.click()
        assert dl.value.suggested_filename.endswith('.zip')

        # And the "Download fresh" button streams one too.
        with page.expect_download() as dl2:
            page.locator('#settings-backup-download').click()
        assert dl2.value.suggested_filename.endswith('.zip')


class TestPaletteAndDeepLinks:
    def test_command_palette_jump_and_capacity(self, page: Page, live_server: str):
        """Ctrl+K opens the palette; text jumps to a crane, a ≥N query filters by capacity.
        Uses unique tokens so the cumulative E2E session DB doesn't skew the assertions."""
        page.goto(live_server)
        _api_upload(page, live_server, make='Zpalette', model_type='Mobile', model='ZZLOW22', capacity='22t')
        _api_upload(page, live_server, make='Zpalette', model_type='Mobile', model='ZZHIGH900', capacity='900t')
        page.reload()
        page.wait_for_load_state('networkidle')

        page.keyboard.press('Control+k')
        expect(page.locator('#palette-modal')).to_be_visible(timeout=3000)
        inp = page.locator('#palette-input')

        # A unique token narrows to exactly one crane.
        inp.fill('ZZHIGH900')
        expect(page.locator('.palette__result')).to_have_count(1)

        # Capacity range (same palette session): ≥800t includes 900t, excludes 22t.
        inp.fill('>=800')
        expect(page.locator('.palette__result').filter(has_text='ZZHIGH900')).to_have_count(1)
        expect(page.locator('.palette__result').filter(has_text='ZZLOW22')).to_have_count(0)

        # Enter on the unique token opens the crane and updates the URL.
        inp.fill('ZZHIGH900')
        inp.press('Enter')
        expect(page.locator('#palette-modal')).not_to_be_visible()
        expect(page).to_have_url(re.compile(r'#crane/zpalette_mobile_zzhigh900_900t'))

    def test_deep_link_opens_crane_on_load(self, page: Page, live_server: str):
        """Visiting /#crane/<id> opens that crane after the catalogue loads."""
        page.goto(live_server)
        result = _api_upload(page, live_server, make='Deepco', model_type='Mobile', model='DL1', capacity='75t')
        cid = result['id']
        # Force a full load with the hash present (goto to a same-doc hash won't reload).
        page.goto('about:blank')
        page.goto(f'{live_server}/#crane/{cid}')
        page.wait_for_load_state('networkidle')
        # The crane's model row is active and the info bar shows it.
        expect(page.locator(f'.model-item[data-filename="{cid}"]')).to_have_class(re.compile(r'is-active'), timeout=5000)
        expect(page.locator('#info-model')).to_have_text('DL1')

    def test_merge_manufacturers(self, page: Page, live_server: str):
        """The Settings merge tool moves a typo'd manufacturer onto the correct one."""
        page.goto(live_server)
        _api_upload(page, live_server, make='Mergecorrect', model_type='Mobile', model='MC1', capacity='40t')
        _api_upload(page, live_server, make='Mergetypo', model_type='Mobile', model='MT1', capacity='50t')
        page.reload()
        page.wait_for_load_state('networkidle')

        page.locator('#settings-btn').click()
        expect(page.locator('#settings-modal')).to_be_visible(timeout=3000)
        page.locator('#merge-from').select_option('Mergetypo')
        page.locator('#merge-into').select_option('Mergecorrect')
        page.locator('#merge-btn').click()
        # confirm dialog
        expect(page.locator('#confirm-modal')).to_be_visible(timeout=3000)
        page.locator('#confirm-ok').click()

        expect(page.locator('#merge-status')).to_contain_text('Merged', timeout=5000)
        makes = {m['make'] for m in page.request.get(f'{live_server}/api/pdfs').json()['items']}
        assert 'Mergetypo' not in makes and 'Mergecorrect' in makes
