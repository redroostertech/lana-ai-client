/**
 * TEST: Verify capabilities() no longer duplicates accessAndCapabilities()
 */

const systemPromptService = require('../src/shared/services/system-prompt.service');

console.log('🧪 Testing Capabilities Consolidation...\n');

const promptBuilder = systemPromptService.PromptBuilder;
const components = promptBuilder.PromptComponents;

// Get both components
const accessAndCaps = components.accessAndCapabilities();
const capabilities = components.capabilities();

console.log('Component: accessAndCapabilities()');
console.log('━'.repeat(60));
console.log(`📏 Length: ${accessAndCaps.length} chars (~${Math.ceil(accessAndCaps.length / 4)} tokens)`);
console.log('\nCovers:');
console.log('  ✓ IMMEDIATE CONTEXT');
console.log('  ✓ MEMORY & RECALL (detailed)');
console.log('  ✓ How to Use Your Memory');
console.log('  ✓ TOOLS & CAPABILITIES (via toolsAndCapabilities)');

console.log('\n\nComponent: capabilities()');
console.log('━'.repeat(60));
console.log(`📏 Length: ${capabilities.length} chars (~${Math.ceil(capabilities.length / 4)} tokens)`);
console.log('\nCovers:');
console.log('  ✓ CROSS-SYSTEM ANALYSIS');
console.log('  ✓ PATTERN RECOGNITION & INSIGHTS');
console.log('  ✓ INTELLIGENT SYNTHESIS');
console.log('  ✓ ADAPTIVE INTELLIGENCE');

// Check for duplication
console.log('\n\nOverlap Check:');
console.log('━'.repeat(60));

let hasIssues = false;

// Check if capabilities() mentions memory (it shouldn't in detail)
if (capabilities.includes('Long-term memory') || 
    capabilities.includes('Short-term memory') ||
    capabilities.includes('Conversation history')) {
  console.log('❌ capabilities() still contains detailed memory descriptions');
  hasIssues = true;
} else {
  console.log('✅ No memory system duplication');
}

// Check if both contain "MEMORY & RECALL" as a section header
const accessHasMemory = accessAndCaps.includes('MEMORY & RECALL');
const capsHasMemory = capabilities.includes('MEMORY & RECALL');

if (accessHasMemory && capsHasMemory) {
  console.log('⚠️  Both components have "MEMORY & RECALL" section');
  hasIssues = true;
} else if (accessHasMemory && !capsHasMemory) {
  console.log('✅ Memory systems only in accessAndCapabilities()');
} else {
  console.log('⚠️  Memory systems not properly assigned');
  hasIssues = true;
}

// Check that capabilities focuses on analysis
if (capabilities.includes('ANALYSIS') || 
    capabilities.includes('PATTERN RECOGNITION') ||
    capabilities.includes('INSIGHTS')) {
  console.log('✅ capabilities() focuses on analytical skills');
} else {
  console.log('⚠️  capabilities() should focus on analytical skills');
  hasIssues = true;
}

// Check separation of concerns
console.log('\n\nSeparation of Concerns:');
console.log('━'.repeat(60));
console.log('accessAndCapabilities(): What you HAVE access to');
console.log('  → Context, memory systems, tools');
console.log('\ncapabilities(): What you can DO with that access');
console.log('  → Analyze, recognize patterns, synthesize, derive insights');

if (hasIssues) {
  console.log('\n❌ FAILED: Overlap detected');
  process.exit(1);
} else {
  console.log('\n✅ PASSED: Clean separation, no duplication');
}
