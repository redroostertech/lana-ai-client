/**
 * Preloader Dismissal Shim
 *
 * Handles the transition from the inline HTML preloader to page content.
 * Tailwind CSS is now loaded via a static <link> tag — no runtime compilation.
 */
(function() {
  const MIN_LOADING_TIME = 300;
  const loadStartTime = Date.now();

  // FOUC prevention (matches the inline preloader)
  const foucStyle = document.createElement('style');
  foucStyle.id = 'fouc-prevention';
  foucStyle.textContent = '#lex-main-content { opacity: 0; } #lex-main-content.ready { opacity: 1; transition: opacity 0.3s ease-in; }';
  document.head.appendChild(foucStyle);

  function showContent() {
    const elapsed = Date.now() - loadStartTime;
    const remaining = Math.max(0, MIN_LOADING_TIME - elapsed);

    setTimeout(() => {
      requestAnimationFrame(() => {
        const preloader = document.getElementById('lana-preloader');
        if (preloader) {
          preloader.style.opacity = '0';
          setTimeout(() => preloader.remove(), 300);
        }

        const appContent = document.getElementById('lex-main-content') || document.getElementById('app-content');
        if (appContent) {
          appContent.classList.add('ready');
        } else {
          document.body.style.opacity = '1';
        }
      });
    }, remaining);
  }

  // Show content once the DOM is ready (CSS is already loaded via <link>)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showContent);
  } else {
    showContent();
  }
})();
