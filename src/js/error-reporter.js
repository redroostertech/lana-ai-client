/**
 * Error Reporter for Electron App
 *
 * Captures JavaScript errors and sends them to the main process
 * for inclusion in debug log exports.
 */
(function() {
  // Only run in Electron environment
  if (typeof window.electronAPI === 'undefined') {
    return;
  }

  const logError = window.electronAPI.logError;
  const logInfo = window.electronAPI.logInfo;

  // Log page load
  logInfo?.(`Page loaded: ${window.location.pathname}`);

  // Capture uncaught errors
  window.addEventListener('error', (event) => {
    const errorInfo = {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack
    };
    logError?.(`Uncaught error: ${event.message}`, errorInfo);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const errorInfo = {
      message: reason?.message || String(reason),
      stack: reason?.stack
    };
    logError?.(`Unhandled promise rejection: ${errorInfo.message}`, errorInfo);
  });

  // Capture console errors
  const originalConsoleError = console.error;
  console.error = function(...args) {
    // Send to main process
    const message = args.map(arg => {
      if (arg instanceof Error) {
        return `${arg.message}\n${arg.stack}`;
      }
      return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
    }).join(' ');

    logError?.(`Console error: ${message.slice(0, 500)}`);

    // Call original
    originalConsoleError.apply(console, args);
  };

})();
