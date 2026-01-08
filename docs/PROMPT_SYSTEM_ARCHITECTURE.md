# Prompt System Architecture

A declarative, composable system for building AI prompts across different flows.

## Overview

The prompt system is now split into three layers:

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Prompt Builder (NEW)                              │
│ prompt-builder.service.js                                   │
│                                                             │
│ • Declarative components (identity, rules, capabilities)   │
│ • Flow-specific builders (agentic, document, simple)       │
│ • Formatting utilities (addContext, addSessionInfo)        │
│ • Easy to extend and maintain                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: System Context                                    │
│ system-context.service.js                                   │
│                                                             │
│ • Runtime data ONLY (no instructions)                      │
│ • User profile, organization, matter details               │
│ • Document lists, memories                                 │
│ • Current date/time                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Agent Assembly                                    │
│ performant-agent.js                                         │
│                                                             │
│ • Combines prompt + context + session info                 │
│ • Adds tools, attachments, documents                       │
│ • Executes AI flow                                         │
└─────────────────────────────────────────────────────────────┘
```

## Files

### Core Files

- **`prompt-builder.service.js`** - NEW declarative prompt builder
- **`system-prompt.service.js`** - Backward compatible wrapper (uses prompt builder)
- **`system-context.service.js`** - Runtime data provider (facts only)
- **`performant-agent.js`** - Agent execution (combines everything)

### Documentation

- **`PROMPT_BUILDER_USAGE.md`** - Complete usage guide
- **`PROMPT_SYSTEM_ARCHITECTURE.md`** - This file (architecture overview)
- **`examples/prompt-builder-examples.js`** - Practical code examples

## Available Flows

### 1. Agentic Flow (Full-Featured)
**Size:** ~10,500 chars (~2,600 tokens)
**Use for:** General chat, complex queries, multi-tool workflows

```javascript
const prompt = promptBuilder.buildCompletePrompt('agentic', systemContext, sessionInfo);
```

**Includes:**
- Identity & unique value
- All capabilities (memory, tools, cross-system intelligence)
- Prioritization hierarchy
- Critical rules & guidelines
- Communication style
- Examples & best practices

### 2. Document Chat Flow (Document-Focused)
**Size:** ~2,800 chars (~700 tokens)
**Use for:** Document analysis, document Q&A, document comparison

```javascript
const prompt = promptBuilder.buildCompletePrompt('document', systemContext, sessionInfo);
```

**Includes:**
- Identity
- Document-specific rules
- Critical rules
- Communication style

**Savings:** -1,900 tokens vs agentic

### 3. Simple Chat Flow (Quick Q&A)
**Size:** ~1,350 chars (~340 tokens)
**Use for:** Fast responses, simple queries, context-only answers

```javascript
const prompt = promptBuilder.buildCompletePrompt('simple', systemContext, sessionInfo);
```

**Includes:**
- Identity
- Simple response guidelines
- Communication style

**Savings:** -2,260 tokens vs agentic

### 4. Custom Flow (Mix Your Own)
**Size:** Variable
**Use for:** Special-purpose flows

```javascript
const prompt = promptBuilder.buildCustomPrompt([
  'identity',
  'documentFocusedRules',
  'criticalRules'
]);
```

## Key Improvements

### Before (Old System)

❌ **Monolithic:** One giant prompt for all flows
❌ **Duplication:** Instructions in multiple places
❌ **Hard to maintain:** Changes required updates in multiple files
❌ **Wasteful:** Full prompt even for simple queries
❌ **Conflicting:** Rules could contradict each other

### After (New System)

✅ **Composable:** Mix and match components
✅ **DRY:** Single source of truth for each component
✅ **Maintainable:** Change once, apply everywhere
✅ **Efficient:** Right-sized prompts for each flow
✅ **Clear:** Separation of concerns (data vs behavior)

## Migration Path

### Phase 1: Backward Compatibility (Current)
- ✅ New prompt-builder.service.js created
- ✅ system-prompt.service.js uses prompt builder internally
- ✅ All existing code still works
- ✅ Documentation and examples provided

### Phase 2: Gradual Migration (Recommended)
- Update performant-agent.js to use prompt builder directly
- Add flow selection logic based on context
- Test each flow type thoroughly
- Monitor token usage and performance

### Phase 3: Deprecation (Future)
- Remove legacy system-prompt.service.js methods
- Fully migrate to prompt-builder.service.js
- Clean up any remaining manual prompt construction

## Usage Examples

### Example 1: Use in performant-agent.js

```javascript
buildRichSystemPrompt(session, tools) {
  // OLD WAY (manual construction)
  // let prompt = systemPromptService.BASE_SYSTEM_PROMPT;
  // prompt += `\n\n--- SYSTEM CONTEXT ---\n${systemContext}`;
  // ... lots of manual formatting ...
  
  // NEW WAY (declarative)
  return promptBuilder.buildCompletePrompt(
    'agentic',
    session.systemContext,
    {
      tools,
      attachments: session.attachments,
      documentCount: session.documentCount,
      matterId: session.effectiveMatterId
    }
  );
}
```

### Example 2: Flow Selection Based on Context

```javascript
function selectOptimalFlow(session) {
  // Document-focused if files attached
  if (session.attachments?.files?.length > 0) {
    return 'document';
  }
  
  // Simple if no tools available
  if (!session.scopedTools || session.scopedTools.length === 0) {
    return 'simple';
  }
  
  // Default to full agentic
  return 'agentic';
}

