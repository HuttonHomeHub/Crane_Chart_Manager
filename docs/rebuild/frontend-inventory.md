# Crane Charts front-end inventory (for the React + TS rebuild)

Sources: `/home/claude/projects/Crane_Chart_Manager/templates/index.html` (468 lines), `static/main.js` (2662 lines, a single ES module), `static/main.css` (1911 lines) and `tests/e2e/test_e2e.py` (24 tests). Line numbers below are main.js unless marked `css:` or `html:`. I edited nothing and ran nothing that changes files.

## 0. Static assets and boot

**Contents of `static/`:**

- `main.js` and `main.css`.
- `vendor/pdf.js/pdf.min.mjs` and `vendor/pdf.js/pdf.worker.min.mjs`. This is **PDF.js 4.6.82**, self-hosted, not from a CDN.
- `Octocat.png` (2.1 MB). Nothing references it, so it looks like dead weight.

**How the page loads assets (html:25-36):**

- Inter comes from Google Fonts (weights 400/500/600/700).
- `main.css` is loaded through `versioned_static()`, which appends `?v=<md5[:8]>`.
- `<link rel=modulepreload>` for `pdf.min.mjs` and for `main.js`.
- `<link rel=preload as=fetch crossorigin>` for the worker.
- `main.js` is loaded as `<script type=module>` (html:466).

**PDF.js setup (1-27):**

- Loaded with a top-level `await import('/static/vendor/pdf.js/pdf.min.mjs')`.
- `GlobalWorkerOptions.workerSrc = '/static/vendor/pdf.js/pdf.worker.min.mjs'` and `workerType = 'module'`.
- No `cMapUrl`, `standardFontDataUrl` or `isEvalSupported` options are set. `getDocument(file.url)` is called with defaults (1823).
- If the import fails, a DOMContentLoaded listener replaces `#viewer-empty` with an alert icon, "PDF viewer failed to load" and a hint about connection or blockers. Then the error is rethrown.
  - Possible bug, not verified: the INIT comment (2630-2641) itself says DOMContentLoaded may already have fired by the time a top-level await runs, so this message might never appear.

**Startup sequence:** `start()` (2642-2662) runs straight away, falling back to DOMContentLoaded only if the document is still loading. It:

1. reads `--bp-mobile` and `--bp-tablet` from the CSS (fallbacks 640 and 900);
2. calls `localizeKbds`, then `theme.init`, `shortcuts.init`, `dropzone.init`, `sidebar.init`, `viewer.init`;
3. runs `sidebar.loadFileList().then(deepLink.resolve)`.

**Other page furniture:**

- A `<noscript>` panel: "Crane Charts requires JavaScript" plus a sentence (html:40-47).
- An inline Lucide SVG sprite with ~28 `<symbol id="icon-…">` entries (html:50-80), used everywhere via `<svg class="icon"><use href="#icon-x"/>`.
- The favicon is an inline SVG data URL (an amber crane).

**State object (80-96):** `pdfDoc, pageNum, pageCount, zoom, fitMode ('page'|'width'|'custom'), files, current (crane), currentFile, selectedMake, pendingFile, renderToken, openToken, findToken, submitToken, theme`.

**Tab title (107-112):** `"<make> <model> · Crane Charts"` while a crane is open, otherwise `"Crane Charts"`.

## 1. Page layout, responsive behaviour and theme

**Regions:**

- **App bar** (`header.app-bar`, 56px, `--app-bar-h`), left to right:
  - `#sidebar-toggle` (hamburger, `aria-expanded`).
  - Brand link `/`: crane icon, "Crane Charts", and `.app-bar__version` showing `{{app_version}}` (title "Running version").
  - Search box `.app-bar__search[role=search]`, 360px wide, containing:
    - `#search-input` (type=search, placeholder "Filter the list…", aria-label "Filter the sidebar list");
    - `kbd#palette-hint` (`data-mod-key="K"`, title "Jump to a crane"), which is clickable and opens the palette (2628).
  - Spacer.
  - Actions:
    - `#search-toggle` (mobile only);
    - `#settings-btn` (title "Settings & backups");
    - `#theme-toggle` (`#theme-icon`);
    - `#help-toggle` ("Keyboard shortcuts");
    - `#upload-trigger` (`.btn--primary`, "Upload" plus a kbd showing `data-mod-key="U"`).
- **Layout:** `.layout` is flex with height `calc(100vh - 56px)`, and the body has `overflow: hidden`.
- **Sidebar:** `nav#sidebar.sidebar` (aria-label "Documents"), 430px wide, a two-column grid of `148px 1fr`.
  - "Manufacturers" panel: `#makes-count`, `#make-list`.
  - "Models" panel: `#models-count`, `#model-list`.
  - The panel headers are 10px uppercase text with a pill count.
- `#sidebar-scrim` (mobile overlay).
- **Viewer:** `main.viewer`, in this order:
  - `#viewer-empty` (empty state, below);
  - `#info-bar` (hidden until a crane opens): four label/value groups, Manufacturer `#info-make`, Type `#info-type`, Model `#info-model`, Capacity `#info-capacity` (in the accent colour). The placeholder value is "—".
  - `#file-strip` (role=tablist, aria-label "Documents for this crane");
  - `#find-bar`;
  - `#pdf-viewer.viewer__well`, which contains `#viewer-skeleton` and `#pdf-stage` > `canvas#pdf-canvas` + `#pdf-highlights`;
  - `#toolbar.toolbar-pill` (role=toolbar, "PDF controls"), floating at the bottom centre.
- **Overlays:**
  - `#toast-stack` (role=region, "Notifications"), fixed top-right below the app bar.
  - `#dropzone`.
  - Seven native `<dialog class=modal>` elements: `metadata-modal`, `bulk-modal`, `settings-modal`, `palette-modal`, `shortcuts-modal`, `confirm-modal`.
  - `<datalist id=facet-makes>` and `<datalist id=facet-types>`.

**Empty state copy (`refreshEmptyCopy`, 1767-1781):**

| Catalogue has cranes? | Title                            | Body                                                                                                 | Button                         |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| Yes                   | "No document selected"           | "Choose a manufacturer and model from the sidebar, or drag a PDF onto the window to upload another." | "Upload another specification" |
| No                    | "No specifications uploaded yet" | "Drag a PDF anywhere on this window, or click upload to add your first spec."                        | "Upload your first spec"       |

The button is `#empty-upload-btn` and its label is `#empty-upload-label`. The template's initial copy differs slightly (html:142-146).

**Breakpoints.** The CSS tokens are `--bp-mobile: 640` and `--bp-tablet: 900` (unitless); JS reads them at start (2645-2647). The media queries are hard-coded, css:1790-1851.

- **≤900px:**
  - The hamburger is shown and the search box narrows to 220px.
  - The sidebar becomes a fixed drawer: `top: 56px`, `width: min(420px, 86vw)`, `translateX(-100%)`, and `.is-open` slides it in.
  - The scrim (`.is-visible`) shows. While the drawer is open, `main.viewer` gets `inert` (1219-1234).
  - Clicking a model row closes the drawer (1438).
  - The scrim click closes the drawer. Esc does not.
