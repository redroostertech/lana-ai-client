'use strict';

class TokenCounter {
  static count(text) {
    if (typeof text !== 'string' || text.length === 0) return 0;
    const normalized = text.trim();
    if (!normalized) return 0;

    const words = normalized.split(/\s+/).filter(Boolean);
    const punctuation = (normalized.match(/[^\s\w]/gu) || []).length;
    const unicodeExtra = (normalized.match(/[^\u0000-\u007F]/gu) || []).length;

    // Keep the estimator dependency-free, but do not rely on whitespace alone:
    // URLs, email addresses, JSON, code, and long legal prose contain multiple
    // subword tokens inside a single whitespace-delimited unit. The character
    // estimate tracks the observed English/code average while the word estimate
    // preserves accurate counts for short plain-language prompts.
    const numericFragments = (normalized.match(/\d+/g) || []).length;
    const wordEstimate = Math.ceil(
      words.length
      + punctuation * 0.25
      + unicodeExtra * 0.5
      + numericFragments * 0.5
    );
    const characterEstimate = Math.round(normalized.length / 4.75);
    return Math.max(1, wordEstimate, characterEstimate);
  }

  static countMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    return messages.reduce((total, message) => {
      if (!message || typeof message.content !== 'string') return total;
      return total + TokenCounter.count(message.content) + 1;
    }, 0);
  }

  static truncate(text, maxTokens) {
    if (typeof text !== 'string' || text.length === 0) return '';
    const limit = Math.max(0, Number(maxTokens) || 0);
    if (limit <= 0) return '';
    if (TokenCounter.count(text) <= limit) return text;

    const suffix = limit <= 1 ? '' : '...';
    const suffixTokens = TokenCounter.count(suffix);
    const target = Math.max(1, limit - suffixTokens);
    const words = text.trim().split(/\s+/).filter(Boolean);
    let out = '';

    for (const word of words) {
      const candidate = out ? `${out} ${word}` : word;
      if (TokenCounter.count(candidate) > target) break;
      out = candidate;
    }

    if (!out) {
      out = text.slice(0, Math.max(1, Math.floor(text.length * (target / TokenCounter.count(text)))));
    }

    return `${out.trim()}${suffix}`;
  }

  static breakdown(components = {}) {
    const system = TokenCounter.count(components.systemContext);
    const rag = TokenCounter.count(components.ragContext);
    const history = TokenCounter.countMessages(components.conversationHistory);
    const current = TokenCounter.count(components.currentMessage);
    return {
      system,
      rag,
      history,
      current,
      total: system + rag + history + current
    };
  }
}

module.exports = { TokenCounter };