const flowType = selectOptimalFlow(session);
const prompt = promptBuilder.buildCompletePrompt(flowType, systemContext, sessionInfo);
```

### Example 3: Document-Only Chat

```javascript
// For a dedicated document chat interface
const documentPrompt = promptBuilder.buildCompletePrompt(
  'document',
  systemContext,
  {
    attachments: { files: uploadedFiles }
    // No tools, no matter context needed
  }
);
```

## Token Savings

Using the right flow for the context saves tokens:

| Flow | Tokens | Savings vs Agentic |
|------|--------|-------------------|
| Agentic | ~2,600 | baseline |
| Document | ~700 | **-1,900 tokens** |
| Simple | ~340 | **-2,260 tokens** |

**Impact:**
- Faster responses (less to process)
- Lower costs (fewer tokens)
- Better focus (relevant instructions only)
- More room for context (conversation history, etc.)

## Adding New Components

To add a new component:

```javascript
// In prompt-builder.service.js
PromptComponents.myNewComponent() {
  return `## My New Section
  
  Rules and guidelines for this component...`;
}
```

## Adding New Flows

To add a new flow:

```javascript
// 1. Add builder
PromptBuilders.buildMyNewPrompt() {
  const components = [
    PromptComponents.identity(),
    PromptComponents.myNewComponent(),
    PromptComponents.communicationStyle()
  ];
  return components.join('\n\n');
}

// 2. Update buildCompletePrompt switch
case 'mynew':
  basePrompt = PromptBuilders.buildMyNewPrompt();
  break;

// 3. Export
module.exports = {
  buildMyNewPrompt: PromptBuilders.buildMyNewPrompt,
  // ...
};
```

## Testing

Run the examples:

```bash
node docs/examples/prompt-builder-examples.js
```

Test individual flows:

```bash
node -e "
const pb = require('./src/shared/services/prompt-builder.service');
console.log('Agentic:', pb.buildAgenticPrompt().length, 'chars');
console.log('Document:', pb.buildDocumentChatPrompt().length, 'chars');
console.log('Simple:', pb.buildSimpleChatPrompt().length, 'chars');
"
```

## Best Practices

1. **Choose the right flow** for your use case
   - Don't use agentic flow for simple document questions
   - Don't use simple flow for complex multi-step reasoning

2. **Cache base prompts** - Build once, reuse many times

3. **Monitor token usage** - Track actual usage vs expected

4. **Keep components focused** - Single responsibility principle

5. **Test thoroughly** - Each flow should be tested independently

## Questions?

See documentation:
- `PROMPT_BUILDER_USAGE.md` - Detailed usage guide
- `examples/prompt-builder-examples.js` - Code examples

See implementation:
- `src/shared/services/prompt-builder.service.js` - Main service
- `src/shared/services/system-prompt.service.js` - Backward compatible wrapper
- `src/shared/context/system-context.service.js` - Runtime context builder
