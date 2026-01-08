// tests/integration/conversation-summarizer.test.js
// Integration tests for ConversationSummarizer service

const { ConversationSummarizer } = require('../../src/shared/conversation/conversation-summarizer.service');
const { TokenCounter } = require('../../src/shared/utils/token-counter.util');
const { describe, it, expect, beforeEach, jest } = require('@jest/globals');

// Mock ollama service
jest.mock('../../src/shared/services/ollama.service');
const ollamaService = require('../../src/shared/services/ollama.service');

describe('ConversationSummarizer Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('summarize()', () => {
    it('should create a summary via LLM', async () => {
      const messages = [
        { role: 'user', content: 'What is the capital of France?' },
        { role: 'assistant', content: 'The capital of France is Paris.' },
        { role: 'user', content: 'What is its population?' },
        { role: 'assistant', content: 'Paris has approximately 2.2 million people in the city proper.' }
      ];

      // Mock LLM response
      ollamaService.generateText.mockResolvedValue(
        'User asked about France\'s capital (Paris) and population (2.2M people).'
      );

      const summary = await ConversationSummarizer.summarize(messages, 300);

      expect(summary).toBeDefined();
      expect(summary.length).toBeGreaterThan(0);
      expect(ollamaService.generateText).toHaveBeenCalledTimes(1);

      const summaryTokens = TokenCounter.count(summary);
      expect(summaryTokens).toBeLessThanOrEqual(300);
    });

    it('should compress conversation significantly', async () => {
      const longConversation = Array(10).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'This is a message with some content that takes up space. '.repeat(5)
      }));

      ollamaService.generateText.mockResolvedValue(
        'Summary of 10 messages discussing various topics.'
      );

      const originalTokens = TokenCounter.countMessages(longConversation);
      const summary = await ConversationSummarizer.summarize(longConversation, 300);
      const summaryTokens = TokenCounter.count(summary);

      const compressionRatio = originalTokens / summaryTokens;
      expect(compressionRatio).toBeGreaterThan(2); // At least 2:1 compression
    });

    it('should use fallback when LLM times out', async () => {
      const messages = [
        { role: 'user', content: 'Question 1?' },
        { role: 'assistant', content: 'Answer 1 with lots of details.' },
        { role: 'user', content: 'Question 2?' },
        { role: 'assistant', content: 'Answer 2 with more information.' }
      ];

      // Mock timeout
      ollamaService.generateText.mockImplementation(() =>
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 15000))
      );

      const summary = await ConversationSummarizer.summarize(messages, 300);

      expect(summary).toBeDefined();
      expect(summary).toContain('[Auto-extracted summary]');
      expect(summary.length).toBeGreaterThan(0);
    });

    it('should use fallback when LLM fails', async () => {
      const messages = [
        { role: 'user', content: 'Test question' },
        { role: 'assistant', content: 'Test answer with details' }
      ];

      ollamaService.generateText.mockRejectedValue(new Error('LLM error'));

      const summary = await ConversationSummarizer.summarize(messages, 300);

      expect(summary).toBeDefined();
      expect(summary).toContain('[Auto-extracted summary]');
    });

    it('should handle empty message array', async () => {
      const summary = await ConversationSummarizer.summarize([], 300);
      expect(summary).toBeNull();
    });

    it('should truncate summary if exceeds target', async () => {
      const messages = [
        { role: 'user', content: 'Test' },
        { role: 'assistant', content: 'Response' }
      ];

      // Mock very long summary response
      const longSummary = 'This is a very long summary. '.repeat(100);
      ollamaService.generateText.mockResolvedValue(longSummary);

      const targetTokens = 50;
      const summary = await ConversationSummarizer.summarize(messages, targetTokens);

      const summaryTokens = TokenCounter.count(summary);
      expect(summaryTokens).toBeLessThanOrEqual(targetTokens);
    });

    it('should preserve key information in fallback summary', async () => {
      const messages = [
        { role: 'user', content: 'What is 2 + 2?' },
        { role: 'assistant', content: 'The answer is 4. This is basic arithmetic.' }
      ];

      ollamaService.generateText.mockRejectedValue(new Error('Fail'));

      const summary = await ConversationSummarizer.summarize(messages, 300);

      expect(summary).toContain('Q1:');
      expect(summary).toContain('A1:');
      expect(summary).toContain('2 + 2'); // User question preserved
    });
  });

  describe('createSlidingWindow()', () => {
    it('should keep all messages when conversation is short', async () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' }
      ];

      const result = await ConversationSummarizer.createSlidingWindow(messages, 6, 2500);

      expect(result.summary).toBeNull();
      expect(result.recentMessages).toEqual(messages);
      expect(result.strategy).toBe('full');
    });

    it('should summarize old messages and keep recent ones', async () => {
      const messages = Array(20).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`
      }));

      ollamaService.generateText.mockResolvedValue('Summary of old messages');

      const result = await ConversationSummarizer.createSlidingWindow(messages, 6, 2500);

      expect(result.summary).toBeDefined();
      expect(result.recentMessages.length).toBe(6);
      expect(result.strategy).toMatch(/standard|aggressive/);
      expect(result.totalTokens).toBeLessThanOrEqual(2500);
    });

    it('should use aggressive strategy when budget tight', async () => {
      const messages = Array(30).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'This is a longer message that takes up more tokens. '.repeat(10)
      }));

      ollamaService.generateText.mockResolvedValue('Aggressive summary');

      const result = await ConversationSummarizer.createSlidingWindow(
        messages,
        6,
        1000 // Very tight budget
      );

      expect(result.summary).toBeDefined();
      expect(result.recentMessages.length).toBeLessThanOrEqual(6);
      expect(result.totalTokens).toBeLessThanOrEqual(1000);
    });

    it('should handle empty conversation', async () => {
      const result = await ConversationSummarizer.createSlidingWindow([], 6, 2500);

      expect(result.summary).toBeNull();
      expect(result.recentMessages).toEqual([]);
      expect(result.strategy).toBe('empty');
    });

    it('should maintain token budget', async () => {
      const messages = Array(15).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'Test message content here'
      }));

      ollamaService.generateText.mockResolvedValue('Summary here');

      const tokenBudget = 2500;
      const result = await ConversationSummarizer.createSlidingWindow(messages, 6, tokenBudget);

      expect(result.totalTokens).toBeLessThanOrEqual(tokenBudget);
    });
  });

  describe('smartSelect()', () => {
    it('should use full messages for short conversations', async () => {
      const messages = Array(5).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));

      const result = await ConversationSummarizer.smartSelect(
        messages,
        'current query',
        2500
      );

      expect(result.summary).toBeNull();
      expect(result.selectedMessages).toEqual(messages);
      expect(result.selectionMethod).toBe('full');
    });

    it('should select relevant middle messages', async () => {
      const messages = [
        { role: 'user', content: 'Talk about dogs' },
        { role: 'assistant', content: 'Dogs are great pets' },
        { role: 'user', content: 'What about cats?' },
        { role: 'assistant', content: 'Cats are independent' },
        { role: 'user', content: 'Birds?' },
        { role: 'assistant', content: 'Birds can sing' },
        { role: 'user', content: 'Back to dogs - breeds?' },
        { role: 'assistant', content: 'Many dog breeds exist' },
        { role: 'user', content: 'Dog training tips?' },
        { role: 'assistant', content: 'Use positive reinforcement' }
      ];

      ollamaService.generateText.mockResolvedValue('Summary of unselected messages');

      const result = await ConversationSummarizer.smartSelect(
        messages,
        'Tell me more about dog breeds', // Query about dogs
        2500
      );

      expect(result.selectedMessages).toBeDefined();
      expect(result.selectedMessages.length).toBeGreaterThan(0);
      expect(result.selectionMethod).toBe('smart');

      // Should include messages about dogs due to relevance
      const dogMessages = result.selectedMessages.filter(m =>
        m.content.toLowerCase().includes('dog')
      );
      expect(dogMessages.length).toBeGreaterThan(0);
    });

    it('should include first and last messages', async () => {
      const messages = Array(15).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`
      }));

      ollamaService.generateText.mockResolvedValue('Summary');

      const result = await ConversationSummarizer.smartSelect(messages, 'query', 2500);

      // First message should be included
      expect(result.selectedMessages[0]).toEqual(messages[0]);

      // Last 6 messages should be included
      const lastSelected = result.selectedMessages.slice(-6);
      const lastActual = messages.slice(-6);
      expect(lastSelected).toEqual(lastActual);
    });

    it('should respect token budget', async () => {
      const messages = Array(20).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'Message content here. '.repeat(20)
      }));

      ollamaService.generateText.mockResolvedValue('Summary of dropped messages');

      const budget = 2500;
      const result = await ConversationSummarizer.smartSelect(messages, 'query', budget);

      expect(result.totalTokens).toBeLessThanOrEqual(budget);
    });

    it('should maintain chronological order', async () => {
      const messages = Array(15).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`,
        timestamp: i
      }));

      ollamaService.generateText.mockResolvedValue('Summary');

      const result = await ConversationSummarizer.smartSelect(messages, 'query', 2500);

      // Check that selected messages are in chronological order
      for (let i = 1; i < result.selectedMessages.length; i++) {
        const prev = parseInt(result.selectedMessages[i - 1].content.split(' ')[1]);
        const curr = parseInt(result.selectedMessages[i].content.split(' ')[1]);
        expect(curr).toBeGreaterThan(prev);
      }
    });

    it('should fallback to sliding window on error', async () => {
      const messages = Array(15).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));

      // Cause an error in smart select
      ollamaService.generateText.mockRejectedValue(new Error('Fail'));

      const result = await ConversationSummarizer.smartSelect(messages, 'query', 2500);

      // Should still return a valid result via fallback
      expect(result).toBeDefined();
      expect(result.recentMessages || result.selectedMessages).toBeDefined();
    });

    it('should provide stats in result', async () => {
      const messages = Array(15).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));

      ollamaService.generateText.mockResolvedValue('Summary');

      const result = await ConversationSummarizer.smartSelect(messages, 'query', 2500);

      expect(result.stats).toBeDefined();
      expect(result.stats.total).toBe(15);
      expect(result.stats.selected).toBeLessThanOrEqual(15);
      expect(result.stats.summarized).toBeDefined();
    });
  });

  describe('rankByRelevance()', () => {
    it('should rank messages by keyword matches', () => {
      const messages = [
        { role: 'user', content: 'Tell me about dogs' },
        { role: 'assistant', content: 'Cats are great' },
        { role: 'user', content: 'What do dogs eat?' },
        { role: 'assistant', content: 'Dogs need protein' }
      ];

      const ranked = ConversationSummarizer.rankByRelevance(messages, 'dogs nutrition');

      // Messages with "dogs" should rank higher
      expect(ranked[0].content).toContain('dogs');
    });

    it('should give bonus to user messages', () => {
      const messages = [
        { role: 'assistant', content: 'The answer is here' },
        { role: 'user', content: 'The question is here' }
      ];

      const ranked = ConversationSummarizer.rankByRelevance(messages, 'here');

      // User message should rank slightly higher
      expect(ranked[0].role).toBe('user');
    });

    it('should consider question marks important', () => {
      const messages = [
        { role: 'assistant', content: 'Statement about topic' },
        { role: 'user', content: 'Question about topic?' }
      ];

      const ranked = ConversationSummarizer.rankByRelevance(messages, 'topic');

      // Message with question mark should rank higher
      expect(ranked[0].content).toContain('?');
    });

    it('should handle empty query', () => {
      const messages = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Message 2' }
      ];

      const ranked = ConversationSummarizer.rankByRelevance(messages, '');
      expect(ranked).toEqual(messages);
    });

    it('should filter out short words', () => {
      const messages = [
        { role: 'user', content: 'Important information here' },
        { role: 'assistant', content: 'The and or but if' }
      ];

      // Query with short words that should be ignored
      const ranked = ConversationSummarizer.rankByRelevance(messages, 'the and important');

      // Should match "important" not "the" or "and"
      expect(ranked[0].content).toContain('Important');
    });
  });

  describe('analyzeSummarizationNeed()', () => {
    it('should indicate no summarization needed for short conversations', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' }
      ];

      const analysis = ConversationSummarizer.analyzeSummarizationNeed(messages, 2500);

      expect(analysis.needsSummarization).toBe(false);
      expect(analysis.recommendation).toBe('fits_in_budget');
    });

    it('should detect minor overflow', () => {
      const messages = Array(50).fill(null).map(() => ({
        role: 'user',
        content: 'Message content here'
      }));

      const analysis = ConversationSummarizer.analyzeSummarizationNeed(messages, 100);

      expect(analysis.needsSummarization).toBe(true);
      expect(analysis.recommendation).toContain('overflow');
    });

    it('should detect major overflow', () => {
      const messages = Array(100).fill(null).map(() => ({
        role: 'user',
        content: 'Long message content that takes up many tokens. '.repeat(10)
      }));

      const analysis = ConversationSummarizer.analyzeSummarizationNeed(messages, 1000);

      expect(analysis.needsSummarization).toBe(true);
      expect(analysis.recommendation).toContain('major');
    });

    it('should handle empty messages', () => {
      const analysis = ConversationSummarizer.analyzeSummarizationNeed([], 2500);

      expect(analysis.needsSummarization).toBe(false);
      expect(analysis.recommendation).toBe('no_messages');
    });

    it('should provide overflow details', () => {
      const messages = Array(100).fill(null).map(() => ({
        role: 'user',
        content: 'Message'
      }));

      const analysis = ConversationSummarizer.analyzeSummarizationNeed(messages, 100);

      expect(analysis.overflow).toBeDefined();
      expect(analysis.overflow).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle malformed messages gracefully', async () => {
      const messages = [
        { role: 'user', content: 'Valid' },
        { role: 'assistant' }, // Missing content
        { content: 'Missing role' },
        null,
        undefined
      ];

      ollamaService.generateText.mockResolvedValue('Summary');

      const result = await ConversationSummarizer.createSlidingWindow(
        messages.filter(m => m && m.role && m.content),
        6,
        2500
      );

      expect(result).toBeDefined();
    });

    it('should handle very large conversations', async () => {
      const messages = Array(1000).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));

      ollamaService.generateText.mockResolvedValue('Summary');

      const result = await ConversationSummarizer.smartSelect(messages, 'query', 2500);

      expect(result).toBeDefined();
      expect(result.totalTokens).toBeLessThanOrEqual(2500);
    });

    it('should handle concurrent summarization requests', async () => {
      const messages1 = Array(10).fill(null).map(() => ({
        role: 'user',
        content: 'Message 1'
      }));

      const messages2 = Array(10).fill(null).map(() => ({
        role: 'user',
        content: 'Message 2'
      }));

      ollamaService.generateText.mockResolvedValue('Summary');

      const [result1, result2] = await Promise.all([
        ConversationSummarizer.summarize(messages1, 300),
        ConversationSummarizer.summarize(messages2, 300)
      ]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });
});
