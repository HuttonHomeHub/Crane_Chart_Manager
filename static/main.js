'use strict';

const PDFJS_BASE = '/static/vendor/pdf.js';

let pdfjsLib;
try {
    pdfjsLib = await import(`${PDFJS_BASE}/pdf.min.mjs`);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
    // B: PDF.js 4.x ships the worker as an ES module; without this it can silently
    // fall back to the "fake worker" (synchronous parsing on the main thread),
    // which lags badly on multi-MB PDFs.
    pdfjsLib.GlobalWorkerOptions.workerType = 'module';
} catch (err) {
    console.error('Failed to load PDF.js:', err);
    document.addEventListener('DOMContentLoaded', () => {
        const empty = document.getElementById('viewer-empty');
        if (empty) {
            empty.innerHTML = `
                <svg class="icon icon--xl icon--muted"><use href="#icon-alert-triangle"/></svg>
                <h2>PDF viewer failed to load</h2>
                <p>The PDF rendering library could not be loaded.
                   Check your connection or any content-blocking extensions and reload.</p>
            `;
        }
    });
    throw err;
}

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// J: read the CSRF token the server set as a cookie, echo it back in a header on mutating requests.
function csrfToken() {
    const match = document.cookie.match(/(?:^|; )crane_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

// Parse the house filename convention "Manufacturer Model (Label).pdf" into parts.
// The parenthetical (a file's label) is optional; make is the first word, model the
// rest of the base name. Used by the bulk importer and single-file prefill.
function parseFilename(name) {
    let base = String(name || '').replace(/\.pdf$/i, '').trim();
    let label = '';
    const m = base.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    if (m) { base = m[1].trim(); label = m[2].trim(); }
    const parts = base.split(/\s+/).filter(Boolean);
    const make = parts.shift() || '';
    const model = parts.join(' ');
    return { make, model, label };
}
const isMac = (() => {
    const uaData = navigator.userAgentData;
    if (uaData && typeof uaData.platform === 'string') {
        return /mac/i.test(uaData.platform);
    }
    return /Mac|iPhone|iPad/.test(navigator.platform || '');
})();

// R-016: breakpoint values read from CSS custom properties at start() time so
// there is a single source of truth (main.css). Fallbacks match the CSS values.
let BP_MOBILE = 640;
let BP_TABLET = 900;

// A + E: kbd hint chips render Ctrl on non-Mac, ⌘ on Mac. Server-side rendering
// gets it right on first paint via the is_mac context variable; this JS pass
// corrects in case the User-Agent string lied (spoofed UAs, atypical browsers).
function localizeKbds() {
    const mod = isMac ? '⌘' : 'Ctrl';
    $$('.kbd[data-mod-key]').forEach(el => {
        el.textContent = isMac ? (mod + el.dataset.modKey) : (mod + '+' + el.dataset.modKey);
    });
    $$('.kbd[data-mod]').forEach(el => {
        el.textContent = mod;
    });
}

/* =========================================================
   REGION: STATE
   ========================================================= */
const state = {
    pdfDoc: null,
    pageNum: 1,
    pageCount: 0,
    zoom: 1,                    // effective scale multiplier
    fitMode: 'page',            // 'page' | 'width' | 'custom'
    files: [],
    current: null,              // currently-open crane record
    currentFile: null,          // which file of the crane is displayed
    selectedMake: null,
    pendingFile: null,          // file pending in upload modal
    renderToken: 0,
    openToken: 0,               // monotonic — aborts stale openFile() calls
    findToken: 0,               // monotonic — aborts a stale in-PDF find scan
    submitToken: 0,             // monotonic — guards submit-button label restoration
    theme: 'dark',
};

function updateInfoBar(fields) {
    $('#info-make').textContent     = (fields && fields.make)     || '—';
    $('#info-type').textContent     = (fields && fields.type)     || '—';
    $('#info-model').textContent    = (fields && fields.model)    || '—';
    $('#info-capacity').textContent = (fields && fields.capacity) || '—';
}

// E (round 8): keep document.title in sync with the currently-open document so
// the browser tab / history entries / window switcher show meaningful labels.
const BASE_TITLE = 'Crane Charts';
function updateTitle(fields) {
    if (!fields) { document.title = BASE_TITLE; return; }
    const parts = [fields.make, fields.model].filter(Boolean).join(' ');
    document.title = parts ? `${parts} · ${BASE_TITLE}` : BASE_TITLE;
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/* =========================================================
   REGION: API
   ========================================================= */
const PDFS_PAGE_SIZE = 200;

const api = {
    // R-017: fetch bounded pages (rather than one unbounded request) and hand each
    // page to onPage as it arrives, so loadFileList() can paint makes/counts before
    // the whole catalogue has downloaded. Still resolves with the full concatenated
    // list for callers that just want everything.
    async listPdfs(onPage) {
        const all = [];
        let cursor = '';
        for (;;) {
            const params = new URLSearchParams({ limit: String(PDFS_PAGE_SIZE) });
            if (cursor) params.set('after', cursor);
            const r = await fetch(`/api/pdfs?${params}`);
            if (!r.ok) throw new Error((await safeErr(r)) || 'Failed to load documents');
            const data = await r.json();
            const items = data.items || [];
            all.push(...items);
            if (onPage) onPage(items, all.length, data.total);
            if (!data.next_cursor) break;
            cursor = data.next_cursor;
        }
        return all;
    },
    upload(file, fields, onProgress, label) {
        // XHR (not fetch) so we can show real upload progress.
        return new Promise((resolve, reject) => {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('make', fields.make);
            fd.append('type', fields.type);
            fd.append('model', fields.model);
            fd.append('capacity', fields.capacity);
            if (label) fd.append('label', label);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload');
            xhr.setRequestHeader('X-CSRF-Token', csrfToken());
            xhr.responseType = 'json';
            if (onProgress) {
                xhr.upload.addEventListener('progress', (ev) => {
                    if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
                });
            }
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response);
                } else {
                    const msg = xhr.response && xhr.response.error;
                    reject(new Error(msg || ('Upload failed (' + xhr.status + ')')));
                }
            };
            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.onabort = () => reject(new Error('Upload aborted'));
            xhr.send(fd);
        });
    },
    async updateMetadata(filename, fields) {
        const r = await fetch('/api/metadata/' + encodeURIComponent(filename), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify(fields),
        });
        if (!r.ok) throw new Error((await safeErr(r)) || 'Update failed');
        return r.json();
    },
    async remove(craneId) {
        // Deletes a whole crane (all its files).
        const r = await fetch('/api/delete/' + encodeURIComponent(craneId), {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrfToken() },
        });
        if (!r.ok) throw new Error((await safeErr(r)) || 'Delete failed');
        return r.json();
    },
    addFile(craneId, file, label, onProgress) {
        // XHR (not fetch) so the modal can show real upload progress.
        return new Promise((resolve, reject) => {
            const fd = new FormData();
            fd.append('file', file);
            if (label) fd.append('label', label);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/cranes/${encodeURIComponent(craneId)}/files`);
            xhr.setRequestHeader('X-CSRF-Token', csrfToken());
            xhr.responseType = 'json';
            if (onProgress) {
                xhr.upload.addEventListener('progress', (ev) => {
                    if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
                });
            }
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
                else reject(new Error((xhr.response && xhr.response.error) || ('Upload failed (' + xhr.status + ')')));
            };
            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.onabort = () => reject(new Error('Upload aborted'));
            xhr.send(fd);
        });
    },
    async setPrimary(craneId, fileId) {
        const r = await fetch(`/api/cranes/${encodeURIComponent(craneId)}/primary`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify({ file_id: fileId }),
        });
        if (!r.ok) throw new Error((await safeErr(r)) || 'Could not set main file');
        return r.json();
    },
    async updateFileLabel(craneId, fileId, label) {
        const r = await fetch(`/api/cranes/${encodeURIComponent(craneId)}/files/${fileId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify({ label }),
        });
        if (!r.ok) throw new Error((await safeErr(r)) || 'Could not rename file');
        return r.json();
    },
    async deleteFile(craneId, fileId) {
        const r = await fetch(`/api/cranes/${encodeURIComponent(craneId)}/files/${fileId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrfToken() },
        });
        if (!r.ok) throw new Error((await safeErr(r)) || 'Delete failed');
        return r.json();
    },
    async backupStatus() {
        const r = await fetch('/api/backup');
        if (!r.ok) throw new Error((await safeErr(r)) || 'Could not load backups');
        return r.json();
    },
    async instanceInfo() {
        const r = await fetch('/api/info');
        if (!r.ok) throw new Error((await safeErr(r)) || 'Could not load info');
        return r.json();
    },
    async backupNow() {
        const r = await fetch('/api/backup', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken() } });
        if (!r.ok) throw new Error((await safeErr(r)) || 'Backup failed');
        return r.json();
    },
    async facets() {
        const r = await fetch('/api/facets');
        if (!r.ok) throw new Error((await safeErr(r)) || 'Could not load facets');
        return r.json();
    },
    async mergeMake(from, into) {
        const r = await fetch('/api/merge-make', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify({ from, into }),
        });
        if (!r.ok) throw new Error((await safeErr(r)) || 'Merge failed');
        return r.json();
    },
};

// Pull the leading number out of a capacity string ("150t" → 150, "1 200 t" → 1200).
function parseCapacity(s) {
    const m = String(s || '').replace(/[,\s]/g, '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
}

async function safeErr(r) {
    try { return (await r.json()).error; } catch (_) { return null; }
}

/* =========================================================
   REGION: TOAST
   ========================================================= */
const toast = (() => {
    const stack = $('#toast-stack');
    const MAX = 4;
    const ICONS = {
        success: 'icon-check-circle-2',
        danger:  'icon-alert-circle',
        warning: 'icon-alert-triangle',
        info:    'icon-info',
    };
    const TITLES = {
        success: 'Success',
        danger:  'Error',
        warning: 'Heads up',
        info:    'Info',
    };

    function show({ variant = 'info', title, message, durationMs }) {
        while (stack.children.length >= MAX) stack.removeChild(stack.firstChild);
        const el = document.createElement('div');
        el.className = 'toast toast--' + variant;
        el.setAttribute('role', variant === 'danger' ? 'alert' : 'status');
        el.setAttribute('aria-live', variant === 'danger' ? 'assertive' : 'polite');
        el.innerHTML = `
            <svg class="icon"><use href="#${ICONS[variant]}"/></svg>
            <div class="toast__body">
                <div class="toast__title"></div>
                ${message ? '<div class="toast__message"></div>' : ''}
            </div>
            <button class="toast__close" aria-label="Dismiss">
                <svg class="icon"><use href="#icon-x"/></svg>
            </button>
        `;
        el.querySelector('.toast__title').textContent = title || TITLES[variant];
        if (message) el.querySelector('.toast__message').textContent = message;
        stack.appendChild(el);

        const dur = durationMs != null
            ? durationMs
            : (variant === 'danger' ? null : 4500);
        let timer = null;
        const dismiss = () => {
            if (el.classList.contains('is-leaving')) return;
            el.classList.add('is-leaving');
            el.addEventListener('animationend', () => el.remove(), { once: true });
        };
        const arm = () => { if (dur != null) timer = setTimeout(dismiss, dur); };
        arm();

        el.addEventListener('mouseenter', () => { if (timer) { clearTimeout(timer); timer = null; } });
        el.addEventListener('mouseleave', arm);
        el.addEventListener('click', dismiss);
        return el;
    }

    return {
        show,
        success: (title, message) => show({ variant: 'success', title, message }),
        danger:  (title, message) => show({ variant: 'danger', title, message }),
        warning: (title, message) => show({ variant: 'warning', title, message }),
        info:    (title, message) => show({ variant: 'info', title, message }),
    };
})();

/* =========================================================
   REGION: THEME
   ========================================================= */
const theme = {
    apply(name) {
        state.theme = name;
        document.documentElement.setAttribute('data-theme', name);
        try { localStorage.setItem('crane.theme', name); } catch (_) {}
        const icon = $('#theme-icon use');
        if (icon) icon.setAttribute('href', name === 'dark' ? '#icon-sun' : '#icon-moon');
    },
    init() {
        let saved = null;
        try { saved = localStorage.getItem('crane.theme'); } catch (_) {}
        this.apply(saved === 'light' ? 'light' : 'dark');
        $('#theme-toggle').addEventListener('click', () => {
            this.apply(state.theme === 'dark' ? 'light' : 'dark');
        });
    },
};

/* =========================================================
   REGION: MODAL
   ========================================================= */
/* H: native <dialog> — gives focus trap, Esc handling, top-layer rendering (above
   fullscreen elements), and ::backdrop styling for free. Manual stack/trap/backdrop
   code removed; we still bookkeep an `openSet` so isOpen()/closeTop() are O(1). */
const modal = (() => {
    const openSet = new Set();

    function focusable(root) {
        return $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', root)
            .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    }

    function open(id, options) {
        const el = document.getElementById(id);
        if (!el || el.open) return;
        // <dialog>.showModal traps focus, makes the rest of the page inert, and
        // pushes the dialog into the top layer. Pre-2022 browsers may throw — surface
        // that to the user so a silently-broken Upload button isn't mystifying.
        try {
            el.showModal();
        } catch (err) {
            console.error('Dialog open failed:', err);
            toast.danger('Could not open dialog', 'Your browser may be outdated — please update or try Chrome/Firefox/Safari.');
            return;
        }
        openSet.add(id);

        // Pick initial focus: explicit selector wins, otherwise the first non-close
        // focusable element (so the close X isn't the default focus).
        const f = focusable(el);
        let target = options && options.focus ? el.querySelector(options.focus) : null;
        if (!target) target = f.find(node => !node.classList.contains('modal__close')) || f[0];
        if (target) target.focus();

        // Native Esc fires a 'cancel' event; we want close-with-stack-tracking.
        el.addEventListener('cancel', onCancel);
        el.addEventListener('close', onClose);
        el.addEventListener('mousedown', onBackdropDown);
        el.addEventListener('mouseup', onBackdropUp);
    }

    function close(id) {
        const el = document.getElementById(id);
        if (!el || !el.open) return;
        el.close();  // fires the 'close' event → onClose detaches listeners
    }

    function closeTop() {
        // <dialog>.showModal stacks the top layer in the order they were opened.
        // We can close whichever is most recent by iterating openSet (insertion-ordered).
        const ids = Array.from(openSet);
        if (ids.length) close(ids[ids.length - 1]);
    }

    function onCancel(e) {
        // Allow Esc to close, but route through our close() for consistency.
        e.preventDefault();
        close(e.currentTarget.id);
    }

    function onClose(e) {
        const el = e.currentTarget;
        openSet.delete(el.id);
        el.removeEventListener('cancel', onCancel);
        el.removeEventListener('close', onClose);
        el.removeEventListener('mousedown', onBackdropDown);
        el.removeEventListener('mouseup', onBackdropUp);
    }

    // ξ: backdrop close still requires mousedown + mouseup both on the dialog
    // element itself (which is where the ::backdrop renders). Stops accidental
    // close when a drag starts inside the panel and ends on the backdrop.
    let backdropDownTarget = null;
    function onBackdropDown(e) {
        backdropDownTarget = e.target === e.currentTarget ? e.currentTarget : null;
    }
    function onBackdropUp(e) {
        if (backdropDownTarget && backdropDownTarget === e.currentTarget && e.target === e.currentTarget) {
            close(e.currentTarget.id);
        }
        backdropDownTarget = null;
    }

    return { open, close, closeTop, isOpen: () => openSet.size > 0 };
})();

/* =========================================================
   REGION: CONFIRM DIALOG (R-015)
   ========================================================= */
// Replaces window.confirm() — keyboard-accessible, themeable, works in
// fullscreen (top layer), never blocked by pop-up blockers.
function confirmDialog(message) {
    return new Promise((resolve) => {
        const dlg = document.getElementById('confirm-modal');
        document.getElementById('confirm-message').textContent = message;
        const okBtn     = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        function cleanup(result) {
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            dlg.removeEventListener('cancel', onNativeCancel);
            modal.close('confirm-modal');
            resolve(result);
        }
        function onOk()           { cleanup(true);  }
        function onCancel()       { cleanup(false); }
        function onNativeCancel(e) { e.preventDefault(); cleanup(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        dlg.addEventListener('cancel', onNativeCancel);
        // Default focus on Cancel so Enter doesn't immediately destroy data.
        modal.open('confirm-modal', { focus: '#confirm-cancel' });
    });
}

/* =========================================================
   REGION: METADATA MODAL (upload / edit dual-mode)
   ========================================================= */
const metadataModal = (() => {
    const elTitle     = $('#modal-title');
    const elMode      = $('#form-mode');
    const elOrigName  = $('#form-original-filename');
    const elCraneId   = $('#form-crane-id');
    const elFileField = $('#file-field');
    const elFileInput = $('#file-input');
    const elPickerTxt = $('#file-picker-text');
    const elSubmit    = $('#form-submit-btn');
    const elGrid      = $('#metadata-grid');
    const elLabelField= $('#label-field');
    const elLabel     = $('#label-input');
    const elNewCrane  = $('#addfile-newcrane');
    const elMake      = $('#make-input');
    const elType      = $('#type-input');
    const elModel     = $('#model-input');
    const elCapacity  = $('#capacity-input');

    // File currently being renamed (editlabel mode).
    let editFileId = null;

    function reset() {
        state.pendingFile = null;
        editFileId = null;
        elFileInput.value = '';
        elPickerTxt.textContent = 'Click to choose a PDF';
        elMake.value = elType.value = elModel.value = elCapacity.value = '';
        elLabel.value = '';
        elCraneId.value = '';
    }

    // Shared setup for every open-mode.
    const elError = $('#modal-error');
    function showError(msg) { elError.textContent = msg; elError.hidden = false; }
    function clearError() { elError.textContent = ''; elError.hidden = true; }

    function prep(mode) {
        reset();
        clearError();
        state.submitToken++;
        elSubmit.classList.remove('btn--loading');
        elSubmit.disabled = false;
        elMode.value = mode;
        elNewCrane.hidden = true;   // only shown in addfile mode
    }

    function openUpload(file) {
        prep('upload');
        elOrigName.value = '';
        elTitle.textContent = 'Upload crane specification';
        elSubmit.textContent = 'Upload';
        elFileField.hidden = false;
        elGrid.hidden = false;
        elLabelField.hidden = true;
        if (file) { setPendingFile(file); prefillFromName(file.name); }
        // If a file is already chosen (drag-drop path), start on Manufacturer;
        // otherwise start on the file picker so keyboard users land there first.
        modal.open('metadata-modal', { focus: file ? '#make-input' : '#file-picker' });
    }

    // Prefill Manufacturer/Model from the "Manufacturer Model (…).pdf" convention,
    // only in upload mode and only into empty fields (never clobber typed values).
    function prefillFromName(name) {
        if (elMode.value !== 'upload') return;
        const { make, model } = parseFilename(name);
        if (make && !elMake.value.trim()) elMake.value = make;
        if (model && !elModel.value.trim()) elModel.value = model;
    }

    function openEdit(record) {
        prep('edit');
        elOrigName.value = record.id || record.name;
        elTitle.textContent = 'Edit specification';
        elSubmit.textContent = 'Save changes';
        elFileField.hidden = true;
        elGrid.hidden = false;
        elLabelField.hidden = true;
        elMake.value     = record.make     || '';
        elType.value     = record.type     || '';
        elModel.value    = record.model    || '';
        elCapacity.value = record.capacity || '';
        modal.open('metadata-modal', { focus: '#make-input' });
    }

    function openAddFile(crane, file) {
        prep('addfile');
        elCraneId.value = crane.id;
        elTitle.textContent = `Add file to ${(crane.make || '')} ${(crane.model || '')}`.trim() || 'Add file';
        elSubmit.textContent = 'Add file';
        elFileField.hidden = false;
        elGrid.hidden = true;       // no make/type/model/capacity — inherited from the crane
        elLabelField.hidden = false;
        elNewCrane.hidden = false;  // escape hatch: this file is really a new crane
        if (file) setPendingFile(file);
        modal.open('metadata-modal', { focus: file ? '#label-input' : '#file-picker' });
    }

    function openEditLabel(crane, file) {
        prep('editlabel');
        elCraneId.value = crane.id;
        editFileId = file.id;
        elLabel.value = file.label || '';
        elTitle.textContent = 'Rename file';
        elSubmit.textContent = 'Save';
        elFileField.hidden = true;
        elGrid.hidden = true;
        elLabelField.hidden = false;
        modal.open('metadata-modal', { focus: '#label-input' });
    }

    function setPendingFile(file) {
        state.pendingFile = file;
        elPickerTxt.textContent = file.name;
    }

    elFileInput.addEventListener('change', (e) => {
        const fs = e.target.files;
        if (!fs || !fs.length) return;
        // Multi-select in upload mode → hand off to the bulk importer.
        if (fs.length > 1 && elMode.value === 'upload') {
            modal.close('metadata-modal');
            bulkImport.open(fs);
            return;
        }
        setPendingFile(fs[0]);
        prefillFromName(fs[0].name);
    });

    $('#file-picker').addEventListener('click', () => elFileInput.click());

    // Make the file-picker box a real drop target (it looks droppable). Stops the
    // event reaching the window-level dropzone, which refuses drops while a modal is open.
    elFileField.addEventListener('dragover', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        elFileField.classList.add('is-dragover');
    });
    elFileField.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        elFileField.classList.remove('is-dragover');
    });
    elFileField.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        elFileField.classList.remove('is-dragover');
        const files = Array.from(e.dataTransfer.files || [])
            .filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
        if (!files.length) { showError('Only PDF files can be uploaded.'); return; }
        clearError();
        if (files.length > 1 && elMode.value === 'upload') {
            modal.close('metadata-modal');
            bulkImport.open(files);
            return;
        }
        setPendingFile(files[0]);
        prefillFromName(files[0].name);
    });

    function progressLabel(loaded, total) {
        const pct = total ? Math.round((loaded / total) * 100) : 0;
        elSubmit.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Saving…';
    }

    async function submitUpload(fields) {
        elSubmit.classList.add('btn--loading');
        elSubmit.textContent = 'Uploading… 0%';
        await api.upload(state.pendingFile, fields, progressLabel);
        modal.close('metadata-modal');
        toast.success('Specification uploaded');
        await sidebar.loadFileList();
    }

    async function submitAddFile() {
        const craneId = elCraneId.value;
        elSubmit.classList.add('btn--loading');
        elSubmit.textContent = 'Uploading… 0%';
        const updated = await api.addFile(craneId, state.pendingFile, elLabel.value.trim(), progressLabel);
        modal.close('metadata-modal');
        toast.success('File added');
        if (state.current && state.current.id === craneId) viewer._applyCrane(updated);
        await sidebar.loadFileList();
    }

    async function submitEdit(fields) {
        const oldId = elOrigName.value;
        const result = await api.updateMetadata(oldId, fields);
        modal.close('metadata-modal');
        toast.success(result.renamed ? 'Saved & renamed' : 'Saved');
        const wasOpen = state.current && state.current.id === oldId;
        await sidebar.loadFileList();
        if (wasOpen && result.renamed) {
            // Directory + file URLs changed — reopen the crane fresh.
            const next = state.files.find(f => f.id === result.id);
            if (next) viewer.openFile(next);
        } else if (wasOpen) {
            state.current = result;
            updateInfoBar(result);
            updateTitle(result);
            viewer._renderStrip();
        }
    }

    async function submitEditLabel() {
        const craneId = elCraneId.value;
        const updated = await api.updateFileLabel(craneId, editFileId, elLabel.value.trim());
        modal.close('metadata-modal');
        toast.success('File renamed');
        if (state.current && state.current.id === craneId) viewer.applyLabelEdit(updated);
        else await sidebar.loadFileList();
    }

    // "Create a new crane instead" — switch an add-file flow into a fresh upload,
    // carrying whatever file was already chosen.
    elNewCrane.addEventListener('click', () => openUpload(state.pendingFile || undefined));

    $('#metadata-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const mode = elMode.value;

        // File-bearing modes need a pending file.
        if ((mode === 'upload' || mode === 'addfile') && !state.pendingFile) {
            toast.warning('No file selected', 'Choose a PDF first.');
            return;
        }
        // Metadata modes need all four fields.
        let fields = null;
        if (mode === 'upload' || mode === 'edit') {
            fields = {
                make: elMake.value.trim(),
                type: elType.value.trim(),
                model: elModel.value.trim(),
                capacity: elCapacity.value.trim(),
            };
            if (!fields.make || !fields.type || !fields.model || !fields.capacity) {
                toast.warning('Missing details', 'All four fields are required.');
                const first = [
                    [fields.make, elMake],
                    [fields.type, elType],
                    [fields.model, elModel],
                    [fields.capacity, elCapacity],
                ].find(([v]) => !v);
                if (first) first[1].focus();
                return;
            }
        }

        elSubmit.disabled = true;
        clearError();
        // Capture mode at submit time so the finally clause can't clobber a freshly
        // re-opened modal that may have switched into a different mode meanwhile.
        const submittedMode = mode;
        const submittedToken = ++state.submitToken;
        try {
            if (mode === 'upload')         await submitUpload(fields);
            else if (mode === 'addfile')   await submitAddFile();
            else if (mode === 'editlabel') await submitEditLabel();
            else                           await submitEdit(fields);
        } catch (err) {
            // Show the error INSIDE the dialog — a toast would render behind the
            // native <dialog>'s top-layer backdrop and be invisible.
            showError(err.message || String(err));
        } finally {
            elSubmit.disabled = false;
            // Only restore label/spinner if this submit run is still the latest one.
            if (submittedToken === state.submitToken) {
                elSubmit.classList.remove('btn--loading');
                elSubmit.textContent = submittedMode === 'upload' ? 'Upload'
                                     : submittedMode === 'addfile' ? 'Add file'
                                     : submittedMode === 'editlabel' ? 'Save'
                                     : 'Save changes';
            }
        }
    });

    return { openUpload, openEdit, openAddFile, openEditLabel, setPendingFile };
})();

/* =========================================================
   REGION: BULK IMPORT
   ========================================================= */
// Drop or select many PDFs → group them into cranes by the "Manufacturer Model
// (Label).pdf" convention, let the user fill Type + Capacity (and pick the main
// file where a crane has several), then upload each crane sequentially.
const bulkImport = (() => {
    const elGrid     = $('#bulk-grid');
    const elSummary  = $('#bulk-summary');
    const elProgress = $('#bulk-progress');
    const elSubmit   = $('#bulk-submit');
    const elFillType = $('#bulk-fill-type');

    let drafts = [];
    let running = false;

    function open(fileList) {
        const files = Array.from(fileList).filter(
            f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
        if (!files.length) { toast.warning('No PDFs', 'Only PDF files can be imported.'); return; }
        drafts = buildDrafts(files);
        render();
        elSubmit.disabled = false;
        elSubmit.textContent = 'Import';
        elProgress.textContent = '';
        elFillType.value = '';
        modal.open('bulk-modal', { focus: '#bulk-fill-type' });
    }

    // Group files by parsed (make, model) — a crane's several files share those.
    function buildDrafts(files) {
        const groups = new Map();
        for (const file of files) {
            const { make, model, label } = parseFilename(file.name);
            const key = (make + '|' + model).toLowerCase();
            if (!groups.has(key)) {
                groups.set(key, { make, model, type: '', capacity: '',
                                  files: [], primaryIdx: 0, status: 'pending', error: '' });
            }
            groups.get(key).files.push({ file, label, name: file.name });
        }
        return Array.from(groups.values());
    }

    function render() {
        elGrid.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'bulk__row bulk__row--head';
        for (const h of ['Manufacturer', 'Model', 'Type', 'Capacity', 'Files', '']) {
            const c = document.createElement('div');
            c.textContent = h;
            head.appendChild(c);
        }
        elGrid.appendChild(head);

        drafts.forEach((d, i) => {
            const row = document.createElement('div');
            row.className = 'bulk__row';
            d.el = row;
            d.inputs = {};
            ['make', 'model', 'type', 'capacity'].forEach((field) => {
                row.appendChild(cellInput(d, field));
            });
            row.appendChild(filesCell(d, i));
            const status = document.createElement('div');
            status.className = 'bulk__status';
            d.statusEl = status;
            row.appendChild(status);
            elGrid.appendChild(row);
        });
        updateSummary();
    }

    const PLACEHOLDER = { make: 'Liebherr', model: 'LTM1100', type: 'Mobile', capacity: '100t' };

    function cellInput(d, field) {
        const wrap = document.createElement('div');
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'bulk__input';
        inp.value = d[field] || '';
        inp.placeholder = PLACEHOLDER[field];
        inp.setAttribute('aria-label', field);
        // Autocomplete make/type from existing values (avoids "Liebherri"-style splits).
        if (field === 'make') inp.setAttribute('list', 'facet-makes');
        else if (field === 'type') inp.setAttribute('list', 'facet-types');
        inp.addEventListener('input', () => { d[field] = inp.value; clearRowError(d); });
        d.inputs[field] = inp;
        wrap.appendChild(inp);
        return wrap;
    }

    function filesCell(d, rowIdx) {
        const wrap = document.createElement('div');
        wrap.className = 'bulk__files';
        d.files.forEach((f, idx) => {
            const chip = document.createElement('label');
            chip.className = 'bulk__file';
            if (d.files.length > 1) {
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'bulk-primary-' + rowIdx;
                radio.checked = idx === d.primaryIdx;
                radio.title = 'Make this the main file';
                radio.addEventListener('change', () => { d.primaryIdx = idx; });
                chip.appendChild(radio);
            }
            const span = document.createElement('span');
            span.className = 'bulk__file-label';
            span.textContent = f.label || f.name;
            span.title = f.name;
            chip.appendChild(span);
            wrap.appendChild(chip);
        });
        return wrap;
    }

    function updateSummary() {
        const nf = drafts.reduce((s, d) => s + d.files.length, 0);
        elSummary.textContent =
            `${nf} file${nf !== 1 ? 's' : ''} → ${drafts.length} crane${drafts.length !== 1 ? 's' : ''}`;
    }

    function clearRowError(d) {
        if (d.status === 'error') { d.status = 'pending'; d.error = ''; paintStatus(d); }
        if (d.el) d.el.classList.remove('is-invalid');
    }

    function paintStatus(d) {
        const s = d.statusEl;
        if (!s) return;
        s.className = 'bulk__status bulk__status--' + d.status;
        s.title = d.error || '';
        if (d.status === 'done')          s.innerHTML = '<svg class="icon"><use href="#icon-check-circle-2"/></svg>';
        else if (d.status === 'error')    s.innerHTML = '<svg class="icon"><use href="#icon-alert-circle"/></svg>';
        else if (d.status === 'uploading') s.textContent = '…';
        else                              s.textContent = '';
    }

    function validate() {
        let ok = true;
        const seen = new Set();
        for (const d of drafts) {
            if (d.status === 'done') continue;
            d.el.classList.remove('is-invalid');
            const missing = !d.make.trim() || !d.model.trim() || !d.type.trim() || !d.capacity.trim();
            const slug = [d.make, d.type, d.model, d.capacity].join('|').trim().toLowerCase();
            const dup = !missing && seen.has(slug);
            if (!missing) seen.add(slug);
            if (missing || dup) {
                ok = false;
                d.el.classList.add('is-invalid');
                d.status = 'error';
                d.error = missing ? 'Fill in all four fields' : 'Duplicate of another row';
                paintStatus(d);
            }
        }
        return ok;
    }

    // The bulk loop can outrun the upload rate limit; retry a 429 with backoff.
    async function withRetry(fn) {
        for (let attempt = 0; ; attempt++) {
            try { return await fn(); }
            catch (err) {
                if (/\(429\)|too many/i.test(err.message || '') && attempt < 5) {
                    await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
                    continue;
                }
                throw err;
            }
        }
    }

    async function submit() {
        if (running) return;
        if (!validate()) { toast.warning('Some rows need attention', 'Fix the highlighted rows first.'); return; }
        running = true;
        elSubmit.disabled = true;

        const pending = drafts.filter(d => d.status !== 'done');
        let done = 0, failed = 0;
        for (const d of drafts) {
            if (d.status === 'done') continue;
            d.status = 'uploading'; paintStatus(d);
            elProgress.textContent = `Importing… ${done + failed}/${pending.length}`;
            try {
                const primary = d.files[d.primaryIdx];
                const rest = d.files.filter((_, i) => i !== d.primaryIdx);
                const crane = await withRetry(() => api.upload(
                    primary.file,
                    { make: d.make.trim(), type: d.type.trim(), model: d.model.trim(), capacity: d.capacity.trim() },
                    null, primary.label));
                for (const extra of rest) {
                    await withRetry(() => api.addFile(crane.id, extra.file, extra.label));
                }
                d.status = 'done'; paintStatus(d);
                Object.values(d.inputs).forEach(i => { i.disabled = true; });
                done++;
            } catch (err) {
                d.status = 'error';
                d.error = err.message || String(err);
                d.el.classList.add('is-invalid');
                paintStatus(d);
                failed++;
            }
            elProgress.textContent = `Importing… ${done + failed}/${pending.length}`;
        }

        running = false;
        elSubmit.disabled = false;
        await sidebar.loadFileList();

        if (failed === 0) {
            toast.success(`Imported ${done} crane${done !== 1 ? 's' : ''}`);
            modal.close('bulk-modal');
        } else {
            elSubmit.textContent = 'Retry failed';
            elProgress.textContent = `${done} imported · ${failed} failed — fix and retry`;
            toast.warning('Some imports failed', `${failed} row(s) need attention.`);
        }
    }

    $('#bulk-fill-type-apply').addEventListener('click', () => {
        const v = elFillType.value.trim();
        if (!v) return;
        drafts.forEach(d => {
            if (d.status === 'done') return;
            d.type = v;
            if (d.inputs && d.inputs.type) d.inputs.type.value = v;
            clearRowError(d);
        });
    });
    elFillType.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); $('#bulk-fill-type-apply').click(); }
    });
    elSubmit.addEventListener('click', () => submit());

    return { open };
})();

/* =========================================================
   REGION: SHORTCUTS
   ========================================================= */
const shortcuts = {
    init() {
        document.addEventListener('keydown', this.handle);
    },
    handle(e) {
        const tgt = e.target;
        const editable = tgt && (
            tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable
        );
        const mod = isMac ? e.metaKey : e.ctrlKey;

        // Cmd/Ctrl chords work even from inputs, except when a modal owns the focus.
        if (mod && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (modal.isOpen()) return;
            palette.open();   // Ctrl/Cmd+K → command palette (fuzzy-jump to a crane)
            return;
        }
        if (mod && e.key.toLowerCase() === 'u') {
            e.preventDefault();
            if (modal.isOpen()) return;
            metadataModal.openUpload();
            return;
        }

        if (e.key === 'Escape') {
            // Native <dialog> handles its own Esc via the 'cancel' event; this branch
            // is defensive in case our keydown fires first (browser order is unspecified).
            if (modal.isOpen()) { modal.closeTop(); return; }
            if (!$('#dropzone').hidden) { dropzone.hide(); return; }
            // Browsers also exit fullscreen on Esc natively; this line is a safety net.
            if (document.fullscreenElement) { document.exitFullscreen(); return; }
            return;
        }

        if (editable) return;

        // ? is allowed from inside a modal (so the help overlay is always reachable);
        // every other viewer-affecting shortcut is suppressed while a modal owns focus.
        if (e.key === '?') { e.preventDefault(); modal.open('shortcuts-modal'); return; }
        if (modal.isOpen()) return;
        // Single-key shortcuts must not fire on a modifier chord — otherwise Ctrl+F
        // (in-PDF find) would also toggle fullscreen via the 'f' case below.
        if (mod) return;

        switch (e.key) {
            case 'ArrowLeft':  if (state.pdfDoc) { e.preventDefault(); viewer.prev(); } break;
            case 'ArrowRight': if (state.pdfDoc) { e.preventDefault(); viewer.next(); } break;
            case '+':
            case '=':          if (state.pdfDoc) { e.preventDefault(); viewer.zoomStep(+1); } break;
            case '-':
            case '_':          if (state.pdfDoc) { e.preventDefault(); viewer.zoomStep(-1); } break;
            case 'f':
            case 'F':          if (state.pdfDoc) { e.preventDefault(); viewer.toggleFullscreen(); } break;
        }
    },
};

/* =========================================================
   REGION: DROPZONE
   ========================================================= */
const dropzone = (() => {
    const el = $('#dropzone');
    let counter = 0;
    let watchdog = null;

    function show() { el.hidden = false; el.setAttribute('aria-hidden', 'false'); armWatchdog(); }
    function hide() {
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
        counter = 0;
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    }

    // λ: if the browser ever swallows a leave/drop event (drag into a child iframe,
    // drop on a non-event-firing element), the counter would stick at > 0 and the
    // overlay would never hide. Re-armed on every dragover; if nothing fires for 700 ms
    // the overlay is force-hidden.
    function armWatchdog() {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(hide, 700);
    }

    function isFileDrag(e) {
        return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    }

    function init() {
        window.addEventListener('dragenter', (e) => {
            if (!isFileDrag(e)) return;
            // While a modal is open, its own file-picker handles drops — don't show
            // the full-window overlay on top of the dialog.
            if (modal.isOpen()) return;
            counter++;
            if (counter === 1) show();
            else armWatchdog();
        });
        window.addEventListener('dragover', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            armWatchdog();
        });
        window.addEventListener('dragleave', (e) => {
            if (!isFileDrag(e)) return;
            counter = Math.max(0, counter - 1);
            if (counter === 0) hide();
            else armWatchdog();
        });
        window.addEventListener('drop', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            hide();
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length === 0) return;
            // While a modal is open, the dialog's own picker handles drops onto it
            // (drops elsewhere are ignored — a toast here would sit behind the dialog).
            if (modal.isOpen()) return;
            // Two or more files → bulk importer (grouped into cranes by filename).
            if (files.length > 1) {
                bulkImport.open(files);
                return;
            }
            const file = files[0];
            if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
                toast.warning('PDF only', 'Only PDF files can be uploaded.');
                return;
            }
            // Single file: if a crane is open, offer it as a supplementary file for that
            // crane (the modal names it and offers "new crane instead"); otherwise a new crane.
            if (state.current) metadataModal.openAddFile(state.current, file);
            else metadataModal.openUpload(file);
        });
    }
    return { init, show, hide };
})();

/* =========================================================
   REGION: SIDEBAR
   ========================================================= */
// R-017: how many model-list rows (headers + items) to append per batch.
const MODEL_RENDER_BATCH_SIZE = 60;

const sidebar = {
    init() {
        const searchInput = $('#search-input');
        searchInput.addEventListener('input', (e) => this.filter(e.target.value.toLowerCase()));
        $('#sidebar-toggle').addEventListener('click', () => this.toggleDrawer());
        $('#sidebar-scrim').addEventListener('click', () => this.toggleDrawer(false));

        // Mobile: toggle search overlay
        const searchEl = $('.app-bar__search');
        $('#search-toggle').addEventListener('click', () => {
            const opened = searchEl.classList.toggle('is-active');
            if (opened) { searchInput.focus(); searchInput.select(); }
        });
        // R-016: use BP_MOBILE from CSS custom property
        const mobileMQ = window.matchMedia(`(max-width: ${BP_MOBILE}px)`);
        searchInput.addEventListener('blur', () => {
            if (mobileMQ.matches && !searchInput.value) {
                searchEl.classList.remove('is-active');
            }
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { searchEl.classList.remove('is-active'); searchInput.blur(); }
        });
        // ι: scrub the mobile-only .is-active class when the viewport leaves the mobile range.
        const onMobileChange = (mq) => {
            if (!mq.matches) searchEl.classList.remove('is-active');
        };
        // addEventListener('change', …) is the modern API; addListener is the legacy one.
        if (mobileMQ.addEventListener) mobileMQ.addEventListener('change', onMobileChange);
        else if (mobileMQ.addListener) mobileMQ.addListener(onMobileChange);
    },

    toggleDrawer(force) {
        const el = $('#sidebar');
        const scrim = $('#sidebar-scrim');
        const open = force == null ? !el.classList.contains('is-open') : !!force;
        el.classList.toggle('is-open', open);
        scrim.classList.toggle('is-visible', open);
        $('#sidebar-toggle').setAttribute('aria-expanded', String(open));
        // Mobile only: prevent tab focus from leaving the drawer into content beneath it.
        const main = $('main.viewer');
        // R-016: use BP_TABLET from CSS custom property
        const onMobile = window.matchMedia(`(max-width: ${BP_TABLET}px)`).matches;
        if (main) {
            if (open && onMobile) main.setAttribute('inert', '');
            else main.removeAttribute('inert');
        }
    },

    async loadFileList() {
        const makeList = $('#make-list');
        const modelList = $('#model-list');
        this.showSkeleton(makeList, 8);
        this.showSkeleton(modelList, 5);
        try {
            state.files = [];
            const files = await api.listPdfs((pageItems, loaded, total) => {
                // R-017: streamed page loading — repaint with what's arrived so far
                // whenever more is still on the way. For catalogues that fit in one
                // page (the common case) this never fires and there's a single render.
                state.files = state.files.concat(pageItems);
                if (loaded < total) this.renderMakes(state.files);
            });
            state.files = files;
            this.renderMakes(files);
            viewer.refreshEmptyCopy();
            refreshFacets();   // keep autocomplete + merge selects current
        } catch (err) {
            toast.danger('Could not load documents', err.message || String(err));
            makeList.innerHTML = '';
            modelList.innerHTML = '';
        }
    },

    showSkeleton(container, count) {
        container.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < count; i++) {
            const row = document.createElement('div');
            row.className = 'sidebar__skeleton-row';  // I (round 9): no inline cssText
            wrap.appendChild(row);
        }
        container.appendChild(wrap);
    },

    renderMakes(files) {
        const list = $('#make-list');
        const modelList = $('#model-list');
        // I: capture the focused element's key (make name / model filename) so we can
        // restore keyboard focus after the rebuild — otherwise an upload/edit/delete
        // bounces focus back to <body>.
        const active = document.activeElement;
        const focusedMake =
            active && active.classList && active.classList.contains('make-item') ? active.dataset.make : null;
        const focusedModelRow = active && active.closest ? active.closest('.model-item') : null;
        const focusedModelName = focusedModelRow ? focusedModelRow.dataset.filename : null;

        list.innerHTML = '';
        modelList.innerHTML = '';

        // Hand back focus after render. Stored on the sidebar for selectMake to pick up.
        this._restoreFocus = { make: focusedMake, filename: focusedModelName };

        if (!files.length) {
            list.innerHTML = `
                <div class="sidebar__empty">
                    <svg class="icon icon--lg"><use href="#icon-inbox"/></svg>
                    <div>No specifications yet.</div>
                </div>`;
            $('#makes-count').textContent = '0';
            $('#models-count').textContent = '0';
            return;
        }

        const grouped = {};
        for (const f of files) {
            const make = f.make || 'Unknown';
            (grouped[make] = grouped[make] || []).push(f);
        }
        const makes = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
        $('#makes-count').textContent = String(makes.length);

        // Per-make searchable text (all its cranes' fields + file labels) so a search
        // like "500t" keeps the make visible even though its name doesn't contain "500t".
        this._makeSearchText = {};
        for (const make of makes) {
            this._makeSearchText[make] = grouped[make].map(c =>
                `${c.make || ''} ${c.type || ''} ${c.model || ''} ${c.capacity || ''} ` +
                (c.files || []).map(f => f.label || '').join(' ')
            ).join(' ').toLowerCase();
        }

        for (const make of makes) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'make-item';
            // A (round 8): plain button with aria-current; no broken listbox role.
            btn.setAttribute('aria-current', 'false');
            btn.dataset.make = make;
            // D (round 9): tooltip on hover so truncated long names are still readable.
            btn.title = make;
            btn.innerHTML = `
                <span class="make-item__name"></span>
                <span class="make-item__count">${grouped[make].length}</span>
            `;
            btn.querySelector('.make-item__name').textContent = make;
            btn.addEventListener('click', () => this.selectMake(make, grouped[make], btn));
            list.appendChild(btn);
        }

        // Restore previous selection or pick first
        const preferred = makes.find(m => m === state.selectedMake) || makes[0];
        if (preferred) {
            const el = Array.from(list.querySelectorAll('.make-item'))
                .find(b => b.dataset.make === preferred);
            if (el) this.selectMake(preferred, grouped[preferred], el);
        }

        // Re-apply current filter
        const q = $('#search-input').value.toLowerCase();
        if (q) this.filter(q);

        // I: hand keyboard focus back to whatever the user had selected before this rebuild.
        const want = this._restoreFocus || {};
        this._restoreFocus = null;
        if (want.make) {
            const el = Array.from(list.querySelectorAll('.make-item'))
                .find(b => b.dataset.make === want.make);
            if (el) el.focus();
        } else if (want.filename) {
            const row = Array.from(modelList.querySelectorAll('.model-item'))
                .find(r => r.dataset.filename === want.filename);
            if (row) {
                const btn = row.querySelector('.model-item__body');
                if (btn) btn.focus();
            }
        }
    },

    selectMake(name, files, btn) {
        state.selectedMake = name;
        $$('.make-item').forEach(el => {
            const active = el === btn;
            el.classList.toggle('is-active', active);
            el.setAttribute('aria-current', active ? 'true' : 'false');
        });

        const list = $('#model-list');
        this._teardownModelSentinel();
        list.innerHTML = '';

        const grouped = {};
        for (const f of files) {
            const t = f.type || 'Other';
            (grouped[t] = grouped[t] || []).push(f);
        }
        const types = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
        $('#models-count').textContent = String(files.length);

        // R-017: flatten into a render queue (type headers + rows) instead of building
        // every row's DOM eagerly. Batches are appended as the user scrolls near the
        // bottom of #model-list (IntersectionObserver sentinel), so a make with
        // thousands of models doesn't block the main thread on first selection.
        const queue = [];
        for (const type of types) {
            queue.push({ kind: 'header', text: type, count: grouped[type].length });
            const models = grouped[type].slice().sort((a, b) =>
                (a.model || '').localeCompare(b.model || '')
            );
            for (const file of models) queue.push({ kind: 'row', file, typeKey: type });
        }
        this._modelQueue = queue;
        this._modelQueueIndex = 0;
        this._modelTypeGroupEls = {};
        this._renderModelBatch();

        const q = $('#search-input').value.toLowerCase();
        if (q) { this._flushModelQueue(); sidebar.filter(q); }
    },

    buildModelRow(file) {
        const row = document.createElement('div');
        row.className = 'model-item';
        row.dataset.filename = file.name;

        const body = document.createElement('button');
        body.type = 'button';
        body.className = 'model-item__body';
        body.setAttribute('aria-current', 'false');
        // Single line: model name, then its capacity right after it (muted).
        body.innerHTML = `<span class="model-item__name"></span>`;
        body.querySelector('.model-item__name').textContent = file.model || 'Unknown';
        // Badge cranes that hold more than one document (right after the name).
        const fileCount = file.file_count || 1;
        if (fileCount > 1) {
            const badge = document.createElement('span');
            badge.className = 'model-item__filecount';
            badge.textContent = String(fileCount);
            badge.title = `${fileCount} files`;
            badge.setAttribute('aria-label', `${fileCount} files`);
            body.appendChild(badge);
        }
        if (file.capacity) {
            const cap = document.createElement('span');
            cap.className = 'model-item__capacity';
            cap.textContent = file.capacity;
            body.appendChild(cap);
        }
        body.addEventListener('click', () => {
            // R-016: use BP_TABLET from CSS custom property
            if (window.matchMedia(`(max-width: ${BP_TABLET}px)`).matches) {
                sidebar.toggleDrawer(false);
            }
            viewer.openFile(file);
            $$('.model-item').forEach(el => {
                const active = el === row;
                el.classList.toggle('is-active', active);
                const btn = el.querySelector('.model-item__body');
                if (btn) btn.setAttribute('aria-current', active ? 'true' : 'false');
            });
        });

        const actions = document.createElement('div');
        actions.className = 'model-item__actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'model-item__action model-item__action--edit';
        editBtn.setAttribute('aria-label', 'Edit metadata');
        editBtn.title = 'Edit metadata';
        editBtn.innerHTML = '<svg class="icon"><use href="#icon-edit-3"/></svg>';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            metadataModal.openEdit(file);
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'model-item__action model-item__action--delete';
        delBtn.setAttribute('aria-label', 'Delete specification');
        delBtn.title = 'Delete';
        delBtn.innerHTML = '<svg class="icon"><use href="#icon-trash-2"/></svg>';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.deleteFile(file);
        });

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        row.appendChild(body);
        row.appendChild(actions);

        if (state.current && state.current.name === file.name) {
            row.classList.add('is-active');
            body.setAttribute('aria-current', 'true');
        }

        return row;
    },

    // R-017: append the next batch of queued rows (headers create their type-group
    // container; rows are appended into whichever group their type belongs to).
    _appendModelBatch() {
        const list = $('#model-list');
        const queue = this._modelQueue || [];
        const end = Math.min(this._modelQueueIndex + MODEL_RENDER_BATCH_SIZE, queue.length);
        for (let i = this._modelQueueIndex; i < end; i++) {
            const item = queue[i];
            if (item.kind === 'header') {
                const group = document.createElement('div');
                group.className = 'type-group';
                // Collapsible header: click to fold this type away (helps a long list).
                const head = document.createElement('button');
                head.type = 'button';
                head.className = 'type-header';
                head.setAttribute('aria-expanded', 'true');
                head.innerHTML = `
                    <svg class="icon type-header__chevron"><use href="#icon-chevron-right"/></svg>
                    <span class="type-header__label"></span>
                    <span class="type-header__count"></span>`;
                head.querySelector('.type-header__label').textContent = item.text;
                head.querySelector('.type-header__count').textContent = String(item.count || '');
                head.addEventListener('click', () => {
                    const collapsed = group.classList.toggle('is-collapsed');
                    head.setAttribute('aria-expanded', String(!collapsed));
                });
                group.appendChild(head);
                list.appendChild(group);
                this._modelTypeGroupEls[item.text] = group;
            } else {
                this._modelTypeGroupEls[item.typeKey].appendChild(this.buildModelRow(item.file));
            }
        }
        this._modelQueueIndex = end;
    },

    _renderModelBatch() {
        this._teardownModelSentinel();
        this._appendModelBatch();
        if (this._modelQueueIndex < (this._modelQueue || []).length) {
            this._setupModelSentinel();
        }
    },

    _setupModelSentinel() {
        const list = $('#model-list');
        const sentinel = document.createElement('div');
        sentinel.className = 'sidebar__sentinel';
        sentinel.setAttribute('aria-hidden', 'true');
        list.appendChild(sentinel);
        this._modelSentinelEl = sentinel;
        this._modelObserver = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) this._renderModelBatch();
        }, { root: list, rootMargin: '200px' });
        this._modelObserver.observe(sentinel);
    },

    _teardownModelSentinel() {
        if (this._modelObserver) { this._modelObserver.disconnect(); this._modelObserver = null; }
        if (this._modelSentinelEl) { this._modelSentinelEl.remove(); this._modelSentinelEl = null; }
    },

    // Search must be able to match rows the scroll-triggered batching hasn't
    // rendered yet, so force the rest of the queue into the DOM before filtering.
    _flushModelQueue() {
        this._teardownModelSentinel();
        while (this._modelQueueIndex < (this._modelQueue || []).length) {
            this._appendModelBatch();
        }
    },

    async deleteFile(file) {
        const label = (file.model || file.name) + (file.capacity ? ' (' + file.capacity + ')' : '');
        // R-015: native <dialog> confirm instead of window.confirm()
        const confirmed = await confirmDialog(`Delete "${label}"? This cannot be undone.`);
        if (!confirmed) return;

        // F + C: figure out the next sensible focus target BEFORE the rebuild — the
        // next sibling row in the same type group, falling back to the previous one.
        // If this was the only row in its group, look at adjacent type groups so focus
        // doesn't drop to <body>.
        let nextFocusFilename = null;
        const allRows = Array.from(document.querySelectorAll('.model-item'));
        const idx = allRows.findIndex(r => r.dataset.filename === file.name);
        if (idx >= 0) {
            const currentRow = allRows[idx];
            const sameGroupRows = Array.from(
                currentRow.parentElement.querySelectorAll('.model-item')
            );
            const pos = sameGroupRows.indexOf(currentRow);
            if (sameGroupRows[pos + 1]) {
                nextFocusFilename = sameGroupRows[pos + 1].dataset.filename;
            } else if (sameGroupRows[pos - 1]) {
                nextFocusFilename = sameGroupRows[pos - 1].dataset.filename;
            } else if (allRows[idx + 1]) {
                nextFocusFilename = allRows[idx + 1].dataset.filename;
            } else if (allRows[idx - 1]) {
                nextFocusFilename = allRows[idx - 1].dataset.filename;
            }
        }

        try {
            await api.remove(file.name);
            toast.success('Specification deleted');
            if (state.current && state.current.name === file.name) {
                viewer.openEmpty();
            }
            await this.loadFileList();
            if (nextFocusFilename) {
                const row = Array.from(document.querySelectorAll('.model-item'))
                    .find(r => r.dataset.filename === nextFocusFilename);
                if (row) {
                    const btn = row.querySelector('.model-item__body');
                    if (btn) btn.focus();
                }
            }
        } catch (err) {
            toast.danger('Delete failed', err.message || String(err));
        }
    },

    filter(query) {
        const q = (query || '').trim().toLowerCase();
        if (q) this._flushModelQueue();
        const makeList = $('#make-list');
        const modelList = $('#model-list');

        // A search must not hide matches inside a collapsed group — expand them.
        if (q) {
            $$('.type-group', modelList).forEach(g => {
                g.classList.remove('is-collapsed');
                const h = g.querySelector('.type-header');
                if (h) h.setAttribute('aria-expanded', 'true');
            });
        }

        // F (round 7) + I (round 9): use a class instead of inline style so a stricter
        // CSP can drop 'unsafe-inline' from style-src-attr in the future.
        // A make stays visible if the query matches its name OR any of its cranes
        // (model/capacity/type/label), so searching "500t" keeps the makes that have one.
        const searchText = this._makeSearchText || {};
        let visibleMakes = 0;
        $$('.make-item', makeList).forEach(el => {
            const hay = searchText[el.dataset.make] || el.textContent.toLowerCase();
            const match = !q || hay.includes(q);
            el.classList.toggle('is-hidden', !match);
            if (match) visibleMakes++;
        });
        let visibleModels = 0;
        $$('.type-group', modelList).forEach(group => {
            let anyVisible = false;
            $$('.model-item', group).forEach(item => {
                const match = !q || item.textContent.toLowerCase().includes(q);
                item.classList.toggle('is-hidden', !match);
                if (match) { anyVisible = true; visibleModels++; }
            });
            group.classList.toggle('is-hidden', !(anyVisible || !q));
        });

        this._showNoMatches(makeList, q && visibleMakes === 0, q);
        this._showNoMatches(modelList, q && visibleModels === 0, q);
    },

    _showNoMatches(container, show, query) {
        let banner = container.querySelector(':scope > .sidebar__no-matches');
        // C (round 8): suppress the banner during the skeleton phase — the rows aren't
        // rendered yet and the empty count is meaningless. We detect this by looking
        // for actual rendered items (.make-item or .model-item) in the container.
        const hasRendered = !!container.querySelector('.make-item, .model-item');
        if (!show || !hasRendered) { if (banner) banner.remove(); return; }
        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'sidebar__no-matches';
            banner.setAttribute('role', 'status');
            container.appendChild(banner);
        }
        banner.textContent = `No matches for "${query}"`;
    },
};

/* =========================================================
   REGION: VIEWER
   ========================================================= */
const viewer = {
    init() {
        $('#prev-page').addEventListener('click', () => this.prev());
        $('#next-page').addEventListener('click', () => this.next());
        $('#zoom-in').addEventListener('click', () => this.zoomStep(+1));
        $('#zoom-out').addEventListener('click', () => this.zoomStep(-1));
        $('#zoom-level').addEventListener('click', () => this.cycleFit());
        $('#fit-width').addEventListener('click', () => this.setFit('width'));
        $('#fit-page').addEventListener('click', () => this.setFit('page'));
        $('#fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());
        $('#download-btn').addEventListener('click', () => this.download());
        $('#empty-upload-btn').addEventListener('click', () => metadataModal.openUpload());
        $('#upload-trigger').addEventListener('click', () => metadataModal.openUpload());
        $('#file-strip-add').addEventListener('click', () => {
            if (state.current) metadataModal.openAddFile(state.current);
        });

        $('#page-input').addEventListener('change', (e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n)) this.goto(n);
        });
        $('#page-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        });

        document.addEventListener('fullscreenchange', () => {
            const use = $('#fullscreen-icon use');
            if (use) use.setAttribute('href', document.fullscreenElement ? '#icon-minimize' : '#icon-maximize');
            if (state.pdfDoc) this.renderPage(state.pageNum);
        });

        let resizeT;
        window.addEventListener('resize', () => {
            clearTimeout(resizeT);
            resizeT = setTimeout(() => {
                if (state.pdfDoc && state.fitMode !== 'custom') this.renderPage(state.pageNum);
            }, 120);
        });

        this.initFind();
        this.openEmpty();
    },

    openEmpty() {
        if (state.pdfDoc && typeof state.pdfDoc.destroy === 'function') {
            try { state.pdfDoc.destroy(); } catch (_) {}
        }
        state.pdfDoc = null;
        state.current = null;
        state.currentFile = null;
        state.pageNum = 1;
        state.pageCount = 0;
        $('#viewer-empty').hidden = false;
        $('#info-bar').hidden = true;
        $('#file-strip').hidden = true;
        $('#pdf-viewer').hidden = true;
        $('#toolbar').hidden = true;
        $$('.model-item.is-active').forEach(el => el.classList.remove('is-active'));
        this.closeFind();
        this._resetFind();
        this.refreshEmptyCopy();
        updateTitle(null);
    },

    refreshEmptyCopy() {
        const hasFiles = state.files && state.files.length > 0;
        const title = $('#viewer-empty-title');
        const body  = $('#viewer-empty-body');
        const cta   = $('#empty-upload-label');
        if (hasFiles) {
            title.textContent = 'No document selected';
            body.textContent  = 'Choose a manufacturer and model from the sidebar, or drag a PDF onto the window to upload another.';
            cta.textContent   = 'Upload another specification';
        } else {
            title.textContent = 'No specifications uploaded yet';
            body.textContent  = 'Drag a PDF anywhere on this window, or click upload to add your first spec.';
            cta.textContent   = 'Upload your first spec';
        }
    },

    // Entry point from the sidebar: open a CRANE. Shows its file strip and loads
    // the crane's primary file into the PDF viewer.
    async openFile(crane) {
        state.current = crane;
        $('#viewer-empty').hidden = true;
        $('#info-bar').hidden = false;
        updateInfoBar(crane);
        updateTitle(crane);
        this._renderStrip();
        deepLink.set(crane.id);   // reflect the open crane in the URL (/#crane/<id>)
        const primary = this._primaryOf(crane);
        if (primary) await this._loadPdf(primary);
    },

    _primaryOf(crane) {
        const files = (crane && crane.files) || [];
        return files.find(f => f.is_primary) || files[0] || null;
    },

    // Load a single file (of the current crane) into the viewer. Does not change
    // which crane is selected — only which of its documents is displayed.
    async _loadPdf(file) {
        const token = ++state.openToken;
        state.currentFile = file;
        state.fitMode = 'page';
        state.pageNum = 1;
        $('#pdf-viewer').hidden = false;
        $('#toolbar').hidden = false;
        $('#viewer-skeleton').hidden = false;
        this._markActiveChip(file.id);
        this._resetFind();   // per-page text cache belongs to the old document

        // Free the previous document before loading the next one.
        if (state.pdfDoc && typeof state.pdfDoc.destroy === 'function') {
            try { state.pdfDoc.destroy(); } catch (_) {}
        }
        state.pdfDoc = null;
        state.pageCount = 0;

        try {
            const doc = await pdfjsLib.getDocument(file.url).promise;
            if (token !== state.openToken) {
                // A newer _loadPdf() superseded us; throw away this doc.
                try { doc.destroy(); } catch (_) {}
                return;
            }
            state.pdfDoc = doc;
            state.pageCount = doc.numPages;
            $('#page-input').max = doc.numPages;
            $('#page-input').value = 1;
            $('#page-total').textContent = doc.numPages;
            await this.renderPage(1);
            // If find is open, re-run the query against the newly-loaded document.
            if (this._find.active && this._find.query) this._runFind(this._find.query);
        } catch (err) {
            if (token !== state.openToken) return;
            $('#viewer-skeleton').hidden = true;
            toast.danger('Could not open PDF', err.message || String(err));
        }
    },

    // Switch the displayed document within the current crane (from a strip chip).
    showFile(fileId) {
        if (!state.current) return;
        const file = (state.current.files || []).find(f => f.id === fileId);
        if (file) this._loadPdf(file);
    },

    _fileLabel(file) {
        return file.label || file.original_filename || file.stored_name || 'Document';
    },

    _renderStrip() {
        const strip = $('#file-strip');
        const chips = $('#file-strip-chips');
        const crane = state.current;
        if (!crane) { strip.hidden = true; return; }
        strip.hidden = false;
        chips.innerHTML = '';
        for (const file of crane.files || []) {
            const chip = document.createElement('div');
            chip.className = 'file-chip' + (file.is_primary ? ' is-primary' : '');
            chip.dataset.fileId = String(file.id);

            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'file-chip__open';
            open.title = 'View ' + this._fileLabel(file);
            open.innerHTML = `
                <svg class="icon file-chip__star"><use href="#icon-check-circle-2"/></svg>
                <span class="file-chip__label"></span>
            `;
            open.querySelector('.file-chip__label').textContent = this._fileLabel(file);
            open.addEventListener('click', () => this.showFile(file.id));

            const star = document.createElement('button');
            star.type = 'button';
            star.className = 'file-chip__action file-chip__action--primary';
            star.title = file.is_primary ? 'This is the main file' : 'Set as main file';
            star.setAttribute('aria-label', star.title);
            star.disabled = !!file.is_primary;
            star.innerHTML = '<svg class="icon"><use href="#icon-check-circle-2"/></svg>';
            star.addEventListener('click', (e) => { e.stopPropagation(); this._setPrimary(file); });

            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'file-chip__action file-chip__action--edit';
            edit.title = 'Rename this file';
            edit.setAttribute('aria-label', 'Rename ' + this._fileLabel(file));
            edit.innerHTML = '<svg class="icon"><use href="#icon-edit-3"/></svg>';
            edit.addEventListener('click', (e) => { e.stopPropagation(); this._editLabel(file); });

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'file-chip__action file-chip__action--delete';
            del.title = 'Delete this file';
            del.setAttribute('aria-label', 'Delete ' + this._fileLabel(file));
            del.innerHTML = '<svg class="icon"><use href="#icon-trash-2"/></svg>';
            del.addEventListener('click', (e) => { e.stopPropagation(); this._deleteFile(file); });

            chip.appendChild(open);
            chip.appendChild(star);
            chip.appendChild(edit);
            chip.appendChild(del);
            chips.appendChild(chip);
        }
        this._markActiveChip(state.currentFile && state.currentFile.id);
    },

    _markActiveChip(fileId) {
        $$('#file-strip-chips .file-chip').forEach(el => {
            el.classList.toggle('is-active', el.dataset.fileId === String(fileId));
        });
    },

    // Replace state.current with a fresh crane record (from an add/set-primary/delete
    // API response) and re-render the strip. Keeps the currently-displayed file if it
    // still exists; otherwise falls back to the primary.
    _applyCrane(crane) {
        state.current = crane;
        // Keep the sidebar's state.files entry in sync so the badge/counts are current.
        const idx = state.files.findIndex(f => f.id === crane.id);
        if (idx >= 0) state.files[idx] = crane;
        this._renderStrip();
        const shownId = state.currentFile && state.currentFile.id;
        const stillThere = (crane.files || []).some(f => f.id === shownId);
        if (!stillThere) {
            const primary = this._primaryOf(crane);
            if (primary) this._loadPdf(primary);
        } else {
            // Refresh the reference (is_primary may have flipped).
            state.currentFile = crane.files.find(f => f.id === shownId);
            this._markActiveChip(shownId);
        }
    },

    async _setPrimary(file) {
        if (!state.current) return;
        try {
            const updated = await api.setPrimary(state.current.id, file.id);
            this._applyCrane(updated);
            sidebar.loadFileList();
            toast.success('Main file updated');
        } catch (err) {
            toast.danger('Could not set main file', err.message || String(err));
        }
    },

    async _deleteFile(file) {
        if (!state.current) return;
        const crane = state.current;
        const isLast = (crane.files || []).length <= 1;
        const label = this._fileLabel(file);
        const msg = isLast
            ? `"${label}" is the only file. Deleting it removes the whole crane. Continue?`
            : `Delete "${label}" from this crane? This cannot be undone.`;
        const confirmed = await confirmDialog(msg);
        if (!confirmed) return;
        try {
            const res = await api.deleteFile(crane.id, file.id);
            toast.success('File deleted');
            if (res.crane_deleted) {
                viewer.openEmpty();
                await sidebar.loadFileList();
            } else {
                this._applyCrane(res);
                sidebar.loadFileList();
            }
        } catch (err) {
            toast.danger('Delete failed', err.message || String(err));
        }
    },

    _editLabel(file) {
        if (!state.current) return;
        metadataModal.openEditLabel(state.current, file);
    },

    // Called by the label-edit modal on success.
    applyLabelEdit(updatedCrane) {
        this._applyCrane(updatedCrane);
        sidebar.loadFileList();
    },

    async renderPage(num) {
        if (!state.pdfDoc) return;
        num = Math.max(1, Math.min(num, state.pageCount));
        state.pageNum = num;
        $('#page-input').value = num;

        const token = ++state.renderToken;
        try {
            const page = await state.pdfDoc.getPage(num);
            if (token !== state.renderToken) return;

            const well = $('#pdf-viewer');
            const styles = window.getComputedStyle(well);
            const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
            const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
            const availW = well.clientWidth - padX;
            const availH = well.clientHeight - padY;
            const base = page.getViewport({ scale: 1 });

            let scale;
            if (state.fitMode === 'width') {
                scale = availW / base.width;
            } else if (state.fitMode === 'page') {
                scale = Math.min(availW / base.width, availH / base.height);
            } else {
                scale = state.zoom;
            }
            if (state.fitMode !== 'custom') state.zoom = scale;

            const dpr = Math.min(window.devicePixelRatio || 1, 3);
            const viewport = page.getViewport({ scale });
            const canvas = $('#pdf-canvas');
            const ctx = canvas.getContext('2d');

            canvas.width  = Math.floor(viewport.width  * dpr);
            canvas.height = Math.floor(viewport.height * dpr);
            canvas.style.width  = Math.floor(viewport.width)  + 'px';
            canvas.style.height = Math.floor(viewport.height) + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            await page.render({ canvasContext: ctx, viewport }).promise;
            if (token !== state.renderToken) return;

            $('#viewer-skeleton').hidden = true;
            $('#zoom-level').textContent = Math.round(scale * 100) + '%';
            $('#prev-page').disabled = num <= 1;
            $('#next-page').disabled = num >= state.pageCount;

            // Feature 2: keep the find overlay aligned to whatever just rendered.
            this._renderViewport = viewport;
            this._renderPageNum = num;
            if (this._find.active && this._find.query) this._drawHighlights();
            else this._clearHighlights();
        } catch (err) {
            if (token === state.renderToken) {
                $('#viewer-skeleton').hidden = true;
                console.error('PDF render error:', err);
            }
        }
    },

    prev() { if (state.pageNum > 1) this.renderPage(state.pageNum - 1); },
    next() { if (state.pageNum < state.pageCount) this.renderPage(state.pageNum + 1); },
    goto(n) { this.renderPage(n); },

    zoomStep(direction) {
        // Snap current zoom to closest step then move
        let idx = 0, best = Infinity;
        ZOOM_STEPS.forEach((z, i) => {
            const d = Math.abs(z - state.zoom);
            if (d < best) { best = d; idx = i; }
        });
        idx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + direction));
        state.fitMode = 'custom';
        state.zoom = ZOOM_STEPS[idx];
        this.renderPage(state.pageNum);
    },

    setFit(mode) {
        state.fitMode = mode;
        this.renderPage(state.pageNum);
    },

    cycleFit() {
        const next = state.fitMode === 'page' ? 'width'
                  : state.fitMode === 'width' ? 'custom'
                  : 'page';
        if (next === 'custom') {
            state.fitMode = 'custom';
            state.zoom = 1;
        } else {
            state.fitMode = next;
        }
        this.renderPage(state.pageNum);
    },

    toggleFullscreen() {
        // Fullscreen <html> so the app bar, toasts, modals, and dropzone stay visible
        // — only descendants of the fullscreened element render while in fullscreen.
        const el = document.documentElement;
        if (document.fullscreenElement) {
            document.exitFullscreen();
            return;
        }
        if (!el.requestFullscreen) {
            toast.warning('Fullscreen unavailable', 'Your browser does not support fullscreen for this view.');
            return;
        }
        el.requestFullscreen().catch(err => {
            toast.warning('Could not enter fullscreen', err && err.message);
        });
    },

    download() {
        // Download whichever file is currently displayed (falls back to the crane primary).
        const file = state.currentFile || (state.current && this._primaryOf(state.current));
        if (!file) return;
        const a = document.createElement('a');
        a.href = file.url;
        a.download = file.original_filename || file.stored_name || 'document.pdf';
        document.body.appendChild(a);
        a.click();
        // R-018: defer removal so browsers have time to initiate the download
        // before the anchor is detached from the DOM.
        setTimeout(() => a.remove(), 150);
    },

    /* ---- Feature 2: in-document find --------------------------------------- */
    _find: { active: false, query: '', matches: [], current: -1, pageText: {} },

    initFind() {
        const input = $('#find-input');
        $('#find-btn').addEventListener('click', () => this.openFind());
        $('#find-close').addEventListener('click', () => this.closeFind());
        $('#find-next').addEventListener('click', () => this._gotoMatch(+1));
        $('#find-prev').addEventListener('click', () => this._gotoMatch(-1));

        let t;
        input.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => this._runFind(input.value), 180);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._gotoMatch(e.shiftKey ? -1 : +1); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeFind(); }
        });

        // Ctrl/Cmd+F opens find when a document is open (overrides browser find);
        // "/" opens it too when the user isn't typing in a field.
        window.addEventListener('keydown', (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && (e.key === 'f' || e.key === 'F') && state.pdfDoc) {
                e.preventDefault();
                this.openFind();
            } else if (e.key === '/' && state.pdfDoc && !this._find.active
                       && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) {
                e.preventDefault();
                this.openFind();
            }
        });
    },

    openFind() {
        // Opens even while the document is still loading; _loadPdf re-runs the query
        // once the doc is ready, and _runFind is a no-op without state.pdfDoc.
        this._find.active = true;
        $('#find-bar').hidden = false;
        const input = $('#find-input');
        input.focus();
        input.select();
        if (input.value.trim() && state.pdfDoc) this._runFind(input.value);
    },

    closeFind() {
        this._find.active = false;
        $('#find-bar').hidden = true;
        this._clearHighlights();
    },

    _resetFind() {
        // New document loaded — drop the per-page text cache and matches.
        this._find.matches = [];
        this._find.current = -1;
        this._find.pageText = {};
        this._clearHighlights();
        $('#find-count').textContent = '';
        $('#find-prev').disabled = true;
        $('#find-next').disabled = true;
    },

    _clearHighlights() {
        const box = $('#pdf-highlights');
        if (box) box.innerHTML = '';
    },

    async _pageItems(pageNum) {
        if (!this._find.pageText[pageNum]) {
            const page = await state.pdfDoc.getPage(pageNum);
            const tc = await page.getTextContent();
            this._find.pageText[pageNum] = (tc.items || []).filter(i => typeof i.str === 'string' && i.str);
        }
        return this._find.pageText[pageNum];
    },

    async _runFind(raw) {
        const q = (raw || '').trim().toLowerCase();
        this._find.query = q;
        if (!state.pdfDoc || !q) {
            this._find.matches = [];
            this._find.current = -1;
            this._clearHighlights();
            $('#find-count').textContent = q ? '' : '';
            $('#find-prev').disabled = true;
            $('#find-next').disabled = true;
            return;
        }
        const token = ++state.findToken;
        const matches = [];
        for (let p = 1; p <= state.pageCount; p++) {
            const items = await this._pageItems(p);
            if (token !== state.findToken) return;   // superseded by a newer query/scan
            items.forEach((it, idx) => {
                if (it.str.toLowerCase().includes(q)) matches.push({ page: p, itemIndex: idx });
            });
        }
        this._find.matches = matches;
        const has = matches.length > 0;
        $('#find-prev').disabled = !has;
        $('#find-next').disabled = !has;
        if (!has) {
            this._find.current = -1;
            $('#find-count').textContent = '0/0';
            this._clearHighlights();
            return;
        }
        // Jump to the first match at or after the current page for a natural feel.
        let start = matches.findIndex(m => m.page >= state.pageNum);
        if (start < 0) start = 0;
        this._find.current = start;
        this._goToCurrent();
    },

    _gotoMatch(delta) {
        const n = this._find.matches.length;
        if (!n) return;
        this._find.current = (this._find.current + delta + n) % n;
        this._goToCurrent();
    },

    _goToCurrent() {
        const m = this._find.matches[this._find.current];
        if (!m) return;
        $('#find-count').textContent = `${this._find.current + 1}/${this._find.matches.length}`;
        if (m.page !== state.pageNum) {
            this.renderPage(m.page);   // async; _drawHighlights runs after it renders
        } else {
            this._drawHighlights();
        }
    },

    _drawHighlights() {
        const box = $('#pdf-highlights');
        const vp = this._renderViewport;
        const pageNum = this._renderPageNum;
        if (!box || !vp || !this._find.active) return;
        box.innerHTML = '';
        const items = this._find.pageText[pageNum];
        if (!items) return;
        const current = this._find.matches[this._find.current];
        let currentEl = null;
        this._find.matches.forEach((match) => {
            if (match.page !== pageNum) return;
            const it = items[match.itemIndex];
            if (!it) return;
            const t = it.transform, v = vp.transform;
            const a = v[0] * t[0] + v[2] * t[1];
            const b = v[1] * t[0] + v[3] * t[1];
            const c = v[0] * t[2] + v[2] * t[3];
            const d = v[1] * t[2] + v[3] * t[3];
            const e = v[0] * t[4] + v[2] * t[5] + v[4];
            const f = v[1] * t[4] + v[3] * t[5] + v[5];
            const fontH = Math.hypot(b, d);
            const w = it.width * vp.scale;
            const el = document.createElement('div');
            el.className = 'pdf-highlight';
            el.style.left = (e / vp.width) * 100 + '%';
            el.style.top = ((f - fontH) / vp.height) * 100 + '%';
            el.style.width = (w / vp.width) * 100 + '%';
            el.style.height = (fontH / vp.height) * 100 + '%';
            if (match === current) { el.classList.add('is-current'); currentEl = el; }
            box.appendChild(el);
        });
        if (currentEl) currentEl.scrollIntoView({ block: 'center', inline: 'center' });
    },
};

/* =========================================================
   REGION: BIND MODAL CLOSERS
   ========================================================= */
$$('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => modal.close(btn.getAttribute('data-modal-close')));
});
$('#help-toggle').addEventListener('click', () => modal.open('shortcuts-modal'));

/* =========================================================
   REGION: SETTINGS (read-only config + backups)
   ========================================================= */
const settings = (() => {
    function fmtBytes(n) {
        if (n == null) return '—';
        const u = ['B', 'KB', 'MB', 'GB'];
        let i = 0, v = n;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
        return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
    }
    function fmtDate(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
    }

    function triggerDownload(url) {
        const a = document.createElement('a');
        a.href = url;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 150);
    }

    async function open() {
        modal.open('settings-modal');
        $('#settings-backup-meta').textContent = 'Loading…';
        $('#settings-backup-list').innerHTML = '';
        $('#settings-info').innerHTML = '';
        try {
            const [status, info] = await Promise.all([api.backupStatus(), api.instanceInfo()]);
            render(status, info);
        } catch (err) {
            $('#settings-backup-meta').textContent = 'Could not load settings: ' + (err.message || err);
        }
    }

    function render(status, info) {
        const badge = $('#settings-backup-state');
        badge.textContent = status.enabled ? 'Automatic' : 'Manual only';
        badge.className = 'settings__badge ' + (status.enabled ? 'is-on' : 'is-off');

        const meta = [
            status.enabled ? `every ${status.interval_hours}h, keep ${status.keep}` : 'scheduler off',
            status.include_uploads ? 'DB + PDFs' : 'DB only',
            status.latest ? `last ${fmtDate(status.latest.modified)}` : 'none yet',
        ];
        $('#settings-backup-meta').textContent = `${meta.join(' · ')}\n${status.dir}`;

        const list = $('#settings-backup-list');
        list.innerHTML = '';
        if (!status.backups.length) {
            const li = document.createElement('li');
            li.className = 'settings__backups-empty';
            li.textContent = 'No backups yet.';
            list.appendChild(li);
        } else {
            for (const b of status.backups) {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.className = 'settings__backup-name';
                a.textContent = b.name.replace(/^crane-backup-/, '').replace(/\.zip$/, '');
                a.title = 'Download ' + b.name;
                a.href = '/api/backup/download/' + encodeURIComponent(b.name);
                const size = document.createElement('span');
                size.className = 'settings__backup-size';
                size.textContent = fmtBytes(b.size);
                li.appendChild(a);
                li.appendChild(size);
                list.appendChild(li);
            }
        }

        const dl = $('#settings-info');
        dl.innerHTML = '';
        const rows = [
            ['Version', info.version],
            ['Catalogue', `${info.cranes} cranes · ${info.files} files`],
            ['Database', info.paths.database],
            ['PDFs', info.paths.uploads],
            ['Backups', info.paths.backups],
            ['Max upload', `${info.limits.max_upload_mb} MB`],
            ['Behind proxy', info.trust_proxy ? 'yes' : 'no'],
        ];
        for (const [k, v] of rows) {
            const dt = document.createElement('dt'); dt.textContent = k;
            const dd = document.createElement('dd'); dd.textContent = v; dd.title = v;
            dl.appendChild(dt); dl.appendChild(dd);
        }
    }

    async function backupNow() {
        const btn = $('#settings-backup-now');
        btn.disabled = true;
        try {
            await api.backupNow();
            toast.success('Backup created');
            const [status, info] = await Promise.all([api.backupStatus(), api.instanceInfo()]);
            render(status, info);
        } catch (err) {
            toast.danger('Backup failed', err.message || String(err));
        } finally {
            btn.disabled = false;
        }
    }

    $('#settings-btn').addEventListener('click', open);
    $('#settings-backup-now').addEventListener('click', backupNow);
    $('#settings-backup-download').addEventListener('click', () => {
        toast.info('Preparing backup', 'Your download will start shortly.');
        triggerDownload('/api/backup/download');
    });

    return { open };
})();

/* =========================================================
   REGION: FACETS · COMMAND PALETTE · DEEP LINKS
   ========================================================= */

// Fill the make/type autocomplete <datalist>s and the merge-tool selects from /api/facets.
async function refreshFacets() {
    let f;
    try { f = await api.facets(); } catch (_) { return; }
    const fillDatalist = (el, values) => {
        if (!el) return;
        el.innerHTML = '';
        for (const v of values) { const o = document.createElement('option'); o.value = v; el.appendChild(o); }
    };
    fillDatalist($('#facet-makes'), f.makes);
    fillDatalist($('#facet-types'), f.types);
    const fillSelect = (el, values, ph) => {
        if (!el) return;
        const keep = el.value;
        el.innerHTML = '';
        const d = document.createElement('option'); d.value = ''; d.textContent = ph; el.appendChild(d);
        for (const v of values) { const o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o); }
        if (values.includes(keep)) el.value = keep;
    };
    fillSelect($('#merge-from'), f.makes, 'From…');
    fillSelect($('#merge-into'), f.makes, 'Into…');
}

// Open a crane the way clicking it in the sidebar would: select its make, load its
// primary file, highlight the row. Used by the palette and deep-link resolution.
function openCrane(crane) {
    if (!crane) return;
    const make = crane.make || 'Unknown';
    const makeBtn = Array.from($('#make-list').querySelectorAll('.make-item')).find(b => b.dataset.make === make);
    if (makeBtn) {
        const group = (state.files || []).filter(f => (f.make || 'Unknown') === make);
        sidebar.selectMake(make, group, makeBtn);
    }
    viewer.openFile(crane);
    sidebar._flushModelQueue();
    const row = Array.from($('#model-list').querySelectorAll('.model-item'))
        .find(r => r.dataset.filename === crane.id);
    if (row) {
        $$('.model-item').forEach(el => el.classList.remove('is-active'));
        row.classList.add('is-active');
        row.scrollIntoView({ block: 'nearest' });
    }
}

// ---- Deep links (/#crane/<id>) ----
const deepLink = (() => {
    let suppress = false;
    function set(id) {
        const target = '#crane/' + encodeURIComponent(id);
        if (location.hash === target) return;
        suppress = true;
        location.hash = target;
        setTimeout(() => { suppress = false; }, 0);
    }
    function resolve() {
        const m = location.hash.match(/^#crane\/(.+)$/);
        if (!m) return;
        const id = decodeURIComponent(m[1]);
        if (state.current && state.current.id === id) return;
        const crane = (state.files || []).find(f => f.id === id);
        if (crane) openCrane(crane);
    }
    window.addEventListener('hashchange', () => { if (!suppress) resolve(); });
    return { set, resolve };
})();

// ---- Command palette (Ctrl/Cmd+K) ----
const palette = (() => {
    const input = $('#palette-input');
    const results = $('#palette-results');
    let items = [];
    let active = -1;

    // A "minimum capacity" query: ">=150", ">150", "≥150", "150+", "150t+".
    function minCapacity(q) {
        let m = q.match(/^\s*(?:>=|>|≥)\s*(\d+(?:\.\d+)?)/);
        if (!m) m = q.match(/^\s*(\d+(?:\.\d+)?)\s*t?\s*\+\s*$/i);
        return m ? parseFloat(m[1]) : null;
    }

    function run(raw) {
        const q = (raw || '').trim().toLowerCase();
        const all = state.files || [];
        let list;
        if (!q) {
            list = all;
        } else {
            const min = minCapacity(q);
            if (min != null) {
                list = all.filter(c => { const n = parseCapacity(c.capacity); return n != null && n >= min; })
                          .sort((a, b) => (parseCapacity(a.capacity) || 0) - (parseCapacity(b.capacity) || 0));
            } else {
                const terms = q.split(/\s+/);
                list = all.filter(c => {
                    const hay = `${c.make || ''} ${c.type || ''} ${c.model || ''} ${c.capacity || ''} ` +
                        (c.files || []).map(f => f.label || '').join(' ');
                    const low = hay.toLowerCase();
                    return terms.every(t => low.includes(t));
                });
            }
        }
        items = list.slice(0, 60);
        active = items.length ? 0 : -1;
        render();
    }

    function render() {
        results.innerHTML = '';
        if (!items.length) {
            const li = document.createElement('li');
            li.className = 'palette__empty';
            li.textContent = (state.files || []).length ? 'No cranes match.' : 'No cranes yet.';
            results.appendChild(li);
            return;
        }
        items.forEach((c, i) => {
            const li = document.createElement('li');
            li.className = 'palette__result' + (i === active ? ' is-active' : '');
            li.innerHTML = '<span class="palette__result-title"></span><span class="palette__result-meta"></span>';
            li.querySelector('.palette__result-title').textContent = `${c.make || ''} ${c.model || ''}`.trim();
            li.querySelector('.palette__result-meta').textContent =
                [c.capacity, c.type, (c.file_count > 1 ? `${c.file_count} files` : '')].filter(Boolean).join(' · ');
            li.addEventListener('click', () => choose(i));
            results.appendChild(li);
        });
        const act = results.querySelector('.is-active');
        if (act) act.scrollIntoView({ block: 'nearest' });
    }

    function choose(i) {
        const c = items[i];
        if (!c) return;
        modal.close('palette-modal');
        openCrane(c);
    }

    function open() {
        if (modal.isOpen()) return;
        modal.open('palette-modal');
        input.value = '';
        run('');
        input.focus();
    }

    input.addEventListener('input', () => run(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active = Math.min(active + 1, items.length - 1); render(); } }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active = Math.max(active - 1, 0); render(); } }
        else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) choose(active); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); modal.close('palette-modal'); }
    });

    return { open };
})();

// ---- Merge-manufacturers tool (in the Settings panel) ----
$('#merge-btn').addEventListener('click', async () => {
    const from = $('#merge-from').value;
    const into = $('#merge-into').value;
    const status = $('#merge-status');
    if (!from || !into) { status.textContent = 'Pick both manufacturers.'; return; }
    if (from === into) { status.textContent = 'Pick two different manufacturers.'; return; }
    const ok = await confirmDialog(`Move all "${from}" cranes onto "${into}"? This can't be undone.`);
    if (!ok) return;
    status.textContent = 'Merging…';
    try {
        const res = await api.mergeMake(from, into);
        status.textContent = `Merged ${res.moved + res.absorbed} crane(s) into "${into}".`;
        toast.success('Manufacturers merged');
        await sidebar.loadFileList();
        await refreshFacets();
    } catch (err) {
        status.textContent = '';
        toast.danger('Merge failed', err.message || String(err));
    }
});

$('#palette-hint').addEventListener('click', () => palette.open());

/* =========================================================
   REGION: INIT
   =========================================================
   NOTE: this module has a top-level `await import(...)` for PDF.js.
   That means by the time we reach this point, DOMContentLoaded has
   likely already fired (the spec lets DCL fire once a module reaches
   its first await). Listening for DCL here would silently never run
   and every click handler attached inside init() would be missing.
   Since module scripts are deferred, the DOM is fully parsed when
   this body executes — we can safely call start() directly, with
   a fallback for the rare case where readyState is still 'loading'.
*/
function start() {
    // R-016: read breakpoint values from CSS custom properties so JS and CSS
    // share a single source of truth. parseInt strips the unit-less integer.
    const cs = getComputedStyle(document.documentElement);
    BP_MOBILE = parseInt(cs.getPropertyValue('--bp-mobile')) || 640;
    BP_TABLET = parseInt(cs.getPropertyValue('--bp-tablet')) || 900;

    localizeKbds();
    theme.init();
    shortcuts.init();
    dropzone.init();
    sidebar.init();
    viewer.init();
    // Open a deep-linked crane (/#crane/<id>) once the catalogue has loaded.
    sidebar.loadFileList().then(() => deepLink.resolve());
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}
