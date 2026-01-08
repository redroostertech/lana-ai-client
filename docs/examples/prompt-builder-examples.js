// docs/examples/prompt-builder-examples.js
// Practical examples of using the prompt builder service

const promptBuilder = require('../../src/shared/services/prompt-builder.service');
const SystemContextService = require('../../src/shared/context/system-context.service');

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE 1: Agentic Chat Flow (General conversation with tools)
// ═══════════════════════════════════════════════════════════════════════════

async function buildAgenticChatPrompt(user, matterId, threadId, tools, attachments) {
  // Step 1: Build runtime context
  const systemContext = await SystemContextService.build({
    user,
    matterId,
    threadId,
    tokenBudget: 1200
  });

  // Step 2: Build complete prompt
  const fullPrompt = promptBuilder.buildCompletePrompt(
    'agentic',
    systemContext.context,
    {
      tools,
      attachments,
      documentCount: 10,
      matterId
    }
  );

  console.log('Agentic prompt ready!');
  console.log('Total length:', fullPrompt.length, 'characters');
  
  return fullPrompt;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE 2: Document Chat Flow (Document analysis only)
// ═══════════════════════════════════════════════════════════════════════════

async function buildDocumentChatPrompt(user, matterId, attachedFiles) {
  // Step 1: Build minimal context (document chat doesn't need full context)
  const systemContext = SystemContextService.buildMinimalContext({
    user,
    additionalContext: `Focus: Document analysis for attached files`
  });

  // Step 2: Build document-focused prompt
  const fullPrompt = promptBuilder.buildCompletePrompt(
    'document',
    systemContext,
    {
      attachments: { files: attachedFiles },
      // No tools array = focused on documents only
    }
  );

  console.log('Document chat prompt ready!');
  console.log('Total length:', fullPrompt.length, 'characters');
  
  return fullPrompt;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE 3: Simple Chat Flow (Quick Q&A with context)
// ═══════════════════════════════════════════════════════════════════════════

async function buildSimpleChatPrompt(user, matterId) {
  // Step 1: Build lightweight context
  const systemContext = await SystemContextService.build({
    user,
    matterId,
    tokenBudget: 500 // Lower budget for simple chat
  });

  // Step 2: Build simple prompt
  const fullPrompt = promptBuilder.buildCompletePrompt(
    'simple',
    systemContext.context,
    {} // No tools, no attachments
  );

  console.log('Simple chat prompt ready!');
  console.log('Total length:', fullPrompt.length, 'characters');
  
  return fullPrompt;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE 4: Custom Flow (Mix and match components)
// ═══════════════════════════════════════════════════════════════════════════

async function buildCustomResearchPrompt(user, matterId, tools) {
  // Build context
  const systemContext = await SystemContextService.build({
    user,
    matterId,
    tokenBudget: 800
  });

  // Build custom prompt with specific components
  const customPrompt = promptBuilder.buildCustomPrompt([
    'identity',
    'accessAndCapabilities',
    'criticalRules',
    'documentFocusedRules', // Focus on documents
    'intelligentAnalysisExamples', // But include analysis examples
    'communicationStyle'
  ]);

  // Add context and session info
  const fullPrompt = promptBuilder.addSystemContext(customPrompt, systemContext.context);
  const finalPrompt = promptBuilder.addSessionInfo(fullPrompt, {
    tools,
    documentCount: 5,
    matterId
  });

  console.log('Custom research prompt ready!');
  console.log('Total length:', finalPrompt.length, 'characters');
  
  return finalPrompt;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE 5: Component-Level Customization
// ═══════════════════════════════════════════════════════════════════════════

function buildMinimalPromptForTesting() {
  // Access individual components directly
  const { PromptComponents } = promptBuilder;

  const minimalPrompt = `
${PromptComponents.identity()}

## Test Mode Rules
- Keep responses brief for testing
- Include test metadata in responses
- Flag any errors clearly

${PromptComponents.criticalRules()}

${PromptComponents.communicationStyle()}
`;

  console.log('Minimal test prompt ready!');
  return minimalPrompt;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE 6: Flow Selection Based on Context
// ═══════════════════════════════════════════════════════════════════════════

async function buildPromptForContext(user, matterId, threadId, options = {}) {
  const {
    attachedFiles = [],
    tools = [],
    isDocumentFocused = false,
    isSimpleQuery = false
  } = options;

  // Build system context
  const systemContext = await SystemContextService.build({
    user,
    matterId,
    threadId,
    tokenBudget: isSimpleQuery ? 500 : 1200
  });

  // Select flow based on context
  let flowType;
  if (isDocumentFocused || attachedFiles.length > 0) {
    flowType = 'document';
    console.log('Selected: Document chat flow');
  } else if (isSimpleQuery || tools.length === 0) {
    flowType = 'simple';
    console.log('Selected: Simple chat flow');
  } else {
    flowType = 'agentic';
    console.log('Selected: Agentic flow');
  }

  // Build prompt
  const fullPrompt = promptBuilder.buildCompletePrompt(
    flowType,
    systemContext.context,
    {
      tools,
      attachments: { files: attachedFiles },
      documentCount: 10,
      matterId
    }
  );

  return fullPrompt;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE 7: Integration with performant-agent.js
// ═══════════════════════════════════════════════════════════════════════════

class ExamplePerformantAgent {
  buildRichSystemPrompt(session, tools) {
    const {
      systemContext,
      attachments,
      documentCount,
      effectiveMatterId
    } = session;

    // Use prompt builder instead of manual construction
    return promptBuilder.buildCompletePrompt(
      'agentic', // or dynamically select based on session
      systemContext,
      {
        tools,
        attachments,
        documentCount,
        matterId: effectiveMatterId
      }
    );
  }

  // Could add flow selection logic
  selectFlow(session) {
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
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN COMPARISON
// ═══════════════════════════════════════════════════════════════════════════

function comparePromptSizes() {
  console.log('\n=== Prompt Size Comparison ===\n');
  
  const agentic = promptBuilder.buildAgenticPrompt();
  console.log('Agentic Flow:     ', agentic.length, 'chars (~', Math.round(agentic.length / 4), 'tokens)');
  
  const document = promptBuilder.buildDocumentChatPrompt();
  console.log('Document Flow:    ', document.length, 'chars (~', Math.round(document.length / 4), 'tokens)');
  
  const simple = promptBuilder.buildSimpleChatPrompt();
  console.log('Simple Flow:      ', simple.length, 'chars (~', Math.round(simple.length / 4), 'tokens)');
  
  console.log('\nToken savings:');
  console.log('Document vs Agentic: -', Math.round((agentic.length - document.length) / 4), 'tokens');
  console.log('Simple vs Agentic:   -', Math.round((agentic.length - simple.length) / 4), 'tokens');
  console.log('\nUse the right flow for the context to save tokens and improve performance!');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  buildAgenticChatPrompt,
  buildDocumentChatPrompt,
  buildSimpleChatPrompt,
  buildCustomResearchPrompt,
  buildMinimalPromptForTesting,
  buildPromptForContext,
  ExamplePerformantAgent,
  comparePromptSizes
};

// Run comparison if executed directly
if (require.main === module) {
  comparePromptSizes();
}
