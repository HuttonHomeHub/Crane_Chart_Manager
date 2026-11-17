// Applies a remembered theme pick before first paint. Load it as a blocking,
// same-origin script in <head> (allowed by script-src 'self', no inline script).
// Apps use hhhThemeInit() from @hhh/config/vite, which serves, emits and adds it as
//   <script src="/theme-init.js"></script>
// Keep in step with src/theme.ts (THEME_STORAGE_KEY).
(function () {
  try {
    var t = localStorage.getItem('hhh.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch {
    // storage blocked: the page follows the system setting
  }
})();