- **≤640px:**
  - The brand text spans are hidden, leaving the icon only.
  - `.btn--icon` buttons, the menu toggle and `.btn` grow to 44px tap targets.
  - The search box is hidden. `#search-toggle` (shown only ≤640, css:470-474) toggles `.app-bar__search.is-active`, a fixed overlay under the app bar, and focuses and selects the input.
  - Blur on an empty input closes the overlay when ≤640 (1202-1206). Esc in the search input closes and blurs it at any width (1207-1209). Leaving the mobile range strips `.is-active` (1211-1216).
  - The kbd chips in the app-bar actions are hidden. The info-bar values are capped at 140px.
  - Toolbar buttons become 40px.
- **≤520px:** hide `#fit-width`, `#fit-page`, `#fullscreen-btn` and the 2nd and 3rd toolbar dividers. The form grid and the shortcuts grid become one column.
- **≤420px:** hide `.app-bar__version`.
- **`(hover: none)`:** model-row actions are always visible (normally they appear on hover or focus-within).
- **`prefers-reduced-motion`:** all animations and transitions drop to 1ms, the skeleton shimmer stops, and the button spinner stops.
- **`@media print`:** hide all chrome and print only the canvas.
- Small bug: the `.is-open`, `.is-visible` and `inert` state is not cleared if you widen the window past 900px while the drawer is open. The scrim rule is outside the media query, so it would keep covering the page.

**Theme:**

- Dark is the default. The server renders `<html data-theme="dark">`.
- localStorage key **`crane.theme`** holds `'light'` or `'dark'`.
- An inline script carrying the CSP nonce (html:10-19) applies the stored value before the CSS evaluates, which avoids a flash of the wrong theme.
- `theme.apply` (377-393) sets the attribute, saves it, and swaps the icon: the **sun** shows in dark mode and the **moon** in light mode.
- `prefers-color-scheme` is never consulted.
- Tokens are on `:root[data-theme=dark]` and `:root[data-theme=light]` (css:6-138), including an amber accent (`#F59E0B` dark, `#D97706` light), plus `color-scheme`.
- Dark mode adds a dotted background on the viewer well (css:982).
- Common surfaces have 180ms colour transitions.
- The CSS references some tokens that are never defined: `--danger`, `--border`, `--success`, `--danger-muted-bg`. Some have fallbacks; for example `.file-chip__action--delete:hover`, `.modal__error` and `.settings__backup-restore` get no colour. Fix these while porting.

## 2. Sidebar (1187-1698)

**Data load (`loadFileList`, 1236-1259):**

- Shows skeleton rows: 8 in makes and 5 in models, each `.sidebar__skeleton-row` 36px tall with a shimmer.
- `api.listPdfs` (126-142) pages through `GET /api/pdfs?limit=200[&after=<next_cursor>]` until `next_cursor` is null. While pages are still arriving (`loaded < total`) it repaints progressively.
- When done it calls `renderMakes`, `viewer.refreshEmptyCopy()` and `refreshFacets()`.
- On error: a danger toast "Could not load documents" and both lists are cleared.

**Grouping is two levels: make, then type sub-headers, then model rows (`renderMakes` 1273-1365, `selectMake` 1367-1406):**

- A missing make becomes `'Unknown'`, a missing type `'Other'`, and a missing model name is shown as `'Unknown'`.
- Makes, types and models all sort with `naturalCompare`, which is `Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})` (301-302). So `LTM1300 < LTM1750 < LTM11200`.
- `#makes-count` is the number of makes. `#models-count` is the number of cranes in the selected make.
- An empty catalogue shows `.sidebar__empty` with an inbox icon and "No specifications yet.", and both counts become 0.

**Make row:**

- `button.make-item[data-make][title=make][aria-current]` containing `.make-item__name` and `.make-item__count` (the number of cranes).
- `.is-active` gives an amber inset bar.
- After a re-render the previous `state.selectedMake` is reselected, otherwise the first make.

**Type header:**

- Each type is a `div.type-group` containing `button.type-header[aria-expanded]` with a chevron, `.type-header__label` and `.type-header__count`.
- A click toggles `.type-group.is-collapsed`, and CSS then hides `.model-item`. The chevron rotates.
- Collapse state is **not persisted**, and it resets on every `selectMake`.

**Model row (`buildModelRow` 1408-1486):**

- `div.model-item[data-filename=<crane.name, i.e. the id>]` containing:
  - `button.model-item__body[aria-current]`: `.model-item__name`, then an optional `.model-item__filecount` badge (shown only when `file_count > 1`; text N, title and aria-label "N files"), then `.model-item__capacity` (CSS adds a "·" before it).
  - `.model-item__actions`:
    - `button.model-item__action--edit` (aria-label and title "Edit metadata"), which opens the edit modal;
    - `button.model-item__action--delete` (aria-label "Delete specification", title "Delete"), which runs `sidebar.deleteFile`.
- Clicking the body closes the drawer at ≤900px, calls `viewer.openFile(crane)`, and sets `.is-active` and `aria-current` on that row only.
- A row is pre-marked active if it matches `state.current`.

**Virtual scrolling (batched append, not a true windowed list):**

- `MODEL_RENDER_BATCH_SIZE = 60` (1185) counts **headers plus rows**.
- `selectMake` flattens everything into `_modelQueue` items `{kind: 'header'|'row'}` and appends 60 at a time (`_appendModelBatch` 1490-1522).
- A `div.sidebar__sentinel` (1px) is observed by an `IntersectionObserver` with `root: #model-list` and `rootMargin: '200px'`, and triggers the next batch (1532-1543).
- `_flushModelQueue()` renders everything that is left. It is called by `filter()` when a query is present, and by `openCrane`.
- There are no fixed row heights and nothing is removed from the DOM.

**Filter (`filter` 1609-1681):**

- It runs on every `input` event of `#search-input` with no debounce.
- The query is lower-cased and trimmed. Matching is a plain substring test.
- **Makes:** the haystack is `_makeSearchText[make]`, which joins every crane's `make type model capacity` plus all of its file labels (1312-1318). Non-matching makes get `.is-hidden`.
- **Jump to make:** if the query hides the currently selected make, it auto-selects the first visible make whose _name_ matches, otherwise the first visible make. A `_jumping` guard prevents re-entry.
- **Model rows:** the haystack is the selected make's name plus the row's textContent. Groups with no visible rows are hidden. When a query is present, collapsed groups are force-expanded.
- If nothing matches, the panel shows a "No matches for "<q>"" banner (`.sidebar__no-matches`, role=status). It is suppressed during the skeleton phase (1683-1697).
- After a re-render the filter is re-applied (1347-1348).

**Focus restore:** `renderMakes` remembers the focused make or model row and refocuses it after the rebuild (1279-1364).

**Selection persistence:** only in memory (`state.selectedMake`). Nothing is stored except the theme.

## 3. Viewer (1703-2281)

**Opening a crane (`openFile` 1785-1795):**

