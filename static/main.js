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
    current: null,              // currently-open file record
    selectedMake: null,
    pendingFile: null,          // file pending in upload modal
    renderToken: 0,
    openToken: 0,               // monotonic — aborts stale openFile() calls
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
    upload(file, fields, onProgress) {
        // XHR (not fetch) so we can show real upload progress.
        return new Promise((resolve, reject) => {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('make', fields.make);
            fd.append('type', fields.type);
            fd.append('model', fields.model);
            fd.append('capacity', fields.capacity);
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
    async remove(filename) {
        const r = await fetch('/api/delete/' + encodeURIComponent(filename), {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrfToken() },
        });
        if (!r.ok) throw new Error((await safeErr(r)) || 'Delete failed');
        return r.json();
    },
};

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
    const elFileField = $('#file-field');
    const elFileInput = $('#file-input');
    const elPickerTxt = $('#file-picker-text');
    const elSubmit    = $('#form-submit-btn');
    const elMake      = $('#make-input');
    const elType      = $('#type-input');
    const elModel     = $('#model-input');
    const elCapacity  = $('#capacity-input');

    function reset() {
        state.pendingFile = null;
        elFileInput.value = '';
        elPickerTxt.textContent = 'Click to choose a PDF';
        elMake.value = '';
        elType.value = '';
        elModel.value = '';
        elCapacity.value = '';
    }

    function openUpload(file) {
        reset();
        state.submitToken++;
        elSubmit.classList.remove('btn--loading');
        elSubmit.disabled = false;
        elMode.value = 'upload';
        elOrigName.value = '';
        elTitle.textContent = 'Upload crane specification';
        elSubmit.textContent = 'Upload';
        elFileField.hidden = false;
        if (file) setPendingFile(file);
        // If a file is already chosen (drag-drop path), start on Manufacturer;
        // otherwise start on the file picker so keyboard users land there first.
        modal.open('metadata-modal', { focus: file ? '#make-input' : '#file-picker' });
    }

    function openEdit(record) {
        reset();
        state.submitToken++;
        elSubmit.classList.remove('btn--loading');
        elSubmit.disabled = false;
        elMode.value = 'edit';
        elOrigName.value = record.name;
        elTitle.textContent = 'Edit specification';
        elSubmit.textContent = 'Save changes';
        elFileField.hidden = true;
        elMake.value     = record.make     || '';
        elType.value     = record.type     || '';
        elModel.value    = record.model    || '';
        elCapacity.value = record.capacity || '';
        modal.open('metadata-modal', { focus: '#make-input' });
    }

    function setPendingFile(file) {
        state.pendingFile = file;
        elPickerTxt.textContent = file.name;
    }

    elFileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) setPendingFile(f);
    });

    $('#file-picker').addEventListener('click', () => elFileInput.click());

    $('#metadata-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fields = {
            make: elMake.value.trim(),
            type: elType.value.trim(),
            model: elModel.value.trim(),
            capacity: elCapacity.value.trim(),
        };
        if (!fields.make || !fields.type || !fields.model || !fields.capacity) {
            toast.warning('Missing details', 'All four fields are required.');
            // D (round 8): focus the first empty field so the user can fix it immediately.
            const first = [
                [fields.make, elMake],
                [fields.type, elType],
                [fields.model, elModel],
                [fields.capacity, elCapacity],
            ].find(([v]) => !v);
            if (first) first[1].focus();
            return;
        }
        elSubmit.disabled = true;
        // Capture mode at submit time so the finally clause can't clobber a freshly
        // re-opened modal that may have switched into a different mode meanwhile.
        const submittedMode = elMode.value;
        const submittedToken = ++state.submitToken;
        try {
            if (submittedMode === 'upload') {
                if (!state.pendingFile) {
                    toast.warning('No file selected', 'Choose a PDF first.');
                    elSubmit.disabled = false;
                    return;
                }
                elSubmit.classList.add('btn--loading');
                elSubmit.textContent = 'Uploading… 0%';
                await api.upload(state.pendingFile, fields, (loaded, total) => {
                    const pct = total ? Math.round((loaded / total) * 100) : 0;
                    elSubmit.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Saving…';
                });
                modal.close('metadata-modal');
                toast.success('Specification uploaded');
                await sidebar.loadFileList();
            } else {
                const oldName = elOrigName.value;
                const result = await api.updateMetadata(oldName, fields);
                modal.close('metadata-modal');
                toast.success(result.renamed ? 'Saved & renamed' : 'Saved');
                const wasOpen = state.current && state.current.name === oldName;
                if (wasOpen) {
                    state.current = { ...state.current, ...fields, name: result.name, url: result.url };
                    // Repaint info bar + title so values are current even when no rename triggers reopen.
                    updateInfoBar(state.current);
                    updateTitle(state.current);
                }
                await sidebar.loadFileList();
                if (wasOpen && result.renamed) {
                    const next = state.files.find(f => f.name === result.name);
                    if (next) viewer.openFile(next);
                }
            }
        } catch (err) {
            toast.danger('Action failed', err.message || String(err));
        } finally {
            elSubmit.disabled = false;
            // Only restore label/spinner if this submit run is still the latest one.
            // A newer open of the modal (different mode) bumps submitToken and we skip.
            if (submittedToken === state.submitToken) {
                elSubmit.classList.remove('btn--loading');
                elSubmit.textContent = submittedMode === 'upload' ? 'Upload' : 'Save changes';
            }
        }
    });

    return { openUpload, openEdit, setPendingFile };
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
            const s = $('#search-input');
            // On mobile the input is display:none until the toggle button reveals it.
            if (window.getComputedStyle(s).display === 'none') {
                $('#search-toggle').click();
            } else {
                s.focus(); s.select();
            }
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
            if (files.length > 1) {
                toast.warning('Single file only', 'Drop one PDF at a time.');
                return;
            }
            const file = files[0];
            if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
                toast.warning('PDF only', 'Only PDF files can be uploaded.');
                return;
            }
            // A: ignore drops while a modal is open so we don't wipe an in-progress edit.
            if (modal.isOpen()) {
                toast.warning('Close the open dialog first', 'Then drop the PDF to start a new upload.');
                return;
            }
            metadataModal.openUpload(file);
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
            queue.push({ kind: 'header', text: type });
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
        // D (round 9): full label tooltip for truncated model names.
        body.title = (file.model || 'Unknown') + (file.capacity ? ` · ${file.capacity}` : '');
        body.innerHTML = `
            <div class="model-item__name"></div>
            <div class="model-item__capacity"></div>
        `;
        body.querySelector('.model-item__name').textContent = file.model || 'Unknown';
        body.querySelector('.model-item__capacity').textContent = file.capacity || '—';
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
                const head = document.createElement('div');
                head.className = 'type-header';
                head.textContent = item.text;
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

        // F (round 7) + I (round 9): use a class instead of inline style so a stricter
        // CSP can drop 'unsafe-inline' from style-src-attr in the future.
        let visibleMakes = 0;
        $$('.make-item', makeList).forEach(el => {
            const match = !q || el.textContent.toLowerCase().includes(q);
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

        this.openEmpty();
    },

    openEmpty() {
        if (state.pdfDoc && typeof state.pdfDoc.destroy === 'function') {
            try { state.pdfDoc.destroy(); } catch (_) {}
        }
        state.pdfDoc = null;
        state.current = null;
        state.pageNum = 1;
        state.pageCount = 0;
        $('#viewer-empty').hidden = false;
        $('#info-bar').hidden = true;
        $('#pdf-viewer').hidden = true;
        $('#toolbar').hidden = true;
        $$('.model-item.is-active').forEach(el => el.classList.remove('is-active'));
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

    async openFile(file) {
        const token = ++state.openToken;
        state.current = file;
        state.fitMode = 'page';
        state.pageNum = 1;
        $('#viewer-empty').hidden = true;
        $('#info-bar').hidden = false;
        $('#pdf-viewer').hidden = false;
        $('#toolbar').hidden = false;
        $('#viewer-skeleton').hidden = false;

        updateInfoBar(file);
        updateTitle(file);

        // Free the previous document before loading the next one.
        if (state.pdfDoc && typeof state.pdfDoc.destroy === 'function') {
            try { state.pdfDoc.destroy(); } catch (_) {}
        }
        state.pdfDoc = null;
        state.pageCount = 0;

        try {
            const doc = await pdfjsLib.getDocument(file.url).promise;
            if (token !== state.openToken) {
                // A newer openFile() superseded us; throw away this doc.
                try { doc.destroy(); } catch (_) {}
                return;
            }
            state.pdfDoc = doc;
            state.pageCount = doc.numPages;
            $('#page-input').max = doc.numPages;
            $('#page-input').value = 1;
            $('#page-total').textContent = doc.numPages;
            await this.renderPage(1);
        } catch (err) {
            if (token !== state.openToken) return;
            $('#viewer-skeleton').hidden = true;
            toast.danger('Could not open PDF', err.message || String(err));
        }
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
        if (!state.current) return;
        const a = document.createElement('a');
        a.href = state.current.url;
        a.download = state.current.original_filename || state.current.name;
        document.body.appendChild(a);
        a.click();
        // R-018: defer removal so browsers have time to initiate the download
        // before the anchor is detached from the DOM.
        setTimeout(() => a.remove(), 150);
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
    sidebar.loadFileList();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}
