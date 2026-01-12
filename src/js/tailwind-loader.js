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
      // For Electron with file://, find public_html or src root
      // Example: /Users/.../public_html/admin/users.html -> ../css/tailwind.js
      // Example: /Users/.../public_html/index.html -> css/tailwind.js

      const publicHtmlIndex = currentPath.indexOf('public_html/');
      const srcIndex = currentPath.indexOf('/src/');

      let baseIndex = -1;
      let baseLength = 0;

      if (publicHtmlIndex !== -1) {
        baseIndex = publicHtmlIndex;
        baseLength = 'public_html/'.length;
      } else if (srcIndex !== -1) {
        baseIndex = srcIndex;
        baseLength = '/src/'.length;
      }

      if (baseIndex !== -1) {
        // Get path after base directory
        const afterBase = currentPath.substring(baseIndex + baseLength);
        // Remove the filename (last segment)
        const pathWithoutFile = afterBase.substring(0, afterBase.lastIndexOf('/'));
        // Count directory depth
        const depth = pathWithoutFile ? pathWithoutFile.split('/').length : 0;
        // Build relative path (add ./ prefix for Electron to ensure relative resolution)
        return (depth > 0 ? '../'.repeat(depth) : './') + LOCAL_URL;
      }

      // Fallback: assume we're in root
      return './' + LOCAL_URL;
    }

    // For web browser, count directories from root (excluding filename)
    // Example: /admin/users.html -> depth 1 -> ../css/tailwind.js
    // Example: /index.html -> depth 0 -> ./css/tailwind.js
    const pathParts = currentPath.split('/').filter(p => p); // Remove empty strings
    const depth = Math.max(0, pathParts.length - 1); // Subtract 1 for the filename

    // Build relative path (add ./ prefix to ensure relative resolution)
    return (depth > 0 ? '../'.repeat(depth) : './') + LOCAL_URL;
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
