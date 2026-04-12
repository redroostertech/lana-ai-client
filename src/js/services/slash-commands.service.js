/**
 * Slash Commands Service
 *
 * Standalone registry of slash commands and NLQ patterns for the chat system.
 * Not wired into any UI yet — infrastructure kept for future integration with
 * lex-chat-composer as a command interceptor.
 *
 * Future integration point: lex-chat.composer.js can detect leading `/` in
 * input, call SlashCommandsService.execute(), and render the result as a
 * local-only assistant message (no backend round-trip).
 *
 * @requires none — self-contained, no API or DOM dependencies.
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
    '/summary': {
      description: 'Get a summary of a matter',
      usage: '/summary [matter name or ID]',
      handler: (args) => SlashCommandsService.getMatterSummary(args)
    },
    '/aging': {
      description: 'Show aging analysis for opportunities',
      usage: '/aging [zone: green|yellow|red]',
      handler: (args) => SlashCommandsService.getAgingInsight(args)
    },
    '/followup': {
      description: 'Get follow-up recommendations',
      usage: '/followup [client name]',
      handler: (args) => SlashCommandsService.getFollowupRecommendation(args)
    },
    '/revenue': {
      description: 'Show revenue forecast',
      usage: '/revenue [30|60|90]',
      handler: (args) => SlashCommandsService.getRevenueForecast(args)
    },
    '/search': {
      description: 'Search across matters and documents',
      usage: '/search [query]',
      handler: (args) => SlashCommandsService.searchContent(args)
    },
    '/noshow': {
      description: 'Show no-show predictions for today',
      usage: '/noshow',
      handler: () => SlashCommandsService.getNoShowPredictions()
    },
    '/staff': {
      description: 'Show staff productivity metrics',
      usage: '/staff [name]',
      handler: (args) => SlashCommandsService.getStaffMetrics(args)
    },
    '/workflow': {
      description: 'Get workflow status',
      usage: '/workflow [status|run] [workflow name]',
      handler: (args) => SlashCommandsService.getWorkflowInfo(args)
    },
    '/export': {
      description: 'Export data to CSV',
      usage: '/export [aging|attribution|staff]',
      handler: (args) => SlashCommandsService.exportData(args)
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

  async execute(input) {
    const { command, args } = this.parseCommand(input);
    const cmd = this.commands[command];

    if (!cmd) {
      return {
        success: false,
        message: `Unknown command: ${command}\n\nType /help to see available commands.`
      };
    }

    try {
      const result = await cmd.handler(args);
      return { success: true, message: result };
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
  // Command handlers — demo/placeholder responses
  // These will be replaced with real API-backed implementations when wired up.
  // ---------------------------------------------------------------------------

  getHelpText() {
    let help = '**Available Slash Commands:**\n\n';
    Object.entries(this.commands).forEach(([cmd, info]) => {
      help += `**${cmd}** - ${info.description}\n`;
      help += `Usage: \`${info.usage}\`\n\n`;
    });
    return help;
  },

  async getMatterSummary(query) {
    if (!query) return 'Please specify a matter name or ID. Usage: `/summary Johnson v. Smith`';
    return `**Matter Summary: ${query}**\n\n**Status:** Active\n**Type:** Personal Injury\n**Assigned To:** Sarah Martinez\n**Value:** $125,000\n\n**Recent Activity:**\n- Settlement discussion with insurance (1 hour ago)\n- Medical records received (2 weeks ago)\n\n**Next Steps:**\n- Counter-offer to insurance company\n- Client meeting scheduled for next week`;
  },

  async getAgingInsight(zone) {
    const zoneFilter = (zone || '').toLowerCase() || 'all';
    const zoneColors = { green: '0-7 days', yellow: '8-14 days', red: '15+ days' };
    if (zoneFilter !== 'all' && !zoneColors[zoneFilter]) {
      return 'Invalid zone. Use: `/aging green`, `/aging yellow`, or `/aging red`';
    }
    return `**Aging Analysis${zoneFilter !== 'all' ? ` - ${zoneFilter.toUpperCase()} Zone (${zoneColors[zoneFilter]})` : ''}**\n\n**Summary:**\n- Green Zone: 45 opportunities ($1.2M)\n- Yellow Zone: 23 opportunities ($567K)\n- Red Zone: 12 opportunities ($345K)\n\n**Recommendation:** Focus outreach on red zone opportunities to prevent further decay.`;
  },

  async getFollowupRecommendation(clientName) {
    if (!clientName) {
      return '**Follow-up Recommendations (Today)**\n\n**Urgent (Overdue):**\n1. Maria Garcia - Last contact 18 days ago\n2. Thomas Wilson - Consultation not scheduled\n\n**Due Today:**\n3. Robert Chen - 2nd follow-up email\n4. Lisa Johnson - Contract review reminder\n\nType `/followup [client name]` for specific recommendations.';
    }
    return `**Follow-up Recommendation for ${clientName}**\n\n**Last Contact:** 5 days ago (Yellow Zone)\n**Stage:** Consultation Completed\n**Value:** $35,000\n\n**Recommended Actions:**\n1. Send follow-up email with engagement letter\n2. Schedule retainer signing call`;
  },

  async getRevenueForecast(days) {
    const period = days || '30';
    if (!['30', '60', '90'].includes(period)) {
      return 'Invalid period. Use: `/revenue 30`, `/revenue 60`, or `/revenue 90`';
    }
    const forecasts = {
      '30': { value: '$245,000', confidence: '92%', change: '+15%' },
      '60': { value: '$567,000', confidence: '85%', change: '+12%' },
      '90': { value: '$892,000', confidence: '78%', change: '+18%' }
    };
    const f = forecasts[period];
    return `**Revenue Forecast - ${period} Days**\n\n**Projected Revenue:** ${f.value}\n**Confidence Level:** ${f.confidence}\n**vs. Prior Period:** ${f.change}`;
  },

  async searchContent(query) {
    if (!query) return 'Please provide a search query. Usage: `/search [query]`';
    return `**Search Results for "${query}"**\n\n**Matters (3 found):**\n1. Johnson v. Smith - Personal Injury - Active\n2. Anderson Contract Review - Business - Completed\n\n**Documents (5 found):**\n1. Settlement_Agreement_Draft.pdf\n2. Engagement_Letter_Template.docx`;
  },

  async getNoShowPredictions() {
    return '**No-Show Predictions for Today**\n\n**High Risk (60%+ probability):**\n1. **Michael Torres** - 2:00 PM - 72% risk\n2. **Sarah Kim** - 3:30 PM - 65% risk\n\n**Suggested Actions:**\n- Send reminder texts to high-risk appointments\n- Have virtual meeting links ready';
  },

  async getStaffMetrics(name) {
    if (!name) {
      return '**Staff Productivity Overview**\n\n| Staff Member | Completion | Conversion | Revenue |\n|-------------|-----------|-----------|----------|\n| Sarah Martinez | 94% | 78% | $245K |\n| Michael Chen | 89% | 82% | $198K |\n\nType `/staff [name]` for detailed metrics.';
    }
    return `**Staff Metrics: ${name}**\n\n**Performance Scores:**\n- Completion Rate: 94%\n- Conversion Rate: 78%\n- Avg Response Time: 2.3 hours\n\n**Trend:** +12% improvement from last month`;
  },

  async getWorkflowInfo(args) {
    const parts = (args || '').split(/\s+/);
    const action = (parts[0] || '').toLowerCase();
    const workflowName = parts.slice(1).join(' ');
    if (!action || action === 'status') {
      return '**Workflow Status Overview**\n\n**Active Workflows:** 4\n**Paused:** 1\n**Error:** 1\n\nType `/workflow run [name]` to trigger a workflow.';
    }
    if (action === 'run') {
      if (!workflowName) return 'Please specify a workflow name. Usage: `/workflow run Follow-up Cadence`';
      return `**Workflow Triggered: ${workflowName}**\n\nStatus: Running...\nStarted: Just now`;
    }
    return 'Unknown workflow action. Use: `/workflow status` or `/workflow run [name]`';
  },

  async exportData(type) {
    const validTypes = ['aging', 'attribution', 'staff'];
    if (!type || !validTypes.includes(type.toLowerCase())) {
      return `Please specify export type. Options: ${validTypes.join(', ')}\n\nUsage: \`/export aging\``;
    }
    const date = new Date().toISOString().split('T')[0];
    return `**Export Started: ${type}**\n\nYour ${type} report is being generated...\n\nFile: ${type}_report_${date}.csv`;
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
    { regex: /show me (?:the )?(aging|stale|cold) (leads?|opportunities?)/i, handler: () => SlashCommandsService.getAgingInsight('red') },
    // 2 — Revenue/forecast ("what's our revenue projection")
    { regex: /what.*(revenue|forecast|projection)/i, handler: () => SlashCommandsService.getRevenueForecast('30') },
    // 3 — No-shows ("who will no-show")
    { regex: /who.*(no[ -]?show|miss|skip)/i, handler: () => SlashCommandsService.getNoShowPredictions() },
    // 4 — Follow-ups ("which clients need follow-up")
    { regex: /(?:what|which) (clients?|leads?) (?:need|require) follow[ -]?up/i, handler: () => SlashCommandsService.getFollowupRecommendation() },
    // 5 — Summaries ("summarize", "tell me about") — broad, keep below specific patterns
    { regex: /summarize|summary of|tell me about/i, handler: (m, input) => SlashCommandsService.getMatterSummary(input.replace(/summarize|summary of|tell me about/gi, '').trim()) },
    // 6 — Staff performance ("how is Sarah performing")
    { regex: /how is (\w+) (performing|doing)/i, handler: (m) => SlashCommandsService.getStaffMetrics(m[1]) },
    // 7 — Search (catch-all, must be last) — ("search for", "find", "look for")
    { regex: /(?:search|find|look for) (.+)/i, handler: (m) => SlashCommandsService.searchContent(m[1]) }
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
    const counts = {
      lead: { total: 234, new: 45, active: 189 },
      opportunity: { total: 156, green: 78, yellow: 45, red: 33 },
      client: { total: 89, active: 72, closed: 17 },
      matter: { total: 145, open: 98, pending: 32, closed: 15 }
    };
    const type = entityType.toLowerCase().replace(/s$/, '');
    const data = counts[type] || counts.lead;
    return `**${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Count**\n\n**Total:** ${data.total}\n\n**Breakdown:**\n${Object.entries(data).filter(([k]) => k !== 'total').map(([k, v]) => `- ${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`).join('\n')}`;
  }
};

if (typeof window !== 'undefined') {
  window.SlashCommandsService = SlashCommandsService;
  window.NLQProcessor = NLQProcessor;
}
