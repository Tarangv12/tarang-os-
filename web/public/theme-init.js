/**
 * Applies the saved theme before React mounts so there is no flash of the wrong
 * background on load.
 *
 * This lives in its own file rather than inline in index.html so the app can
 * keep a strict `script-src 'self'` Content Security Policy — no 'unsafe-inline'
 * and no hash to keep in sync.
 */
(function () {
  try {
    var mode = localStorage.getItem('tarangos.theme') || 'system';
    var accent = localStorage.getItem('tarangos.accent') || 'indigo';
    var reduceMotion = localStorage.getItem('tarangos.reduceMotion') === 'true';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    var root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.classList.toggle('reduce-motion', reduceMotion);
    root.setAttribute('data-accent', accent);
    root.style.colorScheme = dark ? 'dark' : 'light';

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#12141b' : '#f7f8fc');
  } catch (e) {
    /* storage unavailable — the app applies the theme after mount instead */
  }
})();
