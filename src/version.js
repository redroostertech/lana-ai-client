/**
 * LANA AI Version Information
 *
 * AUTO-GENERATED - DO NOT EDIT MANUALLY
 * Generated: 2026-02-02T14:55:30.982Z
 *
 * To update version:
 * 1. Edit package.json (version, buildNumber, releaseType)
 * 2. Run: npm run generate-version
 */

module.exports = {
  version: '3.3.1',
  buildNumber: '1',
  releaseType: 'stable',
  displayVersion: '3.3.1',
  buildDate: '2026-02-02T14:55:30.982Z',

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
