'use strict';

module.exports = {
  // Browser E2E and captured QA specs use Playwright's runner and fixtures.
  // Loading them through Jest fails before collection and obscures the actual
  // client unit/integration/validation result.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/playwright/',
    '<rootDir>/qa-evidence/',
    // This legacy suite targets a removed client-side LLM summarizer and its
    // removed Ollama adapter. Conversation summarization is backend-owned now.
    '<rootDir>/tests/integration/conversation-summarizer.test.js',
  ],
  modulePathIgnorePatterns: ['<rootDir>/electron-dist/'],
};
