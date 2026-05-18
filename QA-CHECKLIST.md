# Manual QA checklist

Run this in a real browser after substantial changes. The pytest suite covers the
backend; this list covers the flows that only manifest in the rendered UI.

Time: ~5 minutes for the full pass.

**Setup**: `flask --debug run`, open `http://localhost:5000/`, have a tiny PDF handy
on the desktop for drag-drop steps.

---

## 1 · First paint
- [ ] Page loads with **dark theme** (or whichever was last persisted in `localStorage`).
      No flash of wrong theme on reload.
- [ ] Brand reads `Crane Charts` with the construction-crane icon in amber.
- [ ] Sidebar populated with seeded makes; first make auto-selected; models listed.
- [ ] No `/favicon.ico` 404 in the dev-server console (the SVG data-URL favicon is used).
- [ ] DevTools → Network: no failed requests. `pdf.min.mjs` and `pdf.worker.min.mjs`
      show as `(prefetch cache)` or `200`.
- [ ] DevTools → Console: no errors, no CSP violations.
- [ ] DevTools → Application → Cookies: `crane_csrf` exists, `SameSite=Strict`.

## 2 · Theme toggle
- [ ] Click the sun/moon icon — theme swaps smoothly (body bg + text transition,
      app-bar/sidebar/viewer all fade together, no snapping).
- [ ] Reload — theme persists.
- [ ] On Windows / Linux the kbd chips read `Ctrl+K` / `Ctrl+U` at first paint
      (server-side detection, no Mac-glyph flash).

## 3 · Sidebar interaction
- [ ] Hover a make — amber muted background appears.
- [ ] Click a make — left-edge amber stripe appears (`aria-current="true"`); models
      below populate, grouped by type with the type header carrying an amber border-left.
- [ ] Hover a model row — pencil + trash icons fade in on the right.
- [ ] Hover a model name truncated by ellipsis — tooltip shows the full label.
- [ ] Click a model — info bar populates, PDF renders.
- [ ] Tab through the sidebar — focus rings are amber, never disappear off-screen.

## 4 · Search
- [ ] Type in the search bar — both columns filter live.
- [ ] Type something with no matches (e.g. `xxxxxxxx`) — both columns show the banner
      `No matches for "xxxxxxxx"`.
- [ ] Clear the field — banner removed, full list restored.
- [ ] `⌘/Ctrl + K` focuses and selects the search input.

## 5 · Upload (button path)
- [ ] Click `Upload` in the app bar — modal opens centred; focus lands on the file
      picker (not the X button).
- [ ] Click the file picker — OS file dialog opens; pick a PDF; picker text becomes
      the filename (truncated with ellipsis if very long).
- [ ] Submit with one field empty — toast `Missing details`; focus moves to the
      first empty input.
- [ ] Fill all fields, submit — submit button shows `Uploading… N%`, then `Saving…`,
      then modal closes, success toast top-right, sidebar refreshes with the new entry.

## 6 · Upload (drag-drop)
- [ ] Drag a PDF over the window — dropzone overlay shows with dashed amber card.
- [ ] Drag a non-PDF — drop triggers a warning toast `PDF only`.
- [ ] Drag two PDFs at once — drop triggers `Single file only`.
- [ ] Drag a PDF onto the modal (when open) — warning toast
      `Close the open dialog first`. Edit form is NOT wiped.

## 7 · Edit
- [ ] Click the pencil on any row — modal opens in edit mode with four fields
      pre-filled; title reads `Edit specification`; submit button reads
      `Save changes`; focus lands on Manufacturer.
- [ ] Change Capacity (only), submit — toast `Saved`. Sidebar refreshes; row stays
      in the same type group with new capacity shown.
- [ ] Open a record, edit Type (renames the file) — toast `Saved & renamed`. Row
      moves to a new type group. The viewer reloads with the new URL automatically.
- [ ] Try to rename a row to match another existing record — toast
      `A specification with these details already exists`. Modal stays open.

## 8 · Delete
- [ ] Click trash on a row — native confirm; cancel keeps the row.
- [ ] Confirm — toast `Specification deleted`. Focus moves to the **next** sibling
      row in the same type group (or previous if it was the last; or another group's
      row if the group emptied). NOT to body.
