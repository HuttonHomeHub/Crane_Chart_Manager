# Manual QA checklist

Run this in a real browser after substantial changes. The pytest + Playwright suites cover a
lot; this list covers the rest of the rendered-UI flows. Time: ~8 minutes for a full pass.

**Setup**: `make dev`, open `http://localhost:5000/`, have a few small PDFs handy (name a
couple `Liebherr LTM1100 (Load Chart).pdf` / `Liebherr LTM1100 (Outrigger).pdf` to exercise
the filename convention).

---

## 1 · First paint
- [ ] Page loads with the persisted theme (dark by default). No flash of wrong theme.
- [ ] Brand reads `Crane Charts` with the amber crane icon and a **version badge** (e.g. `dev`).
- [ ] DevTools → Network: `main.js`/`main.css` load with a `?v=<hash>` query; `pdf.min.mjs`
      and `pdf.worker.min.mjs` load from `/static/vendor/…` (self-hosted, not a CDN).
- [ ] DevTools → Console: no errors, no CSP violations.
- [ ] DevTools → Application → Cookies: `crane_csrf` exists, `SameSite=Strict`.

## 2 · Theme toggle
- [ ] Sun/moon icon swaps theme smoothly (bg + text transition together). Reload — persists.
- [ ] On Windows/Linux the kbd chips read `Ctrl+K` / `Ctrl+U` at first paint (no Mac-glyph flash).

## 3 · Sidebar
- [ ] Hover/click a make — amber active state; models populate, grouped by type.
- [ ] A crane with more than one file shows a small **file-count badge** on its row.
- [ ] Hover a model row — pencil + trash actions fade in. Truncated names show a tooltip.
- [ ] Click a model — info bar + file strip populate, primary PDF renders.
- [ ] Large catalogue: scrolling the model list keeps loading rows (virtual scroll); search
      still finds rows that haven't scrolled into view.

## 4 · Search (sidebar)
- [ ] Typing filters both columns live; no-match shows the `No matches for "…"` banner;
      clearing restores. `⌘/Ctrl+K` focuses the search input.

## 5 · Upload — single file
- [ ] Click `Upload` → modal opens, focus on the file picker.
- [ ] **Drag a PDF onto the "Click to choose a PDF" box** — it highlights and accepts the
      drop; make/model prefill from the filename.
- [ ] Submit with a field empty → inline "all four fields required" warning; focus the field.
- [ ] Fill + submit → `Uploading… N%` → modal closes → success toast → sidebar refreshes.
- [ ] Upload a file whose make/type/model/capacity already exist → **inline error inside the
      dialog** ("…already exists"); modal stays open (error is NOT a hidden toast behind it).

## 6 · Upload — drag & drop
- [ ] Drag one PDF over the window (nothing open) → dropzone overlay → drops into the upload
      modal, prefilled from the filename.
- [ ] With a crane open, drop one PDF → the modal offers to **add it to that crane** (titled
      with the crane), with a "Create a new crane instead" link.
- [ ] Drag a non-PDF → warning toast `PDF only`.

## 7 · Bulk import
- [ ] Drop **2+ PDFs** at once (or multi-select in the upload picker) → the bulk grid opens.
- [ ] Header reads `N files → M cranes`; files sharing `Manufacturer Model` group into one
      row (e.g. the two `Liebherr LTM1100 (...)` files → one crane, two files).
- [ ] Manufacturer/Model/file-labels are prefilled from the filenames.
- [ ] `Set all types` → `Apply to all` fills the Type column; fill Capacity per row.
- [ ] A multi-file row shows a radio per file — pick which is the main one.
- [ ] `Import` → per-row ✓ appears; on success the modal closes and the sidebar shows the new
      cranes (the grouped one carries a file-count badge and the chosen primary).
- [ ] Leave a row's Type/Capacity blank and Import → that row is flagged; fix and `Retry`.

## 8 · Multi-file (file strip)
- [ ] Open a crane with 2+ files → the strip shows a chip per file; the primary has the star.
- [ ] Click a chip → that file renders in the viewer.
- [ ] Click the star on a non-primary chip → it becomes the main file (opens by default next time).
- [ ] Click the pencil on a chip → rename its label; the chip updates.
- [ ] `Add file` → attach a supplementary PDF (with a label). It appears in the strip.
- [ ] Delete a non-primary file → chip removed, crane stays. Delete the **last** file → confirm
      dialog warns it removes the whole crane.

## 9 · In-PDF find
- [ ] `Ctrl/Cmd+F` (or `/`, or the toolbar magnifier) opens the find bar; focus in the input.
- [ ] Type a term present in the open chart → count shows `X/Y`; matches highlight in amber;
      the current one is outlined and scrolled into view.
- [ ] `Enter` / `Shift+Enter` (or the arrows) step through matches; the count updates.
- [ ] A term with no matches → `0/0`, highlights cleared. `Esc` closes the bar.
- [ ] Switch to a different file in the strip while find is open → it re-runs on the new doc.

## 10 · Edit & delete crane
- [ ] Pencil on a row → edit modal, four fields prefilled. Change Capacity, save → `Saved`.
- [ ] Edit a field that changes the slug → `Saved & renamed`; the crane's directory renames and
      the viewer reloads with the new URLs. Colliding with an existing crane → inline error.
- [ ] Trash on a row → confirm dialog; confirm → toast; focus moves to a sensible sibling row.

## 11 · Viewer controls
- [ ] `←`/`→` page (disable at ends); page-input + Enter jumps; `+`/`−` zoom in 25% steps.
- [ ] Zoom readout cycles `fit-page → fit-width → 100%`. `F` fullscreens the whole page;
      `Esc`/`F` exits. **`Ctrl+F` opens find and does NOT also toggle fullscreen.**
- [ ] Download button downloads the **currently-displayed** file (original filename).
- [ ] Resize window → PDF re-fits after a brief debounce.

## 12 · Keyboard, modals, mobile, a11y
- [ ] `?` opens shortcuts (even from inside a modal). Inside a modal, viewer keys don't leak through.
- [ ] `Esc` closes the topmost modal, then the dropzone, then fullscreen.
- [ ] Modal backdrop click closes; mousedown-inside-drag-out does not close.
- [ ] Mobile (375×812): hamburger drawer over a scrim; picking a model closes it; focus stays
      trapped; search overlay works; toolbar trims controls below 520px.
- [ ] Tab order is logical; focus rings visible; reduced-motion disables slide animations.

## 13 · Persistence & deploy
- [ ] Hard-refresh — cranes/files survive, metadata intact, theme applied.
- [ ] Stop/restart the server, reload — same.
- [ ] Corrupt `crane.db` (write garbage bytes), reload `/api/pdfs` → empty catalogue, no 500;
      the next successful write recovers.
- [ ] `GET /version` and the app-bar badge agree. After a code change to `main.js`, a normal
      reload serves the new file (the `?v=` hash changed) — no hard-refresh needed.

## 14 · Failure modes
- [ ] Disable JavaScript → reload → centered `Crane Charts requires JavaScript` message.
- [ ] Block `pdf.min.mjs` → reload → `PDF viewer failed to load` empty state.
- [ ] Kill the network mid-upload → `Network error during upload`; modal stays open.
- [ ] Upload a >500 MB file → `File too large. Maximum upload size is 500 MB.`

---

## Sign-off

| Date | Operator | Version | Notes |
|------|----------|---------|-------|
|      |          |         |       |
