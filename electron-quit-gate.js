'use strict';

/**
 * The app's quit: the local servers' shutdown runs once (LANA Briefs, the engine's job handoff
 * of up to 12 seconds, Pip, the redactor, Docling, the editor), then the quit goes through.
 * A second Cmd-Q or SIGTERM during it waits for the same shutdown; it never skips it and never
 * starts another. A shutdown that fails still lets the app quit.
 */

/**
 * @param {{ cleanup: () => Promise<void>, quit: () => void, log?: (message: string, error?: Error) => void }} deps
 */
function createQuitGate({ cleanup, quit, log = () => {} }) {
  let inFlight = null;
  let finished = false;
  return {
    /** For before-quit: true when the quit may go ahead now, else it waits (preventDefault). */
    beforeQuit(event) {
      if (finished) return true;
      event.preventDefault();
      if (!inFlight) {
        let started;
        try {
          started = Promise.resolve(cleanup());
        } catch (error) {
          started = Promise.reject(error);
        }
        inFlight = started
          .catch((error) => log('[quit] the shutdown did not finish cleanly', error))
          .then(() => {
            finished = true;
            quit();
          });
      }
      return false;
    },
    /** The shutdown in flight (resolved once the quit was asked for again). */
    done: () => inFlight || Promise.resolve()
  };
}

module.exports = { createQuitGate };
