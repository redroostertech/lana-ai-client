/**
 * LANA AI Version Information
 *
 * AUTO-GENERATED - DO NOT EDIT MANUALLY
 * Generated: 2026-01-17T02:30:33.135Z
 *
 * To update version:
 * 1. Edit package.json (version, buildNumber, releaseType)
 * 2. Run: npm run generate-version
 */

window.APP_VERSION = {
  version: '3.0.0',
  buildNumber: '1',
  releaseType: 'stable',
  displayVersion: '3.0.0',
  buildDate: '2026-01-17T02:30:33.135Z',

  /**
   * Get full version string
   * @returns {string} e.g., "v3.0.0b1"
   */
  getVersion() {
    return this.displayVersion;
  },

  /**
   * Get detailed version string
   * @returns {string} e.g., "v3.0.0b1 (Build 1, Beta)"
   */
  getDetailedVersion() {
    const type = this.releaseType.charAt(0).toUpperCase() + this.releaseType.slice(1);
    return `${this.displayVersion} (Build ${this.buildNumber}, ${type})`;
  },

  /**
   * Get semantic version (for comparisons)
   * @returns {string} e.g., "3.0.0"
   */
  getSemanticVersion() {
    return this.version;
  }
};

// Also export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.APP_VERSION;
}
