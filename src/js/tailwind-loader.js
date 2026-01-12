/**
 * Tailwind CSS Loader - Local First Strategy
 *
 * Loads local Tailwind CSS by default for reliability in customer networks.
 * Many customer firewalls/networks block CDN access.
 * Prevents FOUC by working with inline HTML preloader.
 */
(function() {
  const LOCAL_URL = 'css/tailwind.js'; // Local copy (relative to public_html)
  const CDN_URL = 'https://cdn.tailwindcss.com'; // CDN fallback only if local fails
  const MIN_LOADING_TIME = 3000; // Minimum 3 seconds to show loading screen
  const PREFER_LOCAL = true; // Always prefer local for customer deployments

  // Track when loading started
  const loadStartTime = Date.now();

  // Add FOUC prevention style (hide page content until ready)
  const foucStyle = document.createElement('style');
  foucStyle.id = 'fouc-prevention';
  foucStyle.textContent = `
    /* Hide page content until CSS loads */
    #app-content { opacity: 0; }
    #app-content.ready { opacity: 1; transition: opacity 0.3s ease-in; }
  `;
  document.head.appendChild(foucStyle);

  // Function to hide preloader and show page content when CSS is ready
  function showContent() {
    const elapsed = Date.now() - loadStartTime;
    const remainingTime = Math.max(0, MIN_LOADING_TIME - elapsed);

    // Ensure preloader shows for minimum time
    setTimeout(() => {
      requestAnimationFrame(() => {
        // Hide the HTML preloader
        const preloader = document.getElementById('lana-preloader');
        if (preloader) {
          preloader.style.opacity = '0';
          setTimeout(() => {
            preloader.style.display = 'none';
            preloader.remove();
          }, 300);
        }

        // Show the main content
        const appContent = document.getElementById('app-content');
        if (appContent) {
          appContent.classList.add('ready');
        } else {
          // Fallback: show body if no app-content wrapper
          document.body.style.opacity = '1';
        }

        console.log('[TailwindLoader] Content displayed after', Date.now() - loadStartTime, 'ms');
      });
    }, remainingTime);
  }

  // Check if Tailwind is already loaded
  if (window.tailwind) {
    console.log('[TailwindLoader] Tailwind already loaded');
    showContent();
    return;
  }

  function loadScript(src, onSuccess, onError) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = onSuccess;
    script.onerror = onError;
    document.head.appendChild(script);
    return script;
  }

  function determineLocalPath() {
    const currentPath = window.location.pathname;
    const isElectron = window.location.protocol === 'file:';

    if (isElectron) {
      // For Electron with file://, find public_html root and calculate relative path
      // Example: /Users/.../public_html/admin/users.html -> ../css/tailwind.js
      // Example: /Users/.../public_html/index.html -> css/tailwind.js

      // Count directory depth from public_html
      const publicHtmlIndex = currentPath.indexOf('public_html');
      if (publicHtmlIndex === -1) {
        // Fallback: just use relative path based on slashes after filename
        const pathParts = currentPath.split('/').filter(p => p && !p.endsWith('.html'));
        const depth = pathParts.length;
        return (depth > 0 ? '../'.repeat(depth) : '') + LOCAL_URL;
      }

      // Get path after public_html/
      const afterPublicHtml = currentPath.substring(publicHtmlIndex + 'public_html/'.length);
      const segments = afterPublicHtml.split('/').filter(p => p && !p.endsWith('.html'));
      const depth = segments.length;

      // Build relative path
      return (depth > 0 ? '../'.repeat(depth) : '') + LOCAL_URL;
    }

    // For web browser, use relative path
    const pathParts = currentPath.split('/').filter(p => p && !p.endsWith('.html'));
    const depth = pathParts.length;

    // Build relative path to css/tailwind.js from current page
    let basePath = depth > 0 ? '../'.repeat(depth) : '';
    return basePath + LOCAL_URL;
  }

  function loadLocal() {
    const localPath = determineLocalPath();
    console.log('[TailwindLoader] Loading local Tailwind from:', localPath);

    loadScript(localPath,
      () => {
        console.log('[TailwindLoader] Local Tailwind loaded successfully');
        showContent();
      },
      () => {
        console.error('[TailwindLoader] Local Tailwind failed, trying CDN fallback...');
        loadCDN();
      }
    );
  }

  function loadCDN() {
    console.log('[TailwindLoader] Loading CDN Tailwind...');

    loadScript(CDN_URL,
      () => {
        console.log('[TailwindLoader] CDN Tailwind loaded successfully');
        showContent();
      },
      () => {
        console.error('[TailwindLoader] CDN also failed - showing content unstyled');
        showContent(); // Show content anyway to prevent permanent blank screen
      }
    );
  }

  // PREFER LOCAL FIRST (better for customer networks with firewalls)
  if (PREFER_LOCAL) {
    loadLocal();
  } else {
    loadCDN();
  }

  // Safety net: Show content after 8 seconds regardless
  setTimeout(() => {
    const appContent = document.getElementById('app-content');
    const preloader = document.getElementById('lana-preloader');
    if (preloader && preloader.style.display !== 'none') {
      console.warn('[TailwindLoader] Safety timeout - showing content');
      showContent();
    }
  }, 8000);
})();
