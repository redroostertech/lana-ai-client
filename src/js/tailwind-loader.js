/**
 * Tailwind CSS Loader with CDN + Local Fallback
 *
 * Tries to load Tailwind CSS from CDN first for faster loading.
 * Falls back to local copy if CDN is unreachable (e.g., offline, firewall).
 * Prevents FOUC by showing a loading screen until CSS is ready.
 */
(function() {
  const CDN_URL = 'https://cdn.tailwindcss.com';
  const LOCAL_URL = 'js/../css/tailwind.js'; // Relative to HTML file location
  const TIMEOUT_MS = 3000; // 3 second timeout for CDN

  // Add loading screen and FOUC prevention styles immediately
  const foucStyle = document.createElement('style');
  foucStyle.id = 'fouc-prevention';
  foucStyle.textContent = `
    /* Hide page content until CSS loads */
    body { opacity: 0; }
    body.css-loaded { opacity: 1; transition: opacity 0.2s ease-in; }

    /* Loading screen styles (inline to work before Tailwind) */
    #lana-loading-screen {
      position: fixed;
      inset: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      opacity: 1;
      transition: opacity 0.3s ease-out;
    }

    #lana-loading-screen.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .loading-logo {
      width: 80px;
      height: 80px;
      margin-bottom: 24px;
      animation: pulse 2s ease-in-out infinite;
    }

    .loading-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }

    .loading-text {
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      opacity: 0.9;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(0.95); }
    }
  `;
  document.head.appendChild(foucStyle);

  // Create loading screen HTML
  const loadingScreen = document.createElement('div');
  loadingScreen.id = 'lana-loading-screen';
  loadingScreen.innerHTML = `
    <svg class="loading-logo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="45" fill="white" opacity="0.2"/>
      <circle cx="50" cy="50" r="35" fill="white" opacity="0.4"/>
      <circle cx="50" cy="50" r="25" fill="white"/>
      <text x="50" y="58" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#667eea" text-anchor="middle">L</text>
    </svg>
    <div class="loading-spinner"></div>
    <div class="loading-text">Loading LanaAI...</div>
  `;

  // Insert loading screen as first body element
  // Use DOMContentLoaded or insert immediately if body exists
  if (document.body) {
    document.body.insertBefore(loadingScreen, document.body.firstChild);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.insertBefore(loadingScreen, document.body.firstChild);
    });
  }

  // Function to hide loading screen and show page content when CSS is ready
  function showBody() {
    // Wait a tiny bit for Tailwind to process
    requestAnimationFrame(() => {
      // Show the main content
      document.body.classList.add('css-loaded');

      // Hide the loading screen with fade-out animation
      const loadingScreen = document.getElementById('lana-loading-screen');
      if (loadingScreen) {
        loadingScreen.classList.add('hidden');
        // Remove from DOM after animation completes
        setTimeout(() => {
          loadingScreen.remove();
        }, 300);
      }
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
