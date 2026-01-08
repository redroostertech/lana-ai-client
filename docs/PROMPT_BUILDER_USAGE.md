# Prompt Builder Service - Usage Guide

The prompt builder service provides a **declarative, composable** way to build AI prompts for different flows.

## Philosophy

- **Components** are reusable building blocks (identity, rules, capabilities)
- **Builders** combine components for specific flows (agentic, document, simple)
- **Formatting** is consistent and centralized
- **Easy to extend** with new flows or components

## Quick Start

```javascript
const promptBuilder = require('./shared/services/prompt-builder.service');
const systemContextService = require('./shared/context/system-context.service');

// 1. Build system context (runtime data)
const systemContext = await systemContextService.build({
  user,
  matterId,
  threadId
});

// 2. Build complete prompt for your flow
const fullPrompt = promptBuilder.buildCompletePrompt(
  'agentic',           // Flow type: 'agentic' | 'document' | 'simple' | 'custom'
  systemContext.context, // Runtime context
  {                    // Session info
    tools: scopedTools,
    attachments,
    documentCount,
    matterId
  }
);
```

## Available Flows

### 1. **Agentic Flow** (Full-Featured)
Use for: General chat, complex queries, multi-tool workflows

```javascript
// Option 1: Just the base prompt
const basePrompt = promptBuilder.buildAgenticPrompt();

// Option 2: Complete prompt with context and session info
const fullPrompt = promptBuilder.buildCompletePrompt('agentic', systemContext, sessionInfo);
```

**Includes:**
- ✅ Identity and unique value
- ✅ All capabilities (memory, tools, cross-system intelligence)
- ✅ Prioritization hierarchy
- ✅ Critical rules and guidelines
- ✅ Communication style
- ✅ Examples and best practices

### 2. **Document Chat Flow** (Document-Focused)
Use for: Document analysis, document Q&A, document comparison

```javascript
const documentPrompt = promptBuilder.buildCompletePrompt('document', systemContext, sessionInfo);
```

**Includes:**
- ✅ Identity
- ✅ Document-specific rules (cite sources, quote accurately)
- ✅ Critical rules (no hallucination)
- ✅ Communication style

**Excludes:**
- ❌ Cross-system intelligence (not needed for document focus)
- ❌ Prioritization hierarchy (documents are the only context)
- ❌ Tool usage examples (simpler tool set)

### 3. **Simple Chat Flow** (Quick Q&A)
Use for: Fast responses, simple queries, context-only answers

```javascript
const simplePrompt = promptBuilder.buildCompletePrompt('simple', systemContext, sessionInfo);
```

**Includes:**
- ✅ Identity
- ✅ Simple response guidelines
- ✅ Communication style

**Excludes:**
- ❌ Complex capabilities
- ❌ Prioritization rules
- ❌ Extensive examples

### 4. **Custom Flow** (Mix Your Own)
Build custom prompts by selecting specific components

```javascript
const customPrompt = promptBuilder.buildCustomPrompt([
  'identity',
  'documentFocusedRules',
  'criticalRules',
  'accessAndCapabilities',
  'communicationStyle'
]);
```

## Available Components

All components are accessible via `PromptComponents`:

```javascript
const { PromptComponents } = require('./shared/services/prompt-builder.service');

// Mix and match as needed
const myPrompt = `
${PromptComponents.identity()}

${PromptComponents.criticalRules()}

${PromptComponents.communicationStyle()}
`;
```

**Available Components:**
- `identity()` - Core identity and introduction
- `uniqueValue()` - Unique value proposition
- `accessAndCapabilities()` - What the AI has access to
- `prioritizationHierarchy()` - How to prioritize queries
- `roleAndIntelligence()` - Cross-system intelligence role
- `criticalRules()` - Never violate rules
- `coreGuidelines()` - Behavioral guidelines
- `intelligentAnalysisExamples()` - Example queries
- `communicationStyle()` - How to communicate
- `documentFocusedRules()` - Document-specific rules
- `simpleChatRules()` - Simple chat rules

## Formatting Utilities

### Add System Context

```javascript
const basePrompt = promptBuilder.buildAgenticPrompt();
const fullPrompt = promptBuilder.addSystemContext(basePrompt, systemContext);
```

### Add Session Info

```javascript
const promptWithSession = promptBuilder.addSessionInfo(fullPrompt, {
  tools: scopedTools,
  attachments: { files: [...] },
  documentCount: 5,
  matterId: 'matter-123'
});
```

## Migration Guide

### Before (Old Way)

```javascript
const systemPromptService = require('./system-prompt.service');

// Get base prompt
const basePrompt = systemPromptService.BASE_SYSTEM_PROMPT;

// Build in performant-agent.js
const prompt = this.buildRichSystemPrompt(session, tools);
```

### After (New Way)

```javascript
const promptBuilder = require('./prompt-builder.service');

// Choose your flow
const basePrompt = promptBuilder.buildAgenticPrompt(); // or document, simple

// Build complete prompt
const fullPrompt = promptBuilder.buildCompletePrompt(
  'agentic',
  systemContext,
  sessionInfo
);
```

## Example: Update performant-agent.js

```javascript
// OLD
buildRichSystemPrompt(session, tools) {
  let prompt = systemPromptService.BASE_SYSTEM_PROMPT;
  prompt += `\n\n--- SYSTEM CONTEXT ---\n${systemContext}`;
  // ... manual formatting ...
  return prompt;
}

// NEW
buildRichSystemPrompt(session, tools) {
  const { systemContext, attachments, documentCount, effectiveMatterId } = session;
  
  return promptBuilder.buildCompletePrompt(
    'agentic',
    systemContext,
    {
      tools,
      attachments,
      documentCount,
      matterId: effectiveMatterId
    }
  );
}
```

## Adding New Flows

To add a new flow:

1. **Add components** (if needed) to `PromptComponents`
2. **Add builder** to `PromptBuilders`
3. **Update switch statement** in `FormatUtils.buildCompletePrompt`

Example: Adding a "Research" flow

```javascript
// 1. Add component
PromptComponents.researchFocusedRules() {
  return `## Research Guidelines
  - Focus on finding accurate information
  - Cite all sources
  - Present multiple perspectives
  ...`;
}

// 2. Add builder
PromptBuilders.buildResearchPrompt() {
  const components = [
    PromptComponents.identity(),
    PromptComponents.researchFocusedRules(),
    PromptComponents.criticalRules(),
    PromptComponents.communicationStyle()
  ];
  return components.join('\n\n');
}

// 3. Update switch in buildCompletePrompt
case 'research':
  basePrompt = PromptBuilders.buildResearchPrompt();
  break;
```

## Best Practices

1. **Use the right flow** for your use case
   - Agentic: Complex queries, multi-step reasoning
   - Document: Document analysis only
   - Simple: Quick Q&A with existing context

2. **Keep components focused** - Each component should have a single responsibility

3. **Reuse components** - Don't duplicate rules across flows

4. **Test token counts** - Different flows use different amounts of tokens

5. **Cache base prompts** - Build once, reuse many times

## Token Counts (Approximate)

- **Agentic Flow:** ~2,500 tokens
- **Document Flow:** ~800 tokens
- **Simple Flow:** ~400 tokens

This leaves plenty of room for:
- System context (500-1000 tokens)
- Conversation history (1000-2000 tokens)
- User message (100-500 tokens)

## Questions?

See the implementation in:
- `src/shared/services/prompt-builder.service.js`
- `src/shared/services/system-prompt.service.js` (backward compatible wrapper)