- [ ] Delete the currently-viewed PDF — viewer drops to empty state, info bar hides.

## 9 · Viewer controls
- [ ] `←` / `→` step pages. Buttons disable at the first/last page.
- [ ] Type a number into the page input + Enter — jumps to that page.
- [ ] `+ / −` zoom; readout updates in 25% steps.
- [ ] Click the zoom readout — cycles `fit-page → fit-width → 100%`.
- [ ] `F` enters fullscreen on the *whole page* (app bar + toolbar still visible).
      Press `Esc` or `F` to exit.
- [ ] Download button — file downloads with the `original_filename` if present.
- [ ] Resize the window — PDF re-fits after a brief debounce (no jitter).

## 10 · Keyboard shortcuts
- [ ] `?` opens the shortcuts modal from the main UI.
- [ ] Inside a modal, `?` *also* opens the shortcuts overlay on top.
- [ ] Inside a modal, `←/→/+/-/F` do **not** affect the viewer behind.
- [ ] `Esc` closes the topmost modal first; if no modal, closes the dropzone overlay;
      if no overlay, exits fullscreen.

## 11 · Modal behaviour
- [ ] Click on the backdrop (outside the panel) — modal closes.
- [ ] Mousedown inside the panel, drag onto the backdrop, release — modal does *not*
      close (drag-out protection).
- [ ] Mousedown on the backdrop, drag into the panel, release — modal does *not*
      close either.
- [ ] Tab from the last focusable inside the modal — wraps to the first. Tab never
      escapes to the page behind.

## 12 · Mobile / responsive (Chrome DevTools 375×812)
- [ ] App bar collapses: brand text hidden, search hidden, hamburger appears.
- [ ] Tap hamburger — sidebar slides in from the left over a scrim.
- [ ] Tab key — focus stays inside the drawer (page behind is `inert`).
- [ ] Pick a model — drawer auto-closes, PDF renders full width.
- [ ] Tap the search icon in the app bar — search input slides down as an overlay
      below the bar. Tap Esc or empty the field + tap away — overlay hides.
- [ ] Toolbar pill: `fit-width`, `fit-page`, `fullscreen` are hidden below 520 px.
      Remaining buttons are ~40 px tall (tappable).
- [ ] Long-press a model row — no native text-selection menu appears.
- [ ] Pencil + trash icons are always visible on touch (no hover required).

## 13 · Accessibility spot-check
- [ ] Tab from the top of the page — every interactive element is reachable in
      visual order: hamburger → brand → search → search-toggle → theme → help →
      Upload → make items → model rows → toolbar → modal-open path.
- [ ] All focus rings are visible (amber shadow ring around the focused control).
- [ ] OS-level prefers-reduced-motion → toast slide and modal slide-up disable;
      skeleton goes static at 50% opacity.
- [ ] Toggle to high-contrast / forced-colors mode in OS — text stays legible,
      focus rings still visible.

## 14 · Persistence
- [ ] Hard-refresh (Ctrl+Shift+R) — uploaded files survive, metadata intact, theme
      still applied.
- [ ] Stop the server, restart, reload — same.
- [ ] Edit `metadata.json` to invalid JSON (e.g. `garbage`), reload `/api/pdfs` —
      sidebar shows seeded files with default names but no metadata fields. The
      next successful save rewrites the file.

## 15 · No-JS / failure modes
- [ ] DevTools → Settings → Disable JavaScript — reload. Centered black message:
      `Crane Charts requires JavaScript`.
- [ ] DevTools → Network → block `pdf.min.mjs`. Reload. Viewer empty state replaced
      with `PDF viewer failed to load` + alert-triangle icon.
- [ ] Pull the network cable mid-upload — toast `Network error during upload`;
      submit button restores; modal stays open.
- [ ] Upload a 600 MB file — toast `File too large. Maximum upload size is 500 MB.`
      (not a generic "Upload failed (413)").

---

## Sign-off

| Date       | Operator | Notes |
|------------|----------|-------|
|            |          |       |
