/**
 * Quick test of all prompt flows after refactoring
 */

const systemPromptService = require('../src/shared/services/system-prompt.service');

console.log('🧪 Testing All Prompt Flows...\n');

const promptBuilder = systemPromptService.PromptBuilder;

// Build all three flows
const agenticPrompt = promptBuilder.buildAgenticPrompt();
const documentPrompt = promptBuilder.buildDocumentChatPrompt();
const simplePrompt = promptBuilder.buildSimpleChatPrompt();

// Calculate token estimates
const agenticTokens = Math.ceil(agenticPrompt.length / 4);
const documentTokens = Math.ceil(documentPrompt.length / 4);
const simpleTokens = Math.ceil(simplePrompt.length / 4);

console.log('Token Counts After Refactoring:');
console.log('━'.repeat(60));
console.log(`  Agentic Flow:  ${agenticTokens} tokens`);
console.log(`  Document Flow: ${documentTokens} tokens`);
console.log(`  Simple Flow:   ${simpleTokens} tokens`);

console.log('\n\nComponent Count by Flow:');
console.log('━'.repeat(60));

// Agentic uses 10 components
console.log('Agentic (10 components):');
console.log('  1. identity');
console.log('  2. uniqueValue');
console.log('  3. accessAndCapabilities');
console.log('  4. toolsAndCapabilities');
console.log('  5. prioritizationHierarchy');
console.log('  6. capabilities (analytical skills)');
console.log('  7. criticalRules');
console.log('  8. coreGuidelines');
console.log('  9. intelligentAnalysisExamples');
console.log('  10. communicationStyle');

// Document uses 4 components
console.log('\nDocument (4 components):');
console.log('  1. identity');
console.log('  2. documentFocusedRules');
console.log('  3. criticalRules');
console.log('  4. communicationStyle');

// Simple uses 3 components
console.log('\nSimple (3 components):');
console.log('  1. identity');
console.log('  2. simpleChatRules');
console.log('  3. communicationStyle');

console.log('\n\nWhy Agentic is Larger:');
console.log('━'.repeat(60));
console.log(`Agentic is ${Math.round(agenticTokens / documentTokens * 10) / 10}x larger than Document`);
console.log(`Agentic is ${Math.round(agenticTokens / simpleTokens * 10) / 10}x larger than Simple`);
console.log('\nBecause it includes:');
console.log('  ✓ Full value proposition (uniqueValue)');
console.log('  ✓ Complete memory systems explanation');
console.log('  ✓ All available tools listing');
console.log('  ✓ Detailed prioritization hierarchy');
console.log('  ✓ Analytical capabilities breakdown');
console.log('  ✓ Usage examples and patterns');
console.log('\nDocument/Simple flows are optimized for specific use cases.');

console.log('\n✅ All flows built successfully!');
process.exit(0);
