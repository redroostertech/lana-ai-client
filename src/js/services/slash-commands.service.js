/**
 * Slash Commands Service
 *
 * Standalone registry of slash commands for the chat system.
 *
 * The registry is local so autocomplete and /help stay instant. Command
 * execution is API-backed for every command except /help; the old demo
 * markdown must not be returned as if it were real organization data.
 */

const SlashCommandsService = {

  // ---------------------------------------------------------------------------
  // Command registry — each entry: { description, usage, handler(args) }
  // Handlers return a markdown string (the "response").
  // ---------------------------------------------------------------------------

  commands: {
    '/help': {
      description: 'Show available commands',
      usage: '/help',
      handler: () => SlashCommandsService.getHelpText()
    },
    '/me': {
      description: 'Show your profile and acquired memories',
      usage: '/me'
    },
    '/my-org': {
      description: 'Show your organization profile',
      usage: '/my-org'
    },
    '/tasks': {
      description: 'Show recent tasks to focus on',
      usage: '/tasks'
    },
    '/summary': {
      description: 'Get a summary of a matter',
      usage: '/summary [matter name or ID]'
    },
    '/aging': {
      description: 'Show aging analysis for opportunities',
      usage: '/aging [zone: green|yellow|red]'
    },
    '/followup': {
      description: 'Get follow-up recommendations',
      usage: '/followup [client name]'
    },
    '/revenue': {
      description: 'Show revenue forecast',
      usage: '/revenue [30|60|90]'
    },
    '/search': {
      description: 'Search across matters and documents',
      usage: '/search [query]'
    },
    '/noshow': {
      description: 'Show no-show predictions for today',
      usage: '/noshow'
    },
    '/staff': {
      description: 'Show staff productivity metrics',
      usage: '/staff [name]'
    },
    '/workflow': {
      description: 'Get workflow status',
      usage: '/workflow [status|run] [workflow name]'
    },
    '/export': {
      description: 'Export data to CSV',
      usage: '/export [aging|attribution|staff]'
    }
  },

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  isSlashCommand(input) {
    return typeof input === 'string' && input.trim().startsWith('/');
  },

  parseCommand(input) {
    const parts = input.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    return { command, args };
  },

  requiresBackend(command) {
    return String(command || '').toLowerCase() !== '/help';
  },

  async execute(input, options = {}) {
    const { command, args } = this.parseCommand(input);
    const cmd = this.commands[command];

    if (!cmd) {
      return {
        success: false,
        message: `Unknown command: ${command}\n\nType /help to see available commands.`
      };
    }

    try {
      if (!this.requiresBackend(command)) {
        const result = await cmd.handler(args);
        return { success: true, message: result };
      }

      const api = options.api || (typeof window !== 'undefined' ? window.api : null);
      const conversationId = options.conversationId;
      if (!api || !conversationId) {
        return {
          success: false,
          message: `${command} is available, but it needs an active LANA connection before it can run.`
        };
      }

      const response = typeof api.executeConversationSlashCommand === 'function'
        ? await api.executeConversationSlashCommand(conversationId, command, args)
        : await api.post(`/api/chat/conversations/${encodeURIComponent(conversationId)}/slash-command`, { command, args });
      const result = response && (response.result || response.data || response);
      const message = (result && (result.message || result.error)) || 'Command completed.';
      return {
        success: result ? result.success !== false : true,
        message,
        data: result && result.data,
        renderAs: result && result.renderAs,
        raw: result
      };
    } catch (error) {
      return {
        success: false,
        message: `Error executing ${command}: ${error.message}`
      };
    }
  },

  getMatchingCommands(partial) {
    if (!partial || !partial.startsWith('/')) return [];
    const lower = partial.toLowerCase();
    return Object.entries(this.commands)
      .filter(([cmd]) => cmd.startsWith(lower))
      .map(([cmd, info]) => ({ command: cmd, description: info.description, usage: info.usage }));
  },

  // ---------------------------------------------------------------------------
  // Local command handlers
  // ---------------------------------------------------------------------------

  getHelpText() {
    let help = '**Available Slash Commands:**\n\n';
    Object.entries(this.commands).forEach(([cmd, info]) => {
      help += `**${cmd}** - ${info.description}\n`;
      help += `Usage: \`${info.usage}\`\n\n`;
    });
    return help;
  },

  async explainBackendOnly(command) {
    return `${command} is handled by LANA's backend command registry. Open a connected chat to run it.`;
  }
};

// ---------------------------------------------------------------------------
// NLQ (Natural Language Query) Processor
// Pattern-based detection for common legal practice queries.
//
// PRIORITY: Patterns are evaluated top-to-bottom. The first match wins.
// "summarize revenue forecast" → matches "revenue" (index 2), not "summarize" (index 5).
// If priority ordering matters for a new pattern, insert it above competing entries.
// ---------------------------------------------------------------------------

const NLQProcessor = {
  patterns: [
    // 0 — Entity counts ("how many leads/clients/matters")
    { regex: /how many (leads?|opportunities?|clients?|matters?)/i, handler: (m) => NLQProcessor.countEntities(m[1]) },
    // 1 — Aging/stale leads ("show me aging opportunities")
    { regex: /show me (?:the )?(aging|stale|cold) (leads?|opportunities?)/i, handler: () => SlashCommandsService.explainBackendOnly('/aging') },
    // 2 — Revenue/forecast ("what's our revenue projection")
    { regex: /what.*(revenue|forecast|projection)/i, handler: () => SlashCommandsService.explainBackendOnly('/revenue') },
    // 3 — No-shows ("who will no-show")
    { regex: /who.*(no[ -]?show|miss|skip)/i, handler: () => SlashCommandsService.explainBackendOnly('/noshow') },
    // 4 — Follow-ups ("which clients need follow-up")
    { regex: /(?:what|which) (clients?|leads?) (?:need|require) follow[ -]?up/i, handler: () => SlashCommandsService.explainBackendOnly('/followup') },
    // 5 — Summaries ("summarize", "tell me about") — broad, keep below specific patterns
    { regex: /summarize|summary of|tell me about/i, handler: () => SlashCommandsService.explainBackendOnly('/summary') },
    // 6 — Staff performance ("how is Sarah performing")
    { regex: /how is (\w+) (performing|doing)/i, handler: () => SlashCommandsService.explainBackendOnly('/staff') },
    // 7 — Search (catch-all, must be last) — ("search for", "find", "look for")
    { regex: /(?:search|find|look for) (.+)/i, handler: () => SlashCommandsService.explainBackendOnly('/search') }
  ],

  canProcess(input) {
    return this.patterns.some(p => p.regex.test(input));
  },

  async process(input) {
    for (const pattern of this.patterns) {
      const match = input.match(pattern.regex);
      if (match) return await pattern.handler(match, input);
    }
    return null;
  },

  async countEntities(entityType) {
    return SlashCommandsService.explainBackendOnly('/search');
  }
};

if (typeof window !== 'undefined') {
  window.SlashCommandsService = SlashCommandsService;
  window.NLQProcessor = NLQProcessor;
}
