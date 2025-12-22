/**
 * Tailwind CSS Loader with CDN + Local Fallback
 *
 * Tries to load Tailwind CSS from CDN first for faster loading.
 * Falls back to local copy if CDN is unreachable (e.g., offline, firewall).
 * Prevents FOUC by hiding body until CSS is ready.
 */
(function() {
  const CDN_URL = 'https://cdn.tailwindcss.com';
  const LOCAL_URL = 'js/../css/tailwind.js'; // Relative to HTML file location
  const TIMEOUT_MS = 3000; // 3 second timeout for CDN

  // Add FOUC prevention styles immediately
  const foucStyle = document.createElement('style');
  foucStyle.id = 'fouc-prevention';
  foucStyle.textContent = `
    body { opacity: 0; transition: opacity 0.1s ease-in; }
    body.css-loaded { opacity: 1; }
  `;
  document.head.appendChild(foucStyle);

  // Function to show body when CSS is ready
  function showBody() {
    // Wait a tiny bit for Tailwind to process
    requestAnimationFrame(() => {
      document.body.classList.add('css-loaded');
    });
  }

  // Check if Tailwind is already loaded
  if (window.tailwind) {
    console.log('[TailwindLoader] Tailwind already loaded');
    showBody();
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

  function loadLocalFallback() {
    console.log('[TailwindLoader] Loading local fallback...');

    // Determine the correct path based on current page location
    const currentPath = window.location.pathname;
    let basePath = '';

    // Count directory depth from public_html root
    const pathParts = currentPath.split('/').filter(p => p && !p.endsWith('.html'));
    const depth = pathParts.length;

    // Build relative path to css/tailwind.js
    if (depth > 0) {
      basePath = '../'.repeat(depth);
    }

    const localPath = basePath + 'css/tailwind.js';

    loadScript(localPath,
      () => {
        console.log('[TailwindLoader] Local Tailwind loaded successfully');
        showBody();
      },
      () => {
        console.error('[TailwindLoader] Failed to load local Tailwind from:', localPath);
        showBody(); // Show body anyway to prevent permanent blank screen
      }
    );
  }

  // Try CDN first with timeout
  let cdnLoaded = false;
  let timeoutFired = false;

  const cdnScript = loadScript(CDN_URL,
    () => {
      if (!timeoutFired) {
        cdnLoaded = true;
        console.log('[TailwindLoader] CDN Tailwind loaded successfully');
        showBody();
      }
    },
    () => {
      if (!timeoutFired) {
        console.warn('[TailwindLoader] CDN failed, loading local fallback...');
        loadLocalFallback();
      }
    }
  );

  // Timeout fallback - if CDN takes too long, load local
  setTimeout(() => {
    if (!cdnLoaded) {
      timeoutFired = true;
      cdnScript.remove(); // Remove the slow CDN script
      console.warn('[TailwindLoader] CDN timeout, loading local fallback...');
      loadLocalFallback();
    }
  }, TIMEOUT_MS);

  // Safety net: Show body after max 5 seconds regardless
  setTimeout(() => {
    if (!document.body.classList.contains('css-loaded')) {
      console.warn('[TailwindLoader] Safety timeout - showing body');
      showBody();
    }
  }, 5000);
})();