- Sets `state.current`, shows the info bar, updates the tab title, renders the strip, and calls `deepLink.set(id)`.
- Loads the primary file: `files.find(f => f.is_primary) || files[0]`.

**`_loadPdf(file)` (1804-1842):**

- Uses an `openToken` guard so a stale load is discarded and its document destroyed.
- Resets `fitMode` to 'page' and the page to 1, shows the well, toolbar and skeleton, and marks the active chip.
- Resets find and destroys the previous document.
- Sets `#page-input.max`, `#page-total`, and renders page 1. If find is open with a query, it re-runs the search.
- On error: a danger toast "Could not open PDF".

**`openEmpty()` (1746-1765):** destroys the document, hides the info bar, strip, well and toolbar, clears active rows, closes and resets find, and resets the title. It does **not** clear the URL hash.

**Rendering (`renderPage` 1987-2046):**

- One page at a time on one canvas. There is no continuous scroll, no text layer, no thumbnails and no prefetching.
- A `renderToken` guard discards stale renders.
- The available size is the well's client size minus padding.
- Scale: `width` mode uses `availW / pageW`; `page` mode uses `min(availW / pageW, availH / pageH)`; `custom` mode uses `state.zoom`. In the fit modes, `state.zoom` is set to the computed scale.
- `dpr = min(devicePixelRatio, 3)`. The canvas backing store is `viewport * dpr`, its CSS size is the viewport size, and `ctx.setTransform(dpr…)` applies the ratio.
- After rendering:
  - the skeleton hides;
  - `#zoom-level` shows `round(scale*100)+'%'`;
  - `#prev-page` is disabled at page 1 and `#next-page` at the last page;
  - the viewport is saved for the highlights, which are redrawn.
- Render errors only go to `console.error`.
- Subtle: CSS gives `#pdf-canvas` and `.pdf-stage` `max-width: 100%; height: auto` (css:986-1000). So a zoom wider than the well is **displayed shrunk to the well's width**; it only adds sharpness. The highlight overlay uses % positions for exactly this reason. Decide whether to keep this.
- Window resize re-renders after a 120ms debounce, unless the mode is custom (1734-1740). `fullscreenchange` re-renders and swaps the icon between `#icon-maximize` and `#icon-minimize` (1728-1732).

**Toolbar (html:203-240, 1705-1726):**

- `#prev-page`, then `#page-input` (type=number, min=1). The `change` event jumps to the page, which is clamped. Enter blurs the input, which fires `change`.
- `/`, then `#page-total`, then `#next-page`, a divider.
- `#zoom-out`, then the `#zoom-level` readout button. Clicking the readout cycles page → width → custom at 100% → page (2070-2081). Then `#zoom-in`, a divider.
- `#fit-width`, `#fit-page`, a divider.
- `#find-btn`, `#download-btn`, `#fullscreen-btn`.
- Zoom steps: `ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]` (114). `zoomStep` snaps the current zoom to the nearest step, moves ±1, clamps, and sets mode 'custom' (2052-2063).
- **Fullscreen** applies to `document.documentElement`, so the app bar, toasts and modals stay visible. If unsupported or rejected, a warning toast appears: "Fullscreen unavailable" or "Could not enter fullscreen" (2083-2098).
- **Download** (2100-2112) uses a temporary `<a href=file.url download=original_filename||stored_name||'document.pdf'>`, clicks it, and removes it after 150ms. It downloads the **currently displayed** file.
- There is **no** "open in new tab" action.

**File strip (`_renderStrip` 1855-1910):**

- Shown whenever a crane is open, including when it has a single file.
- Each file gets a `div.file-chip[data-file-id]` with `.is-primary` and `.is-active` as appropriate. It contains:
  - `button.file-chip__open` (title "View <label>"): an icon `.file-chip__star` (check-circle, amber when primary) and `.file-chip__label`. Click calls `showFile(id)`.
  - `button.file-chip__action--primary`: title and aria-label "Set as main file", or "This is the main file" when it is already the primary. It is disabled on the primary, and CSS hides it there.
  - `button.file-chip__action--edit`: title "Rename this file", aria-label "Rename <label>".
  - `button.file-chip__action--delete`: title "Delete this file", aria-label "Delete <label>".
- The label text is `label || original_filename || stored_name || 'Document'`.
- `#file-strip-add` ("Add file", title "Add a supplementary PDF to this crane") opens the metadata modal in addfile mode for the current crane.
- **Set primary** (1939-1949): `PUT /api/cranes/<id>/primary {file_id}`, then `_applyCrane(resp)`, a background `loadFileList()`, and a toast "Main file updated". On error: "Could not set main file".
- **Delete file** (1951-1974): confirm first. The text is `"<label>" is the only file. Deleting it removes the whole crane. Continue?` for the last file, otherwise `Delete "<label>" from this crane? This cannot be undone.`. Then `DELETE /api/cranes/<id>/files/<fid>` and a toast "File deleted". If the response has `crane_deleted`, it calls `openEmpty` and reloads the list; otherwise `_applyCrane` and reloads.
- **`_applyCrane`** (1921-1937) swaps in the new crane record, patches `state.files[idx]`, and re-renders the strip. If the displayed file no longer exists it loads the primary; otherwise it keeps the current file.

**In-PDF find (2115-2280):**

- The bar is `#find-bar` (role=search), absolutely positioned top-right of the viewer (top 10px, right 16px, z 40). It contains:
  - `#find-input` (placeholder "Find in document…");
  - `#find-count` (aria-live=polite);
  - `#find-prev` (title "Previous match (Shift+Enter)") and `#find-next` (title "Next match (Enter)"), both disabled until there are matches;
  - `#find-close` (title "Close (Esc)").
