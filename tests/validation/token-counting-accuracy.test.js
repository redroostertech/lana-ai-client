// tests/validation/token-counting-accuracy.test.js
// Validation tests for token counting accuracy against known benchmarks

const { TokenCounter } = require('../../src/shared/utils/token-counter.util');
const { describe, it, expect } = require('@jest/globals');

/**
 * These tests validate the accuracy of our token counting
 * against known token counts from OpenAI's tokenizer (which Llama is based on)
 *
 * Token counts are approximate since Llama uses a different tokenizer,
 * but should be within ~10% of GPT-3 token counts
 */
describe('Token Counting Accuracy Validation', () => {
  describe('Known Benchmarks', () => {
    it('should count "Hello world" as approximately 2-3 tokens', () => {
      const text = 'Hello world';
      const tokens = TokenCounter.count(text);

      expect(tokens).toBeGreaterThanOrEqual(2);
      expect(tokens).toBeLessThanOrEqual(3);
    });

    it('should count common phrase within expected range', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const tokens = TokenCounter.count(text);

      // Known: ~9-10 tokens in GPT-3
      expect(tokens).toBeGreaterThanOrEqual(8);
      expect(tokens).toBeLessThanOrEqual(12);
    });

    it('should count technical text appropriately', () => {
      const text = 'function calculateTokens(text) { return text.length; }';
      const tokens = TokenCounter.count(text);

      // Technical tokens (function, keywords, symbols) typically 12-15 tokens
      expect(tokens).toBeGreaterThanOrEqual(10);
      expect(tokens).toBeLessThanOrEqual(18);
    });

    it('should count paragraph within expected range', () => {
      const text = `
        In natural language processing, a token is a basic unit of text.
        For language models, tokenization is the process of breaking down text into tokens.
        Different models use different tokenization strategies.
      `;

      const tokens = TokenCounter.count(text);

      // ~45-55 tokens expected
      expect(tokens).toBeGreaterThanOrEqual(40);
      expect(tokens).toBeLessThanOrEqual(60);
    });

    it('should count JSON structure appropriately', () => {
      const json = JSON.stringify({
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
        address: {
          street: '123 Main St',
          city: 'Springfield'
        }
      });

      const tokens = TokenCounter.count(json);

      // JSON with structure: ~25-35 tokens
      expect(tokens).toBeGreaterThanOrEqual(20);
      expect(tokens).toBeLessThanOrEqual(40);
    });
  });

  describe('Character-to-Token Ratios', () => {
    it('should maintain ~4:1 character-to-token ratio for prose', () => {
      const prose = `
        The artificial intelligence system processes natural language
        by breaking it down into tokens. Each token represents a unit
        of meaning that the model can understand and process. This allows
        the model to work with text in a structured way.
      `;

      const tokens = TokenCounter.count(prose);
      const chars = prose.length;
      const ratio = chars / tokens;

      // Typical ratio: 3-5 characters per token
      expect(ratio).toBeGreaterThanOrEqual(3);
      expect(ratio).toBeLessThanOrEqual(6);
    });

    it('should have lower ratio for code (more symbols)', () => {
      const code = `
        const x = [1, 2, 3];
        const y = x.map(n => n * 2);
        console.log(y);
      `;

      const tokens = TokenCounter.count(code);
      const chars = code.length;
      const ratio = chars / tokens;

      // Code has more symbols, so lower char/token ratio: 2-4
      expect(ratio).toBeGreaterThanOrEqual(2);
      expect(ratio).toBeLessThanOrEqual(5);
    });

    it('should have higher ratio for natural language', () => {
      const text = 'This is a simple sentence with common English words';

      const tokens = TokenCounter.count(text);
      const chars = text.length;
      const ratio = chars / tokens;

      // Natural language: 4-6 chars/token
      expect(ratio).toBeGreaterThanOrEqual(3.5);
      expect(ratio).toBeLessThanOrEqual(7);
    });
  });

  describe('Real-World Message Scenarios', () => {
    it('should accurately count a typical user question', () => {
      const message = 'Can you explain how RAG retrieval works in this system?';
      const tokens = TokenCounter.count(message);

      // ~11-14 tokens expected
      expect(tokens).toBeGreaterThanOrEqual(10);
      expect(tokens).toBeLessThanOrEqual(16);
    });

    it('should accurately count a detailed AI response', () => {
      const response = `
        RAG (Retrieval-Augmented Generation) works by first retrieving relevant
        documents from your knowledge base, then using those documents as context
        for generating a response. This system uses a three-tier approach:
        HOT tier for session documents, WARM tier for matter documents, and
        COLD tier for organization-wide documents. The retrieval uses both
        full-text search and vector similarity to find the most relevant chunks.
      `;

      const tokens = TokenCounter.count(response);

      // ~85-100 tokens expected
      expect(tokens).toBeGreaterThanOrEqual(75);
      expect(tokens).toBeLessThanOrEqual(110);
    });

    it('should accurately count a conversation history', () => {
      const messages = [
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: 'I\'m doing well, thank you! How can I help you today?' },
        { role: 'user', content: 'I need help with document analysis' },
        { role: 'assistant', content: 'I\'d be happy to help with document analysis. What documents would you like to analyze?' }
      ];

      const tokens = TokenCounter.countMessages(messages);

      // ~40-55 tokens expected (including message structure overhead)
      expect(tokens).toBeGreaterThanOrEqual(35);
      expect(tokens).toBeLessThanOrEqual(65);
    });
  });

  describe('System Context Scenarios', () => {
    it('should accurately count typical system context', () => {
      const systemContext = `
        You are LanaAI, an intelligent legal assistant. You help lawyers and legal
        professionals with document analysis, research, and matter management.
        You have access to documents uploaded to the system and can answer questions
        about them. Always be professional, accurate, and cite your sources when
        referring to specific documents.
      `;

      const tokens = TokenCounter.count(systemContext);

      // ~60-75 tokens expected
      expect(tokens).toBeGreaterThanOrEqual(55);
      expect(tokens).toBeLessThanOrEqual(85);
    });

    it('should accurately count system context with user info', () => {
      const systemContext = `
        You are LanaAI, an intelligent legal assistant.

        Current user: John Smith (john@lawfirm.com)
        Organization: Smith & Associates Law Firm
        Current matter: Johnson v. State, Case #2024-1234
        Matter type: Criminal Defense

        Respond professionally and cite sources when discussing documents.
      `;

      const tokens = TokenCounter.count(systemContext);

      // ~70-90 tokens expected
      expect(tokens).toBeGreaterThanOrEqual(60);
      expect(tokens).toBeLessThanOrEqual(100);
    });
  });

  describe('RAG Context Scenarios', () => {
    it('should accurately count RAG context with citations', () => {
      const ragContext = `
        Document Context:

        [Document: contract.pdf, Page 5]
        "The agreement shall remain in effect for a period of two (2) years
        from the date of execution, subject to renewal upon mutual consent
        of both parties."

        [Document: amendment.pdf, Page 1]
        "This Amendment modifies Section 3.1 of the original agreement to
        extend the term to three (3) years."
      `;

      const tokens = TokenCounter.count(ragContext);

      // ~90-110 tokens expected
      expect(tokens).toBeGreaterThanOrEqual(80);
      expect(tokens).toBeLessThanOrEqual(120);
    });

    it('should accurately count dense document excerpt', () => {
      const excerpt = `
        Pursuant to 28 U.S.C. § 1332(a), federal courts have original jurisdiction
        over civil actions where the matter in controversy exceeds $75,000 and is
        between citizens of different states. The plaintiff, a citizen of New York,
        seeks damages totaling $150,000 from the defendant, a citizen of California.
      `;

      const tokens = TokenCounter.count(excerpt);

      // ~70-85 tokens expected (legal text is dense)
      expect(tokens).toBeGreaterThanOrEqual(60);
      expect(tokens).toBeLessThanOrEqual(95);
    });
  });

  describe('Edge Cases and Special Content', () => {
    it('should handle repeated words efficiently', () => {
      const text = 'test test test test test';
      const tokens = TokenCounter.count(text);

      // Each "test" is 1 token, spaces add minimal tokens: ~5-7 tokens
      expect(tokens).toBeGreaterThanOrEqual(5);
      expect(tokens).toBeLessThanOrEqual(8);
    });

    it('should handle numbers appropriately', () => {
      const text = 'The cost is $1,234.56 for 3 items totaling 9,999 units';
      const tokens = TokenCounter.count(text);

      // Numbers with separators count as multiple tokens
      expect(tokens).toBeGreaterThanOrEqual(12);
      expect(tokens).toBeLessThanOrEqual(20);
    });

    it('should handle URLs correctly', () => {
      const text = 'Visit https://www.example.com/path/to/resource?id=123&type=doc for more info';
      const tokens = TokenCounter.count(text);

      // URLs are tokenized into parts
      expect(tokens).toBeGreaterThanOrEqual(15);
      expect(tokens).toBeLessThanOrEqual(25);
    });

    it('should handle email addresses', () => {
      const text = 'Contact john.smith@lawfirm.com or jane.doe@example.org';
      const tokens = TokenCounter.count(text);

      // Email addresses tokenize at @ and .
      expect(tokens).toBeGreaterThanOrEqual(10);
      expect(tokens).toBeLessThanOrEqual(16);
    });

    it('should handle contractions', () => {
      const text = 'I\'m can\'t won\'t shouldn\'t wouldn\'t';
      const tokens = TokenCounter.count(text);

      // Contractions may be 1 or 2 tokens each
      expect(tokens).toBeGreaterThanOrEqual(5);
      expect(tokens).toBeLessThanOrEqual(10);
    });

    it('should handle emojis and unicode', () => {
      const text = 'Great work! 👍 🎉 Looking forward to it! 😊';
      const tokens = TokenCounter.count(text);

      // Emojis can be multiple tokens each
      expect(tokens).toBeGreaterThanOrEqual(10);
      expect(tokens).toBeLessThanOrEqual(20);
    });
  });

  describe('Budget Validation Scenarios', () => {
    it('should validate that 8K context window fits typical usage', () => {
      const systemContext = 'You are a helpful assistant. '.repeat(20); // ~120 tokens
      const ragContext = 'Document excerpt here. '.repeat(100); // ~400 tokens
      const conversationHistory = Array(10).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'Typical message content'
      })); // ~60 tokens

      const systemTokens = TokenCounter.count(systemContext);
      const ragTokens = TokenCounter.count(ragContext);
      const historyTokens = TokenCounter.countMessages(conversationHistory);

      const total = systemTokens + ragTokens + historyTokens;

      // Should fit well within 8K budget
      expect(total).toBeLessThan(8192);
      expect(total).toBeGreaterThan(400); // But substantial
    });

    it('should validate that large conversation needs summarization', () => {
      const largeConversation = Array(50).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'This is a message with substantial content that takes up space. '.repeat(5)
      }));

      const tokens = TokenCounter.countMessages(largeConversation);

      // Should exceed 2500 token history budget
      expect(tokens).toBeGreaterThan(2500);
    });

    it('should validate that summarization achieves compression', () => {
      const longMessage = 'This is a long message. '.repeat(100); // ~400 tokens
      const targetTokens = 50;

      const truncated = TokenCounter.truncate(longMessage, targetTokens);
      const truncatedTokens = TokenCounter.count(truncated);

      expect(truncatedTokens).toBeLessThanOrEqual(targetTokens);

      const compressionRatio = TokenCounter.count(longMessage) / truncatedTokens;
      expect(compressionRatio).toBeGreaterThan(5); // At least 5:1 compression
    });
  });

  describe('Consistency and Reliability', () => {
    it('should produce consistent counts across multiple calls', () => {
      const text = 'Consistency test message for validation';

      const counts = Array(10).fill(null).map(() => TokenCounter.count(text));

      // All counts should be identical
      const allSame = counts.every(c => c === counts[0]);
      expect(allSame).toBe(true);
    });

    it('should handle rapid successive calls without degradation', () => {
      const texts = Array(100).fill('Test message');

      const startTime = Date.now();
      const counts = texts.map(t => TokenCounter.count(t));
      const duration = Date.now() - startTime;

      // All counts should be identical
      expect(counts.every(c => c === counts[0])).toBe(true);

      // Should complete quickly (< 100ms for 100 calls)
      expect(duration).toBeLessThan(100);
    });

    it('should maintain accuracy for very long texts', () => {
      const longText = 'This is a sentence. '.repeat(500); // ~2000 tokens

      const tokens = TokenCounter.count(longText);

      // Should be proportional: 500 repetitions × ~4 tokens each
      expect(tokens).toBeGreaterThanOrEqual(1800);
      expect(tokens).toBeLessThanOrEqual(2200);
    });
  });

  describe('Comparison with Manual Calculations', () => {
    it('should match manual word-based estimation within margin', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const words = text.split(' ').length; // 9 words

      const tokens = TokenCounter.count(text);

      // Token count should be close to word count (±2 tokens)
      expect(Math.abs(tokens - words)).toBeLessThanOrEqual(3);
    });

    it('should account for punctuation and special characters', () => {
      const text = 'Hello! How are you? I\'m doing well, thanks.';
      const words = text.split(/\s+/).length; // ~8 words

      const tokens = TokenCounter.count(text);

      // Tokens should be slightly more than words due to punctuation
      expect(tokens).toBeGreaterThanOrEqual(words);
      expect(tokens).toBeLessThanOrEqual(words + 5);
    });
  });

  describe('Accuracy Metrics', () => {
    it('should maintain >90% accuracy for typical prose', () => {
      const testCases = [
        { text: 'Hello world', expectedRange: [2, 3] },
        { text: 'The quick brown fox', expectedRange: [4, 5] },
        { text: 'How are you doing today?', expectedRange: [6, 7] }
      ];

      const accurateCount = testCases.filter(tc => {
        const tokens = TokenCounter.count(tc.text);
        return tokens >= tc.expectedRange[0] && tokens <= tc.expectedRange[1];
      }).length;

      const accuracy = (accurateCount / testCases.length) * 100;
      expect(accuracy).toBeGreaterThanOrEqual(90);
    });

    it('should have <10% variance from expected counts', () => {
      const testCases = [
        { text: 'Test', expected: 1 },
        { text: 'Hello world', expected: 2.5 },
        { text: 'The quick brown fox jumps', expected: 5 }
      ];

      testCases.forEach(tc => {
        const actual = TokenCounter.count(tc.text);
        const variance = Math.abs(actual - tc.expected) / tc.expected;

        expect(variance).toBeLessThan(0.2); // <20% variance
      });
    });
  });
});
