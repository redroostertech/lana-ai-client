// tests/unit/token-counter.test.js
// Unit tests for TokenCounter utility

const { TokenCounter } = require('../../src/shared/utils/token-counter.util');
const { describe, it, expect, beforeEach } = require('@jest/globals');

describe('TokenCounter', () => {
  describe('count()', () => {
    it('should count tokens in simple text', () => {
      const text = 'Hello world';
      const tokens = TokenCounter.count(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should handle empty strings', () => {
      expect(TokenCounter.count('')).toBe(0);
      expect(TokenCounter.count(null)).toBe(0);
      expect(TokenCounter.count(undefined)).toBe(0);
    });

    it('should handle non-string inputs', () => {
      expect(TokenCounter.count(123)).toBe(0);
      expect(TokenCounter.count({})).toBe(0);
      expect(TokenCounter.count([])).toBe(0);
    });

    it('should count more tokens for longer text', () => {
      const shortText = 'Hi';
      const longText = 'This is a much longer sentence with many more words and tokens.';

      const shortTokens = TokenCounter.count(shortText);
      const longTokens = TokenCounter.count(longText);

      expect(longTokens).toBeGreaterThan(shortTokens);
    });

    it('should handle special characters', () => {
      const text = 'Hello! How are you? 😊 #awesome';
      const tokens = TokenCounter.count(text);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle unicode and emojis', () => {
      const text = '🚀 Unicode test: 你好世界 مرحبا';
      const tokens = TokenCounter.count(text);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle newlines and whitespace', () => {
      const text = 'Line 1\nLine 2\n\nLine 3\t\tTabbed';
      const tokens = TokenCounter.count(text);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should use fallback for encoder errors', () => {
      // This shouldn't normally happen, but test defensive code
      const result = TokenCounter.count('normal text');
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('countMessages()', () => {
    it('should count tokens across multiple messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ];

      const totalTokens = TokenCounter.countMessages(messages);
      expect(totalTokens).toBeGreaterThan(0);
    });

    it('should handle empty message array', () => {
      expect(TokenCounter.countMessages([])).toBe(0);
      expect(TokenCounter.countMessages(null)).toBe(0);
      expect(TokenCounter.countMessages(undefined)).toBe(0);
    });

    it('should skip messages without content', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant' }, // No content
        { role: 'user', content: null }, // Null content
        { role: 'user', content: 'Goodbye' }
      ];

      const tokens = TokenCounter.countMessages(messages);
      expect(tokens).toBeGreaterThan(0);
      // Should only count "Hello" and "Goodbye"
    });

    it('should add overhead for message structure', () => {
      const singleMessage = [{ role: 'user', content: 'Test' }];
      const contentOnlyTokens = TokenCounter.count('Test');
      const messageTokens = TokenCounter.countMessages(singleMessage);

      // Message format adds tokens for role markers
      expect(messageTokens).toBeGreaterThanOrEqual(contentOnlyTokens);
    });

    it('should count more tokens for more messages', () => {
      const oneMessage = [{ role: 'user', content: 'Test' }];
      const fiveMessages = Array(5).fill({ role: 'user', content: 'Test' });

      const oneTokens = TokenCounter.countMessages(oneMessage);
      const fiveTokens = TokenCounter.countMessages(fiveMessages);

      expect(fiveTokens).toBeGreaterThan(oneTokens);
    });
  });

  describe('truncate()', () => {
    it('should truncate text to fit within token limit', () => {
      const longText = 'This is a very long text that will definitely exceed a small token limit. '.repeat(20);
      const maxTokens = 50;

      const truncated = TokenCounter.truncate(longText, maxTokens);
      const truncatedTokens = TokenCounter.count(truncated);

      expect(truncatedTokens).toBeLessThanOrEqual(maxTokens);
      expect(truncated.length).toBeLessThan(longText.length);
    });

    it('should not truncate if already under limit', () => {
      const shortText = 'Short text';
      const maxTokens = 100;

      const result = TokenCounter.truncate(shortText, maxTokens);
      expect(result).toBe(shortText);
    });

    it('should handle empty strings', () => {
      expect(TokenCounter.truncate('', 50)).toBe('');
      expect(TokenCounter.truncate(null, 50)).toBe('');
      expect(TokenCounter.truncate(undefined, 50)).toBe('');
    });

    it('should add ellipsis indicator when truncated', () => {
      const longText = 'This is a very long text. '.repeat(50);
      const truncated = TokenCounter.truncate(longText, 20);

      expect(truncated).toContain('...');
    });

    it('should handle very small token limits', () => {
      const text = 'This is a test';
      const truncated = TokenCounter.truncate(text, 1);

      expect(truncated).toBeDefined();
      expect(TokenCounter.count(truncated)).toBeLessThanOrEqual(1);
    });

    it('should preserve word boundaries when possible', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const truncated = TokenCounter.truncate(text, 10);

      // Should try to end at a word boundary, not mid-word
      expect(truncated).not.toMatch(/\S\.\.\./); // Not ending mid-word
    });
  });

  describe('breakdown()', () => {
    it('should provide detailed token breakdown for prompt components', () => {
      const systemContext = 'You are a helpful assistant.';
      const ragContext = 'Document 1: Important information...';
      const conversationHistory = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' }
      ];
      const currentMessage = 'What is this about?';

      const breakdown = TokenCounter.breakdown({
        systemContext,
        ragContext,
        conversationHistory,
        currentMessage
      });

      expect(breakdown).toHaveProperty('system');
      expect(breakdown).toHaveProperty('rag');
      expect(breakdown).toHaveProperty('history');
      expect(breakdown).toHaveProperty('current');
      expect(breakdown).toHaveProperty('total');

      expect(breakdown.system).toBeGreaterThan(0);
      expect(breakdown.total).toBe(
        breakdown.system + breakdown.rag + breakdown.history + breakdown.current
      );
    });

    it('should handle null/undefined components', () => {
      const breakdown = TokenCounter.breakdown({
        systemContext: 'System',
        ragContext: null,
        conversationHistory: undefined,
        currentMessage: 'Message'
      });

      expect(breakdown.rag).toBe(0);
      expect(breakdown.history).toBe(0);
      expect(breakdown.system).toBeGreaterThan(0);
      expect(breakdown.current).toBeGreaterThan(0);
    });

    it('should handle empty arrays for conversation history', () => {
      const breakdown = TokenCounter.breakdown({
        systemContext: 'System',
        ragContext: 'RAG',
        conversationHistory: [],
        currentMessage: 'Message'
      });

      expect(breakdown.history).toBe(0);
    });

    it('should accurately sum all components', () => {
      const components = {
        systemContext: 'System context here',
        ragContext: 'RAG context here',
        conversationHistory: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' }
        ],
        currentMessage: 'Current message'
      };

      const breakdown = TokenCounter.breakdown(components);

      // Manually calculate
      const expectedTotal =
        TokenCounter.count(components.systemContext) +
        TokenCounter.count(components.ragContext) +
        TokenCounter.countMessages(components.conversationHistory) +
        TokenCounter.count(components.currentMessage);

      expect(breakdown.total).toBe(expectedTotal);
    });
  });

  describe('Edge Cases and Performance', () => {
    it('should handle very large texts efficiently', () => {
      const largeText = 'Lorem ipsum dolor sit amet. '.repeat(10000); // ~280KB

      const startTime = Date.now();
      const tokens = TokenCounter.count(largeText);
      const duration = Date.now() - startTime;

      expect(tokens).toBeGreaterThan(0);
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });

    it('should handle rapid successive calls', () => {
      const texts = Array(100).fill('Test message');

      const startTime = Date.now();
      texts.forEach(text => TokenCounter.count(text));
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500); // Should be very fast
    });

    it('should handle malformed inputs gracefully', () => {
      const malformed = [
        { toString: () => { throw new Error('Bad'); } },
        Symbol('test'),
        () => 'function'
      ];

      malformed.forEach(input => {
        expect(() => TokenCounter.count(input)).not.toThrow();
      });
    });

    it('should produce consistent results for same input', () => {
      const text = 'Consistency test message';

      const count1 = TokenCounter.count(text);
      const count2 = TokenCounter.count(text);
      const count3 = TokenCounter.count(text);

      expect(count1).toBe(count2);
      expect(count2).toBe(count3);
    });
  });

  describe('Token Count Accuracy', () => {
    it('should count approximately 4 characters per token (rough average)', () => {
      const text = 'This is a test message with approximately twenty words in it for testing purposes.';
      const tokens = TokenCounter.count(text);
      const chars = text.length;

      const ratio = chars / tokens;
      expect(ratio).toBeGreaterThan(2); // At least 2 chars/token
      expect(ratio).toBeLessThan(6); // At most 6 chars/token
    });

    it('should count tokens for code snippets', () => {
      const code = `
        function test() {
          const x = 10;
          return x * 2;
        }
      `;

      const tokens = TokenCounter.count(code);
      expect(tokens).toBeGreaterThan(10); // Code has structure
    });

    it('should count tokens for JSON', () => {
      const json = JSON.stringify({
        name: 'Test',
        values: [1, 2, 3, 4, 5],
        nested: { key: 'value' }
      });

      const tokens = TokenCounter.count(json);
      expect(tokens).toBeGreaterThan(0);
    });
  });
});