- **Opening:** the toolbar button, **Ctrl or Cmd+F** when a document is loaded (overrides the browser's find), or **`/`** when a document is loaded, find isn't already active, and the target isn't INPUT, TEXTAREA or SELECT. This is a `window` keydown listener (2136-2146).
- `openFind` focuses and selects the input, and re-runs the search if there is text.
- **Input:** search runs after a 180ms debounce. Enter goes to the next match and Shift+Enter to the previous. Esc closes (with `stopPropagation`).
- **Search (`_runFind` 2191-2227):**
  - Lower-cased substring test against each `getTextContent()` item's `str`. Matches never span items.
  - Scans every page in order, using a per-page cache `_find.pageText[page]` (empty strings are filtered out).
  - A `findToken` cancels stale scans.
  - Count text is `"i/N"`, `"0/0"` for no matches, and empty for an empty query.
  - The first selected match is the first one on or after the current page. Navigation wraps.
- **Highlights (`_drawHighlights` 2247-2280):**
  - Each match is one `div.pdf-highlight` inside `#pdf-highlights`, covering the **whole text item**.
  - The rectangle comes from the item's `transform` composed with `viewport.transform`: height is `hypot(b, d)`, width is `item.width * vp.scale`, and the top is `f - fontH`. Positions are expressed in **%** of the viewport.
  - The current match also gets `.is-current` (stronger amber plus an outline) and `scrollIntoView({block: 'center', inline: 'center'})`.
  - The overlay has `pointer-events: none`.
  - Highlights are redrawn after every page render. A match on another page triggers that page's render first.
- `closeFind` hides the bar and clears highlights but keeps the query. `_resetFind` runs on every new document.

## 4. Metadata modal (`#metadata-modal`, 524-798)

**Elements:**

- Hidden inputs `#form-mode`, `#form-original-filename` (the edit target id) and `#form-crane-id`.
- `#file-field`: `button#file-picker` with `#file-picker-text` (default "Click to choose a PDF") and `#file-picker-hint` ("PDF only · 500 MB max · or drop one anywhere on the page"), plus a hidden `input#file-input` (accept `application/pdf,.pdf`, **multiple**).
- `#metadata-grid`, a two-column grid:
  - `#make-input` (label "Manufacturer", placeholder "Liebherr, Tadano, Manitowoc…", `list=facet-makes`);
  - `#type-input` ("Type", "Mobile, Crawler, Tower…", `list=facet-types`);
  - `#model-input` ("Model", "LTM 1200-3.1");
  - `#capacity-input` ("Rated capacity", "200 t").
- `#label-field` with `#label-input` (label "File label — optional", placeholder "Outrigger chart, Transport dimensions…").
- `#addfile-newcrane` ("Create a new crane instead →").
- Footer: `#modal-error` (role=alert), Cancel (`data-modal-close`), and `#form-submit-btn`.

**Modes (set by `prep()`, which resets fields, clears the error, increments `submitToken` and hides the new-crane link):**

| Mode              | Title                                        | Submit label   | Visible                              | Initial focus                                            |
| ----------------- | -------------------------------------------- | -------------- | ------------------------------------ | -------------------------------------------------------- |
| `upload` (570)    | "Upload crane specification"                 | "Upload"       | file picker + grid                   | `#make-input` if a file was passed, else `#file-picker`  |
| `edit` (593)      | "Edit specification"                         | "Save changes" | grid (prefilled)                     | `#make-input`                                            |
| `addfile` (608)   | `Add file to <make> <model>` (or "Add file") | "Add file"     | file picker + label + new-crane link | `#label-input` if a file was passed, else `#file-picker` |
| `editlabel` (621) | "Rename file"                                | "Save"         | label (prefilled)                    | `#label-input`                                           |

**Choosing a file:**

- **Prefill** (586-591): in upload mode only, and only into empty fields. Uses `parseFilename()` to set make and model. The label is not used here.
- **Picker change** (639-650): if more than one file is chosen in upload mode, the modal closes and `bulkImport.open(files)` takes over. Otherwise it sets the pending file (the picker text becomes the filename) and prefills.
- **Drag onto `#file-field`** (656-679): `dragover` adds `.is-dragover` and stops propagation, so the window dropzone stays out of it. On `drop`, only PDFs are kept (`/\.pdf$/i` or `type === 'application/pdf'`). If none remain, the inline error reads "Only PDF files can be uploaded.". Two or more in upload mode go to bulk; otherwise the first file is used.

**Submit (738-795):**

1. Upload and addfile modes need a pending file. If missing: warning toast "No file selected" / "Choose a PDF first.".
2. Upload and edit modes require all four fields after trimming. If any is missing: warning toast "Missing details" / "All four fields are required." and focus moves to the first empty field.
3. There are no other client-side checks: no max-size check, and no PDF check on the picker path apart from the `accept` attribute.
4. The button is disabled and the error cleared.

What each mode does:

- **upload:** sends an XHR `POST /api/upload` with multipart fields `file, make, type, model, capacity[, label]`. The button reads `Uploading… N%` and then "Saving…" at 100%. On success: the modal closes, toast "Specification uploaded", and `loadFileList`.
- **addfile:** XHR `POST /api/cranes/<id>/files` (`file[, label]`) with the same progress text. Then toast "File added", `_applyCrane` if this crane is the open one, and `loadFileList`.
- **edit:** `PUT /api/metadata/<oldId>` with JSON `{make, type, model, capacity}`. Toast "Saved & renamed" when the response has `renamed`, otherwise "Saved". Then `loadFileList`. If the edited crane was open:
  - if renamed, it is reopened from `state.files` by `result.id` (the URLs changed);
  - otherwise `state.current`, the info bar, the title and the strip are updated in place.
- **editlabel:** `PATCH /api/cranes/<id>/files/<fid>` with `{label}`. Toast "File renamed". If this crane is open, `viewer.applyLabelEdit`; otherwise `loadFileList`.

Errors from the server or network appear **inline** in `#modal-error` via `showError(err.message)`, and the dialog stays open. The `finally` block restores the button label only when `submitToken` is unchanged (a stale-submit guard).

**"Create a new crane instead"** (736) calls `openUpload(state.pendingFile)` and keeps the chosen file.

**Drag-and-drop routing (window dropzone, 1105-1179):**

- `dragenter`, `dragover`, `dragleave` and `drop` listeners on `window`, filtered to file drags (`dataTransfer.types` includes 'Files').
- A counter tracks nested `dragenter`/`dragleave`. A **700ms watchdog**, re-armed on each `dragover`, force-hides the overlay.
- While any modal is open, the overlay never shows and drops are ignored.
- On drop:
  - 0 files: nothing.
  - **2 or more files:** the bulk importer.
  - 1 non-PDF: warning toast "PDF only" / "Only PDF files can be uploaded.".
  - 1 PDF **with a crane open:** `openAddFile(current, file)`.
  - 1 PDF **with no crane open:** `openUpload(file)`.
- Overlay copy: "Drop PDF to upload" / "We'll ask for the manufacturer, type, model, and capacity next.".

**Autocomplete:** native `<datalist>`s filled from `GET /api/facets` (`{makes, types}`) by `refreshFacets()` (2451-2471). It runs after every `loadFileList` and after a merge or restore, and it also fills the merge selects.

## 5. Bulk import (`#bulk-modal`, 806-1039)

**Filename parsing (`parseFilename` 41-50):**

1. Strip `/\.pdf$/i` and trim.
2. Match `/^(.*?)\s*\(([^)]*)\)\s*$/`. If it matches, the base is group 1 and the **label** is group 2, both trimmed. Only a parenthetical at the very end counts.
3. Split the base on `/\s+/`. **make** is the first token and **model** is the rest joined by single spaces.
4. Type and capacity are **never** parsed.

Example: `"Liebherr LTM1100 (Load Chart).pdf"` gives `{make: 'Liebherr', model: 'LTM1100', label: 'Load Chart'}`.

**Opening:** `open(fileList)` keeps only PDFs. If none remain: warning toast "No PDFs" / "Only PDF files can be imported.".

**Grouping (`buildDrafts`):** files are grouped by the lower-cased key `make|model`. Each draft is `{make, model, type: '', capacity: '', files: [{file, label, name}], primaryIdx: 0, status: 'pending', error: ''}`. On open:

- the submit button resets to "Import";
- the "Set all types" field is cleared;
- focus goes to `#bulk-fill-type`.

**Review UI:**

- `#bulk-summary` reads `"N file(s) → M crane(s)"`, with correct singular and plural.
- `#bulk-grid` holds `.bulk__row` elements. The header row is `.bulk__row--head` with columns "Manufacturer, Model, Type, Capacity, Files, (blank)". The grid template is `1.1fr 1.1fr .9fr .9fr 1.6fr 28px` and the header is sticky.
- Each data row has four `input.bulk__input` elements with **`aria-label` set to `make`, `model`, `type` and `capacity`**. Placeholders are Liebherr, LTM1100, Mobile and 100t. Make and type use the datalists.
- The files cell (`.bulk__files`) has one `label.bulk__file` per file, showing `label || filename` (title is the filename). When a crane has several files, each also gets a radio `name=bulk-primary-<rowIdx>` (title "Make this the main file"); the first is checked by default.
- `.bulk__status` shows a check-circle icon when done, an alert icon when failed (title holds the error), and "…" while uploading.
- "Set all types": `#bulk-fill-type` and `#bulk-fill-type-apply` ("Apply to all"; Enter in the field also applies). It fills Type on every row that isn't done.
- Typing in a row clears that row's error state.

**Validation (939-958), skipping rows already done:**

- All four fields are required. Failure marks the row `.is-invalid` with the error "Fill in all four fields".
- Duplicates are detected on lower-cased `make|type|model|capacity`. Failure: "Duplicate of another row".
- If any row fails: warning toast "Some rows need attention" / "Fix the highlighted rows first.".

**Submit (974-1021):**

- Sequential: one crane at a time, no concurrency. A `running` flag prevents double-submit.
- For each pending row:
  1. upload the primary with `api.upload(file, fields, null, primary.label)`; there is no per-file progress;
  2. then add each remaining file with `api.addFile(crane.id, file, label)`.
- `#bulk-progress` shows "Importing… x/N".
- Each call is wrapped in `withRetry` (961-972): it retries when the error message matches `/\(429\)|too many/i`, up to 5 retries, waiting `1200 * (attempt+1)` ms (1.2s, 2.4s, 3.6s, 4.8s, 6.0s).
- Rows that finish are marked done and their inputs disabled (the radios are not).
- Afterwards `loadFileList` runs, then:
  - **no failures:** toast "Imported N crane(s)" and the modal closes;
  - **some failures:** the button changes to "Retry failed", progress reads `"<done> imported · <failed> failed — fix and retry"`, and a warning toast says "Some imports failed" / "<n> row(s) need attention.".
- Risk: if a crane's primary uploads but an extra file then fails, the whole row is marked as failed. "Retry" re-uploads the primary, which will hit a 409 (duplicate crane). Closing the modal mid-run does not stop the loop.

## 6. Command palette (`#palette-modal`, 2517-2603)

**Opening:**

- **Ctrl+K** (Cmd+K on Mac), from anywhere including inputs, but ignored while any modal is open (1056-1061).
- Clicking `#palette-hint`.
- The dialog has `class="modal palette"`, aria-label "Find a crane", and sits at 12vh from the top.

**Contents:**

- `#palette-input` (placeholder "Jump to a crane — make, model, or capacity (try ≥150t)", spellcheck off) and a close button.
- `ul#palette-results`.
- A hint footer: "↑↓ navigate · ↵ open · Esc close".

**Matching (`run` 2530-2554):**

- The query is trimmed and lower-cased. An empty query lists all cranes in server order.
- **Minimum-capacity query** (`minCapacity` 2524-2528): `/^\s*(?:>=|>|≥)\s*(\d+(?:\.\d+)?)/` or `/^\s*(\d+(?:\.\d+)?)\s*t?\s*\+\s*$/i`.
  - The result is every crane where `parseCapacity(c.capacity) >= N`, sorted **ascending** by capacity.
  - Note that `>` behaves the same as `>=`.
  - `parseCapacity` (293-296) strips commas and whitespace and takes the first number. For example "1 200 t" gives 1200.
- **Otherwise:** the query is split on whitespace, and every term must be a substring of the lower-cased `make type model capacity` plus the file labels.
- Results are capped at **60**.

**Rendering:**

- Each result is `li.palette__result` with `.palette__result-title` ("make model") and `.palette__result-meta` ("capacity · type · N files", where "N files" appears only when there is more than one).
- The active item has `.is-active` and is scrolled into view.
- Empty results show `li.palette__empty`: "No cranes match." or "No cranes yet.".

**Keys (input keydown):**

- ArrowDown and ArrowUp move the active item, clamped with no wrap.
- Enter calls `choose(active)`.
- Esc closes, with `stopPropagation`.
- Clicking a result chooses it.
- `choose` closes the palette and calls `openCrane(c)`.

**`openCrane` (2475-2492):**

1. Selects the crane's make in the sidebar.
2. Calls `viewer.openFile`.
3. Flushes the virtual-scroll queue.
4. Marks the row `.is-active` (but not `aria-current`) and calls `scrollIntoView({block: 'nearest'})`.

It does not close the mobile drawer.

## 7. Deep links (2495-2514)

- The only format is `#crane/<encodeURIComponent(id)>`.
- **Write:** `deepLink.set(id)` is called from `viewer.openFile`. If the hash already matches, nothing happens. Otherwise it sets `suppress = true`, assigns `location.hash` (which **pushes a history entry** for each crane opened), and resets `suppress` on `setTimeout(0)`.
- **Read:** `resolve()` matches `/^#crane\/(.+)$/` and decodes the id. If that crane is already open it does nothing. If the id is in `state.files` it calls `openCrane`. An unknown id is silently ignored.
- `resolve()` runs once after the first `loadFileList`, and on every `hashchange` that isn't suppressed. So Back and Forward move between cranes.
- The hash is never cleared: not by `openEmpty`, not after deleting a crane, and Back to a URL without a hash leaves the viewer as it is.

## 8. Crane actions, merge, export, confirmation dialog

**Confirm dialog (`confirmDialog` 488-519):**

- Elements: `#confirm-modal`, `#confirm-title`, `#confirm-message`, `#confirm-cancel` and `#confirm-ok` (`.btn--danger`).
- Defaults: title "Confirm deletion", button "Delete". Both are restored after each use.
- Returns a Promise of a boolean. Esc counts as cancel.
- Focus starts on **Cancel**.
- `#confirm-message` has no `white-space: pre-line`, so the `\n\n` in the restore message collapses into spaces.

**Delete crane (sidebar trash, 1559-1607):**

1. Confirm: `Delete "<model or name>[ (<capacity>)]"? This cannot be undone.`.
2. Before deleting, work out which row gets focus next: the next row in the same type group, else the previous one, else the next row overall, else the previous one overall.
3. `DELETE /api/delete/<id>`.
4. Toast "Specification deleted". If this crane was open, `openEmpty()`.
5. `loadFileList`, then focus the `.model-item__body` of the chosen row.

On error: toast "Delete failed".

**Edit crane:** the sidebar pencil opens the edit modal (section 4).

**Merge manufacturers** (Settings card, 2606-2626):

- `#merge-from` and `#merge-into` are `<select>`s. Their placeholders are "From…" and "Into…", and they are filled from the facet makes, keeping the current selection where it still exists.
- Validation messages go to `#merge-status` (role=status): "Pick both manufacturers." or "Pick two different manufacturers.".
- Confirm: `Move all "<from>" cranes onto "<into>"? This can't be undone.` with title "Confirm merge" and button "Merge".
- While running, the status reads "Merging…". The call is `POST /api/merge-make {from, into}`.
- On success, the status reads `Merged <moved+absorbed> crane(s) into "<into>".`, a toast says "Manufacturers merged", and `loadFileList` and `refreshFacets` run.
- On error, the status is cleared and a toast says "Merge failed".

**Export:** a plain link `a#settings-export href="/api/export"` reading "Export metadata (JSON)". The server sends `Content-Disposition: attachment; filename="crane_export.json"`.

## 9. Settings panel (`#settings-modal`, 2294-2444)

**Opening** (`#settings-btn`): the modal opens with `#settings-backup-meta` set to "Loading…" and the list and info cleared. It then loads `GET /api/backup` and `GET /api/info` in parallel. On error: "Could not load settings: <msg>".

**Backups card:**

- Badge `#settings-backup-state`: "Automatic" with `.is-on` when `status.enabled`, otherwise "Manual only" with `.is-off`.
- Meta text (`white-space: pre-line`) is `"<every {interval_hours}h, keep {keep} | scheduler off> · <DB + PDFs | DB only> · <last {toLocaleString(latest.modified)} | none yet>\n{status.dir}"`.
- `#settings-backup-now` ("Back up now"): disabled while running. Calls `POST /api/backup`, shows toast "Backup created", and re-renders both cards. On error: "Backup failed".
- `#settings-backup-download` ("Download fresh"): shows toast "Preparing backup" / "Your download will start shortly.", then a hidden-anchor click to `/api/backup/download`.
- `ul#settings-backup-list`: one `li` per backup, containing:
  - `a.settings__backup-name` whose text is the name with `crane-backup-` and `.zip` stripped, title "Download <name>", href `/api/backup/download/<encoded name>`;
  - `span.settings__backup-size` formatted by `fmtBytes` (B/KB/MB/GB; one decimal place when under 10 and not plain bytes);
  - `button.settings__backup-restore` ("Restore", title "Replace the current catalogue with this backup").
  - With no backups: "No backups yet." (`.settings__backups-empty`).
- Restore by name: `POST /api/backup/restore` with JSON `{name}`.
- Restore by upload: `label.settings__restore-upload` wraps a hidden `input#settings-restore-upload` (accept .zip). After a file is picked the value is reset so the same file can be chosen again. The request is a multipart `POST /api/backup/restore` with field `file`.
- Both restore paths share one confirmation: `Restore from <label>?\n\nThis REPLACES all current cranes and files with the contents of the backup. A safety backup of the current state is taken first, so this can be undone. Continue?`, with title **"Confirm restore"** and button "Restore".
  - The label is `"<short name>"` or `the uploaded file "<filename>"`.
  - On success: toast "Catalogue restored" / `N crane(s) restored. Safety backup: <safety_backup>`, then `loadFileList`, `refreshFacets`, and a re-render of the panel.
  - On error: "Restore failed".
  - The viewer is **not** reset if the open crane no longer exists.
- Note: "Restore replaces the whole catalogue…" is static text.

**This instance card:** `dl#settings-info` with rows:

- Version
- Catalogue (`"<cranes> cranes · <files> files"`)
- Database (`paths.database`)
- PDFs (`paths.uploads`)
- Backups (`paths.backups`)
- Max upload (`"<limits.max_upload_mb> MB"`)
- Behind proxy (yes/no from `trust_proxy`)

Each `dd` has a title tooltip. Then the export link and a static note that deployment settings live in compose.

## 10. Keyboard, focus, toasts, loading and accessibility

**Shortcuts** (a `document` keydown handler, 1048-1099; find has its own `window` handler, 2136):

| Key                     | Condition                                          | Action                                                            |
| ----------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| Mod+K                   | not while a modal is open; works from inputs       | palette                                                           |
| Mod+U                   | same                                               | upload modal                                                      |
| Esc                     | —                                                  | close the top modal, else hide the dropzone, else exit fullscreen |
| `?`                     | not in an input; **allowed while a modal is open** | shortcuts modal                                                   |
| ← / →                   | document loaded                                    | previous / next page                                              |
| `+` or `=` / `-` or `_` | document loaded                                    | zoom step                                                         |
| `f` / `F`               | document loaded                                    | fullscreen                                                        |
| Ctrl or Cmd+F           | document loaded                                    | find                                                              |
| `/`                     | document loaded, not in INPUT/TEXTAREA/SELECT      | find                                                              |

- "Mod" is `metaKey` on Mac and `ctrlKey` elsewhere. The find handler accepts either.
- All single-key shortcuts are skipped when the target is INPUT, TEXTAREA or contentEditable, when a modal is open, or when Mod is held. That last rule is why Ctrl+F doesn't also toggle fullscreen.
- **Glyphs:**
  - The server renders `⌘K` or `Ctrl+K` using `is_mac`, a UA regex `/mac|iphone|ipad|ipod/i` (app.py:499,521).
  - `localizeKbds()` (67-75) corrects this client-side. `isMac` uses `navigator.userAgentData.platform`, falling back to `/Mac|iPhone|iPad/` on `navigator.platform` (51-57).
  - For `.kbd[data-mod-key]`, Mac shows `⌘K` and others show `Ctrl+K`. For `.kbd[data-mod]`, it shows `⌘` or `Ctrl`.
- **Shortcuts modal** lists: Find a crane (palette), Mod+K; Upload, Mod+U; Previous page ←; Next page →; Zoom in +; Zoom out −; Fullscreen F; Close / exit Esc; This menu ?. It does not mention Ctrl+F or `/`.

**Modal manager (401-481):**

- Native `showModal()`. If it throws, a danger toast reads "Could not open dialog" / "Your browser may be outdated…".
- An `openSet` tracks open dialogs. `isOpen()` and `closeTop()` close the most recent.
- Initial focus is either the `options.focus` selector or the first focusable element that isn't `.modal__close`.
- Esc (`cancel`) is routed through `close()`.
- A backdrop click closes the dialog only when **both mousedown and mouseup** land on the dialog element itself.
- Any `[data-modal-close="<id>"]` button closes that dialog (2286-2288).

**Toasts (311-372):**

- Variants and default titles: success "Success", danger "Error", warning "Heads up", info "Info". Each has its own icon.
- At most **4**; the oldest is dropped.
- danger toasts get `role=alert` and `aria-live=assertive`; the others get `role=status` and `aria-live=polite`.
- Auto-dismiss after **4500ms**, except danger, which stays until dismissed. Hovering pauses the timer and leaving re-arms it. A click **anywhere on the toast** dismisses it. Removal happens on `animationend` (160ms out).
- The `.toast__close` button has aria-label "Dismiss".
- **Important (DL-024):** a toast is invisible while a `<dialog>` is open, because it renders below the top layer. Many current toasts fire with a dialog still open and so are never seen:
  - the metadata modal's "Missing details" and "No file selected";
  - bulk's "Some rows need attention" and "Some imports failed";
  - all the settings and merge toasts (backup, restore, merge).

  Only the metadata modal's API errors go inline. The React version should keep feedback inside the dialog.

**Loading states:**

- sidebar skeleton rows;
- a viewer skeleton (an A4-ratio shimmer, `#viewer-skeleton`);
- `.btn--loading` (a spinner on the left via `::before`, `pointer-events: none`) with upload percentage text;
- "Loading…" in settings;
- "Importing… x/N" in bulk;
- "Merging…".

**Accessibility worth keeping:**

- `aria-current` on the active make and model;
- `aria-expanded` on the sidebar toggle and type headers;
- `inert` on main while the mobile drawer is open;
- role=search on the search box and find bar, role=toolbar on the toolbar, role=tablist on the strip;
- aria-live on `#find-count` and `#bulk-progress`;
- role=alert on `#modal-error`, role=status on the no-matches banner and merge status;
- aria-labels on every icon button;
- focus restored after list rebuilds and after deletes;
- a `:focus-visible` ring (`--shadow-focus`);
- 44px touch targets at mobile width;
- reduced motion.

## 11. CSRF and error handling

**CSRF:**

- The server sets the cookie `crane_csrf` on any response that lacks it: `SameSite=Strict`, **not HttpOnly**, `Secure` when the request is HTTPS (app.py:134-144).
- The JS reads it with `/(?:^|; )crane_csrf=([^;]+)/` (33-36) and sends the **`X-CSRF-Token`** header on every POST, PUT, PATCH and DELETE, for both fetch and XHR.
- On a mismatch the server replies 403 `{"error": "CSRF token missing or invalid"}`.

**Errors:**

- Every API error is JSON `{error}`. `safeErr(r)` reads `.error` and returns null if parsing fails (304-306).
- Each `api.*` method throws `Error(error || '<fallback>')`. The fallbacks are:

  | Method              | Fallback message           |
  | ------------------- | -------------------------- |
  | listPdfs            | "Failed to load documents" |
  | updateMetadata      | "Update failed"            |
  | remove / deleteFile | "Delete failed"            |
  | setPrimary          | "Could not set main file"  |
  | updateFileLabel     | "Could not rename file"    |
  | backupStatus        | "Could not load backups"   |
  | instanceInfo        | "Could not load info"      |
  | backupNow           | "Backup failed"            |
  | restore             | "Restore failed"           |
  | facets              | "Could not load facets"    |
  | mergeMake           | "Merge failed"             |

- The XHR uploads use `responseType = 'json'` and produce `response.error || "Upload failed (<status>)"`, "Network error during upload" or "Upload aborted". The bulk retry regex depends on these exact strings.
- Callers surface errors as a danger toast titled for the action, or inline `#modal-error` for the metadata modal. A facets failure is ignored silently.

## 12. Subtle points and constraints

- **CSP** (app.py:156-176):
  - `script-src 'self' 'nonce-…'`: no inline scripts or handlers except the nonce'd theme bootstrap.
  - `worker-src 'self'`: the PDF.js worker must be a same-origin file, so no blob workers.
  - `style-src 'self' 'unsafe-inline' fonts.googleapis`: needed for the canvas size and the % highlight positions.
  - `font-src` allows gstatic. `img-src 'self' data:` covers the favicon data URL.
  - `connect-src 'self'`: PDFs must be fetched from the same origin.
  - Also `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`.
  - A React or Vite build must not inject inline scripts, and any inline bootstrap needs the nonce.
- **Cache busting:** `?v=<md5[:8]>` on main.js and main.css only. PDF.js is unversioned.
- **localStorage:** only `crane.theme`, wrapped in try/catch. There is no sessionStorage and no other stored state.
- **Timings:**

  | What                                | Value        |
  | ----------------------------------- | ------------ |
  | find debounce                       | 180ms        |
  | resize re-render debounce           | 120ms        |
  | dropzone watchdog                   | 700ms        |
  | toast auto-dismiss                  | 4500ms       |
  | anchor removal after download click | 150ms        |
  | bulk retry backoff                  | 1200·n ms    |
  | deep-link suppress reset            | setTimeout 0 |
  | IntersectionObserver rootMargin     | 200px        |

- **Stale-work tokens:** `openToken` (loading a PDF), `renderToken` (rendering a page), `findToken` (scanning), `submitToken` (restoring the submit label).
- **Lifecycle:** `pdfDoc.destroy()` is called before each new load and on `openEmpty`.
- `state.files` items carry `name` (equal to `id`, used for `data-filename`), `url` (the primary file's URL), `file_count`, and `files[]` with `id, stored_name, original_filename, label, is_primary, url`. Files are served at `/uploads/<crane_id>/<stored_name>`.
- Sidebar rows key on `data-filename = crane.name`, and the tests rely on this.
- After a set-primary, delete-file or label edit, the sidebar reloads in the background without being awaited.
- The QA checklist (`QA-CHECKLIST.md`) is slightly out of date. It says Ctrl+K "focuses the search input" (it now opens the palette), "zoom in 25% steps" (it uses the step list), and "inline 'all four fields required' warning" (it is actually a toast hidden behind the dialog).

## E2E tests (`tests/e2e/test_e2e.py`, 24 tests)

**Fixtures:**

- A session-scoped live Flask server and a fresh page per test.
- Seeding helpers call `fetch` inside the page with the `crane_csrf` cookie as `X-CSRF-Token`: `_api_upload` (fields `make, type, model, capacity`, filename `test.pdf`) and `_api_add_file` (`label`).
- The virtual-scroll test inserts rows directly into SQLite.
- The database accumulates across the whole session, so tests use unique make names.

1. **App loads** (`test_app_loads_and_shows_expected_ui`): title is exactly "Crane Charts"; `#upload-trigger` is visible; `#confirm-modal` is attached.
2. **Health** (`test_health_endpoint_returns_ok`): `/health` returns `status: ok` **and an `uploads` key**. This is API-level, and the platform's `/health` drops `uploads`, so the test needs updating.
3. **Version** (`test_version_label_and_endpoint`): `.app-bar__version` text equals the version from `/version`.
4. **Duplicate upload** (`test_duplicate_upload_shows_inline_error`): uses `#upload-trigger`, `#metadata-modal`, `#file-input`, `#make-input`, `#type-input`, `#model-input`, `#capacity-input` and `#form-submit-btn`. Expects `#modal-error` to be visible and to contain "exist", with the modal still visible.
5. **Drop onto the picker** (`test_drop_pdf_on_picker_sets_and_prefills`): dispatches a `DragEvent('drop')` on `#file-field`. Expects `#file-picker-text` to read "Grove GMK5150 (Load Chart).pdf", `#make-input` "Grove" and `#model-input` "GMK5150".
6. **Upload through the picker** (`test_upload_via_ui_file_picker`): the modal hides and `.make-item` becomes visible.
7. **API upload appears in sidebar** (`test_api_upload_appears_in_sidebar`): `.make-item` filtered by text "Tadano".
8. **Edit** (`test_edit_metadata_via_action_button`): `.make-item` filtered by text, then `.model-item__action--edit`, then `#capacity-input` clear and fill, then submit; the modal hides.
9. **Delete crane** (`test_delete_file_via_action_button`): `.model-item[data-filename="<name>"]`, then `.model-item__action--delete`, `#confirm-modal`, `#confirm-ok`; the row is detached and gone from `/api/pdfs`.
10. **Virtual scroll** (`test_large_make_renders_incrementally`): 75 cranes under one make. The first render must show more than 0 and fewer than 75 `.model-item` rows. Scrolling `#model-list` to `scrollHeight` must eventually give 75.
11. **Strip switch and primary** (`test_file_strip_switch_and_set_primary`): `.model-item__filecount` reads "2"; `.model-item__body` click; `#file-strip` visible; 2 `.file-chip`; filter by "Outrigger chart", then `.file-chip__action--primary`; the chip gets class `is-primary`.
12. **Delete a supplementary file** (`test_delete_supplementary_file_keeps_crane`): `.file-chip__action--delete`, then confirm; one `.file-chip` remains.
13. **Rename a label** (`test_rename_file_label`): `.file-chip__action--edit`, `#label-input`, `#form-submit-btn`; the chip's text updates.
14. **Find** (`test_in_pdf_find_highlights_and_navigates`): `#pdf-canvas` visible; `#page-total` reads "1"; `#find-btn`; `#find-bar`; `#find-input` "250t"; `#find-count` "1/2"; 2 `.pdf-highlight`; 1 `.pdf-highlight.is-current`; `#find-next` gives "2/2"; a miss gives "0/0" and no highlights. The test PDF has one text item per line.
15. **Bulk** (`test_bulk_import_groups_and_creates_cranes`):
    - picks 3 files with `#file-input` from the upload modal; `#bulk-modal` appears; `#bulk-summary` contains "3 files" and "2 cranes";
    - `.bulk__row:not(.bulk__row--head)` count is 2; `.bulk__input[aria-label="make"]` reads "Liebherr";
    - `#bulk-fill-type` and `#bulk-fill-type-apply`; `input[aria-label="capacity"]`;
    - the row filtered by "Outrigger", its `.bulk__file`, then `input[type=radio]`; `#bulk-submit`; the modal hides;
    - server-side: crane ids `liebherr_mobile_ltm1100_100t` and `tadano_mobile_ac100_100t`, with the primary label "Outrigger".
16. **Type collapse** (`test_type_group_collapses`): `.type-group` filtered by text, then `.type-header` click; the group gets class `is-collapsed` and its row is hidden; a second click shows it again.
17. **Search keeps makes** (`test_search_keeps_makes_with_matching_models`): `#search-input` "500t" leaves the matching makes visible and the others hidden.
18. **Search jumps to a make** (`test_search_make_name_jumps_and_shows_its_models`): the make gets class `is-active`, the other make is hidden, and the `.model-item` "JB1" is visible.
19. **Natural sort** (`test_models_sort_naturally_not_lexicographically`): the first line of each `.model-item` `inner_text` reads LTM1300-6.2, LTM1750-9.1, LTM11200-9.1 in that order. The capacity must therefore not share the first line of the name's innerText.
20. **Settings backups** (`test_settings_backup_flow_and_info`): `#settings-btn`; `#settings-modal`; `#settings-info` contains "Version" and "Database"; `#settings-backup-now`; one `.settings__backup-name`; clicking it downloads a `.zip`; `#settings-backup-download` downloads a `.zip`.
21. **Restore** (`test_restore_reverts_post_backup_changes`): `.settings__backup-restore`; `#confirm-title` reads exactly "Confirm restore"; `#confirm-ok`; then `.make-item[data-make="…"]` counts update live **while the settings modal is still open**.
22. **Palette** (`test_command_palette_jump_and_capacity`): `Control+k`; `#palette-modal`; `#palette-input`; `.palette__result` count is 1; `>=800` filter; Enter closes the modal and the URL matches `#crane/zpalette_mobile_zzhigh900_900t`.
23. **Deep link** (`test_deep_link_opens_crane_on_load`): a fresh load of `/#crane/<id>`; the row has class `is-active`; `#info-model` reads "DL1".
24. **Merge** (`test_merge_manufacturers`): `#merge-from` and `#merge-into` via `select_option` (the option value equals the make name), `#merge-btn`, `#confirm-modal`, `#confirm-ok`; `#merge-status` contains "Merged".

## Riskiest parts to rebuild

1. **Find highlight geometry.** The transform composition, whole-item boxes, % positioning against a canvas that CSS may shrink, redraws after async page renders, and the scan tokens and cache. The tests check exact counts and the "1/2", "0/0" text.
2. **Sidebar filter semantics with virtual scroll.** Make search text that includes labels, the jump-to-make rule (name match preferred, `_jumping` guard), the make name folded into row haystacks, force-expanding collapsed groups, flushing the queue before filtering, and the no-matches banner. A React virtualised list would also break the test that expects a partial first batch of more than 0 and fewer than 75 rows, and assumptions about `.model-item` being in the DOM.
3. **Native `<dialog>` and top-layer behaviour.** Toasts hidden behind dialogs, the mousedown+mouseup backdrop rule, Esc routing between our keydown handler and the native cancel, initial-focus rules, the confirm dialog's promise and default resets, and `?` working inside modals. Many current toasts are effectively invisible, so decide deliberately whether to fix that.
4. **Stale-async guards.** `openToken`, `renderToken`, `findToken` and `submitToken`, and PDF.js document destroy on every switch. React effects need equivalent cancellation, or rapid clicks will render the wrong document.
5. **Drag-and-drop routing.** The window counter plus 700ms watchdog, file-drag detection, ignoring drops while a modal is open, the picker drop target that stops propagation, and routing by file count and open crane (bulk, addfile, upload).
6. **Bulk import edge cases.** Grouping, sequential upload, 429 retry that depends on error-message text, and partial-failure retry, which today can 409 on re-upload.
7. **CSP compatibility.** Nonce-only scripts, a same-origin module worker (`worker-src 'self'`), the inline theme bootstrap, and Vite's dev and production output.
8. **Deep-link and history behaviour.** It pushes an entry per crane, uses the suppress flag, resolves after the paged list finishes loading, and never clears the hash.
9. **Zoom and fit maths.** Fit page or width from the well's padding, snapping to the step list, the readout cycle, debounced re-fit on resize but not in custom mode, `dpr` capped at 3, and the CSS `max-width: 100%` cap on displayed size.
10. **Small fixes worth making while porting:** the undefined CSS tokens; `#confirm-message` needing `pre-line`; drawer and scrim state when crossing 900px; the possibly dead "PDF viewer failed to load" path; the unused `Octocat.png`; and the `/health` `uploads` assertion in e2e test 2.
