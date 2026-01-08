// tests/setup.js
// Jest setup file - runs before all tests

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce noise during tests

// Global test utilities
global.testUtils = {
  /**
   * Create a mock message array
   */
  createMockMessages: (count, contentFn) => {
    return Array(count).fill(null).map((_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: contentFn ? contentFn(i) : `Message ${i + 1}`
    }));
  },

  /**
   * Create a mock conversation with realistic content
   */
  createMockConversation: (pairs) => {
    const messages = [];
    for (let i = 0; i < pairs; i++) {
      messages.push({
        role: 'user',
        content: `User question ${i + 1}?`
      });
      messages.push({
        role: 'assistant',
        content: `Assistant response ${i + 1} with some detailed content here.`
      });
    }
    return messages;
  },

  /**
   * Sleep utility for async tests
   */
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Create mock request object
   */
  createMockRequest: (overrides = {}) => ({
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      organizationId: 'test-org-id'
    },
    body: {},
    headers: {},
    ...overrides
  }),

  /**
   * Create mock response object
   */
  createMockResponse: () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      write: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      flushHeaders: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis()
    };
    return res;
  }
};

// Suppress console logs during tests (unless DEBUG=true)
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    // Keep error for important messages
    error: console.error
  };
}

// Clean up after all tests
afterAll(async () => {
  // Close any open connections
  // await postgres.close(); // Uncomment if using real DB in tests
});
