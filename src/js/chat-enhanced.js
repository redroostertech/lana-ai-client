/**
 * Enhanced Chat Module - Extends LanaChat with Slash Commands and NLQ
 * Provides advanced chat capabilities including:
 * - Slash commands for quick actions
 * - Natural Language Query (NLQ) processing
 * - Quick insights integration
 * - Matter context awareness
 */

// Slash Command Registry
const SlashCommands = {
  commands: {
    '/help': {
      description: 'Show available commands',
      usage: '/help',
      handler: () => SlashCommands.getHelpText()
    },
    '/summary': {
      description: 'Get a summary of a matter',
      usage: '/summary [matter name or ID]',
      handler: (args) => SlashCommands.getMatterSummary(args)
    },
    '/aging': {
      description: 'Show aging analysis for opportunities',
      usage: '/aging [zone: green|yellow|red]',
      handler: (args) => SlashCommands.getAgingInsight(args)
    },
    '/followup': {
      description: 'Get follow-up recommendations',
      usage: '/followup [client name]',
      handler: (args) => SlashCommands.getFollowupRecommendation(args)
    },
    '/revenue': {
      description: 'Show revenue forecast',
      usage: '/revenue [30|60|90]',
      handler: (args) => SlashCommands.getRevenueForecast(args)
    },
    '/search': {
      description: 'Search across matters and documents',
      usage: '/search [query]',
      handler: (args) => SlashCommands.searchContent(args)
    },
    '/noshow': {
      description: 'Show no-show predictions for today',
      usage: '/noshow',
      handler: () => SlashCommands.getNoShowPredictions()
    },
    '/staff': {
      description: 'Show staff productivity metrics',
      usage: '/staff [name]',
      handler: (args) => SlashCommands.getStaffMetrics(args)
    },
    '/workflow': {
      description: 'Get workflow status',
      usage: '/workflow [status|run] [workflow name]',
      handler: (args) => SlashCommands.getWorkflowInfo(args)
    },
    '/export': {
      description: 'Export data to CSV',
      usage: '/export [aging|attribution|staff]',
      handler: (args) => SlashCommands.exportData(args)
    }
  },

  isSlashCommand(input) {
    return input.trim().startsWith('/');
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

  getHelpText() {
    let help = '**Available Slash Commands:**\n\n';
    Object.entries(this.commands).forEach(([cmd, info]) => {
      help += `**${cmd}** - ${info.description}\n`;
      help += `Usage: \`${info.usage}\`\n\n`;
    });
    return help;
  },

  async getMatterSummary(query) {
    if (!query) {
      return 'Please specify a matter name or ID. Usage: `/summary Johnson v. Smith`';
    }
    // Demo response
    return `**Matter Summary: ${query}**

**Status:** Active
**Type:** Personal Injury
**Assigned To:** Sarah Martinez
**Value:** $125,000

**Recent Activity:**
- Settlement discussion with insurance (1 hour ago)
- Medical records received (2 weeks ago)
- Status moved to Negotiation stage (1 month ago)

**Next Steps:**
- Counter-offer to insurance company
- Client meeting scheduled for next week`;
  },

  async getAgingInsight(zone) {
    const zoneFilter = zone?.toLowerCase() || 'all';
    const zoneColors = { green: '0-7 days', yellow: '8-14 days', red: '15+ days' };

    if (zoneFilter !== 'all' && !zoneColors[zoneFilter]) {
      return 'Invalid zone. Use: `/aging green`, `/aging yellow`, or `/aging red`';
    }

    return `**Aging Analysis${zoneFilter !== 'all' ? ` - ${zoneFilter.toUpperCase()} Zone (${zoneColors[zoneFilter]})` : ''}**

**Summary:**
- Green Zone: 45 opportunities ($1.2M)
- Yellow Zone: 23 opportunities ($567K)
- Red Zone: 12 opportunities ($345K)

**Top Priority (Red Zone):**
1. Maria Garcia - Personal Injury - 18 days idle - $45,000
2. Thomas Wilson - Medical Malpractice - 22 days idle - $125,000
3. Jennifer Lee - Workers Comp - 16 days idle - $35,000

**Recommendation:** Focus outreach on red zone opportunities to prevent further decay.`;
  },

  async getFollowupRecommendation(clientName) {
    if (!clientName) {
      return `**Follow-up Recommendations (Today)**

**Urgent (Overdue):**
1. Maria Garcia - Last contact 18 days ago
2. Thomas Wilson - Consultation not scheduled

**Due Today:**
3. Robert Chen - 2nd follow-up email
4. Lisa Johnson - Contract review reminder

Type \`/followup [client name]\` for specific recommendations.`;
    }

    return `**Follow-up Recommendation for ${clientName}**

**Last Contact:** 5 days ago (Yellow Zone)
**Stage:** Consultation Completed
**Value:** $35,000

**Recommended Actions:**
1. Send follow-up email with engagement letter
2. Schedule retainer signing call
3. Add to automated cadence if no response in 48h

**Suggested Message:**
"Hi ${clientName.split(' ')[0]}, I wanted to follow up on our consultation. Have you had a chance to review the engagement letter?"`;
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
    return `**Revenue Forecast - ${period} Days**

**Projected Revenue:** ${f.value}
**Confidence Level:** ${f.confidence}
**vs. Prior Period:** ${f.change}

**Key Drivers:**
- 3 cases expected to close this month
- Settlement negotiations in progress for 2 high-value matters
- Strong pipeline in consultation stage

**Risk Factors:**
- 2 clients showing signs of going cold
- Insurance negotiation delays possible`;
  },

  async searchContent(query) {
    if (!query) {
      return 'Please provide a search query. Usage: `/search [query]`';
    }

    return `**Search Results for "${query}"**

**Matters (3 found):**
1. Johnson v. Smith - Personal Injury - Active
2. Anderson Contract Review - Business - Completed
3. Smith Estate Planning - Estate - Pending

**Documents (5 found):**
1. Settlement_Agreement_Draft.pdf (Johnson v. Smith)
2. Engagement_Letter_Template.docx (Templates)
3. Medical_Records_Summary.pdf (Johnson v. Smith)

**Communications (8 found):**
- 3 emails mentioning "${query}"
- 5 notes referencing "${query}"

[View full results in Search →](../search.html?q=${encodeURIComponent(query)})`;
  },

  async getNoShowPredictions() {
    return `**No-Show Predictions for Today**

**High Risk (60%+ probability):**
1. **Michael Torres** - 2:00 PM - 72% risk
   - Factors: Previous no-show, no confirmation
   - Action: Send SMS reminder now

2. **Sarah Kim** - 3:30 PM - 65% risk
   - Factors: Long drive distance, weather
   - Action: Offer video consultation option

**Medium Risk (40-60%):**
3. **David Chen** - 10:00 AM - 45% risk
   - Factors: New lead, no prior engagement
   - Action: Confirmation call recommended

**Suggested Actions:**
- Send reminder texts to high-risk appointments
- Prepare backup consultation slots
- Have virtual meeting links ready`;
  },

  async getStaffMetrics(name) {
    if (!name) {
      return `**Staff Productivity Overview**

| Staff Member | Completion | Conversion | Revenue |
|-------------|-----------|-----------|---------|
| Sarah Martinez | 94% | 78% | $245K |
| Michael Chen | 89% | 82% | $198K |
| Jennifer Lee | 91% | 75% | $167K |

**Top Performer:** Michael Chen (highest conversion)
**Most Revenue:** Sarah Martinez ($245K this month)

Type \`/staff [name]\` for detailed metrics.`;
    }

    return `**Staff Metrics: ${name}**

**Performance Scores:**
- Completion Rate: 94%
- Conversion Rate: 78%
- Avg Response Time: 2.3 hours

**This Month:**
- Follow-ups Completed: 45/48
- Consultations Booked: 23
- Clients Signed: 8
- Revenue Generated: $245,000

**Trend:** +12% improvement from last month
**Recognition:** Top performer in client satisfaction`;
  },

  async getWorkflowInfo(args) {
    const parts = args?.split(/\s+/) || [];
    const action = parts[0]?.toLowerCase();
    const workflowName = parts.slice(1).join(' ');

    if (!action || action === 'status') {
      return `**Workflow Status Overview**

**Active Workflows:** 4
**Paused:** 1
**Error:** 1

**Recent Executions:**
1. Follow-up Cadence - Green Zone ✓ (1 hour ago)
2. Welcome Email Sequence ✓ (30 min ago)
3. Red Zone Alert ✗ Error (2 days ago)

**Needs Attention:**
- Red Zone Alert: Email service connection failed

Type \`/workflow run [name]\` to trigger a workflow.`;
    }

    if (action === 'run') {
      if (!workflowName) {
        return 'Please specify a workflow name. Usage: `/workflow run Follow-up Cadence`';
      }
      return `**Workflow Triggered: ${workflowName}**

Status: Running...
Started: Just now
Expected Duration: ~30 seconds

I'll notify you when it completes.

*Workflow completed! Processed 12 records successfully.*`;
    }

    return 'Unknown workflow action. Use: `/workflow status` or `/workflow run [name]`';
  },

  async exportData(type) {
    const validTypes = ['aging', 'attribution', 'staff'];
    if (!type || !validTypes.includes(type.toLowerCase())) {
      return `Please specify export type. Options: ${validTypes.join(', ')}\n\nUsage: \`/export aging\``;
    }

    return `**Export Started: ${type}**

Your ${type} report is being generated...

✓ Export complete!
📎 File: ${type}_report_${new Date().toISOString().split('T')[0]}.csv

The file has been downloaded to your browser.`;
  }
};

// Natural Language Query Processor
const NLQProcessor = {
  patterns: [
    {
      regex: /how many (leads?|opportunities?|clients?|matters?)/i,
      handler: (match) => NLQProcessor.countEntities(match[1])
    },
    {
      regex: /show me (?:the )?(aging|stale|cold) (leads?|opportunities?)/i,
      handler: () => SlashCommands.getAgingInsight('red')
    },
    {
      regex: /what.*(revenue|forecast|projection)/i,
      handler: () => SlashCommands.getRevenueForecast('30')
    },
    {
      regex: /who.*(no[ -]?show|miss|skip)/i,
      handler: () => SlashCommands.getNoShowPredictions()
    },
    {
      regex: /(?:what|which) (clients?|leads?) (?:need|require) follow[ -]?up/i,
      handler: () => SlashCommands.getFollowupRecommendation()
    },
    {
      regex: /summarize|summary of|tell me about/i,
      handler: (match, input) => {
        const matter = input.replace(/summarize|summary of|tell me about/gi, '').trim();
        return SlashCommands.getMatterSummary(matter);
      }
    },
    {
      regex: /how is (\w+) (performing|doing)/i,
      handler: (match) => SlashCommands.getStaffMetrics(match[1])
    },
    {
      regex: /(?:search|find|look for) (.+)/i,
      handler: (match) => SlashCommands.searchContent(match[1])
    }
  ],

  canProcess(input) {
    return this.patterns.some(p => p.regex.test(input));
  },

  async process(input) {
    for (const pattern of this.patterns) {
      const match = input.match(pattern.regex);
      if (match) {
        return await pattern.handler(match, input);
      }
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

    return `**${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Count**

**Total:** ${data.total}

**Breakdown:**
${Object.entries(data).filter(([k]) => k !== 'total').map(([k, v]) => `- ${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`).join('\n')}

*Data as of ${new Date().toLocaleString()}*`;
  }
};

// Enhanced Chat Class
class LanaChatEnhanced extends LanaChat {
  constructor(options = {}) {
    super(options);
    this.slashCommands = SlashCommands;
    this.nlqProcessor = NLQProcessor;
    this.enhancedInit();
  }

  enhancedInit() {
    // Add slash command autocomplete
    this.setupAutocomplete();
    // Update suggestions
    this.updateSuggestions();
  }

  setupAutocomplete() {
    const input = this.container?.querySelector('#chatInput');
    if (!input) return;

    // Create autocomplete dropdown
    const autocomplete = document.createElement('div');
    autocomplete.id = 'slashAutocomplete';
    autocomplete.className = 'absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg hidden max-h-48 overflow-y-auto z-50';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(autocomplete);

    input.addEventListener('input', () => {
      const value = input.value;
      if (value.startsWith('/') && !value.includes(' ')) {
        this.showAutocomplete(value);
      } else {
        this.hideAutocomplete();
      }
    });

    autocomplete.addEventListener('click', (e) => {
      const item = e.target.closest('.autocomplete-item');
      if (item) {
        input.value = item.dataset.command + ' ';
        input.focus();
        this.hideAutocomplete();
      }
    });
  }

  showAutocomplete(prefix) {
    const autocomplete = this.container?.querySelector('#slashAutocomplete');
    if (!autocomplete) return;

    const matches = Object.entries(this.slashCommands.commands)
      .filter(([cmd]) => cmd.startsWith(prefix.toLowerCase()));

    if (matches.length === 0) {
      this.hideAutocomplete();
      return;
    }

    autocomplete.innerHTML = matches.map(([cmd, info]) => `
      <div class="autocomplete-item px-4 py-2 hover:bg-gray-100 cursor-pointer" data-command="${cmd}">
        <p class="font-medium text-gray-900 text-sm">${cmd}</p>
        <p class="text-xs text-gray-500">${info.description}</p>
      </div>
    `).join('');

    autocomplete.classList.remove('hidden');
  }

  hideAutocomplete() {
    const autocomplete = this.container?.querySelector('#slashAutocomplete');
    if (autocomplete) {
      autocomplete.classList.add('hidden');
    }
  }

  updateSuggestions() {
    const suggestionsEl = this.container?.querySelector('#chatSuggestions');
    if (!suggestionsEl) return;

    suggestionsEl.innerHTML = `
      <div class="flex flex-wrap gap-2">
        <button class="chat-suggestion px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs hover:bg-gray-200 transition" data-suggestion="/help">
          /help
        </button>
        <button class="chat-suggestion px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs hover:bg-gray-200 transition" data-suggestion="What leads need follow-up?">
          Follow-ups needed
        </button>
        <button class="chat-suggestion px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs hover:bg-gray-200 transition" data-suggestion="/revenue 30">
          Revenue forecast
        </button>
        <button class="chat-suggestion px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs hover:bg-gray-200 transition" data-suggestion="/aging red">
          Red zone leads
        </button>
      </div>
    `;

    // Re-bind suggestion events
    const suggestions = suggestionsEl.querySelectorAll('.chat-suggestion');
    const input = this.container?.querySelector('#chatInput');
    suggestions.forEach(btn => {
      btn.addEventListener('click', () => {
        const suggestion = btn.dataset.suggestion;
        if (suggestion && input) {
          input.value = suggestion;
          this.sendMessage();
        }
      });
    });
  }

  async sendMessage() {
    const input = this.container?.querySelector('#chatInput');
    const content = input?.value.trim();

    if (!content) return;

    // Check if it's a slash command
    if (this.slashCommands.isSlashCommand(content)) {
      this.addMessage('user', content);
      input.value = '';
      this.hideAutocomplete();

      this.showTypingIndicator();
      const result = await this.slashCommands.execute(content);

      setTimeout(() => {
        this.hideTypingIndicator();
        this.addMessage('assistant', result.message);
      }, 500);

      return;
    }

    // Check if NLQ can handle it
    if (this.nlqProcessor.canProcess(content)) {
      this.addMessage('user', content);
      input.value = '';

      this.showTypingIndicator();
      const result = await this.nlqProcessor.process(content);

      setTimeout(() => {
        this.hideTypingIndicator();
        if (result) {
          this.addMessage('assistant', result);
        } else {
          // Fall back to regular chat
          super.simulateDemoResponse(content);
        }
      }, 800);

      return;
    }

    // Fall back to parent implementation
    super.sendMessage();
  }

  renderWelcomeMessage() {
    return `
      <div class="flex items-start space-x-3">
        <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
          </svg>
        </div>
        <div class="flex-1">
          <div class="bg-gray-100 rounded-2xl rounded-tl-none px-4 py-3">
            <p class="text-gray-800 text-sm">Hello! I'm Lana, your AI legal assistant.</p>
            <p class="text-gray-600 text-sm mt-2">I can help you with:</p>
            <ul class="list-disc list-inside text-gray-600 text-sm mt-1 space-y-1">
              <li>Quick insights (try <code class="bg-gray-200 px-1 rounded">/aging</code> or <code class="bg-gray-200 px-1 rounded">/revenue</code>)</li>
              <li>Natural language questions</li>
              <li>Matter summaries and search</li>
              <li>Follow-up recommendations</li>
            </ul>
            <p class="text-xs text-indigo-600 mt-2">Type <code class="bg-indigo-100 px-1 rounded">/help</code> for all commands!</p>
          </div>
        </div>
      </div>
    `;
  }
}

// Export
window.LanaChatEnhanced = LanaChatEnhanced;
window.SlashCommands = SlashCommands;
window.NLQProcessor = NLQProcessor;
