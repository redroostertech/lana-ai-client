# Prompt Components Analysis - Overlap Review

**Date:** December 17, 2025  
**Purpose:** Identify overlaps, redundancies, and consolidation opportunities

## Current Components

| # | Component | Purpose | Lines | Tokens |
|---|-----------|---------|-------|--------|
| 1 | `identity()` | Who you are | 1 | ~15 |
| 2 | `uniqueValue()` | Unified intelligence layer value prop | 19 | ~150 |
| 3 | `accessAndCapabilities()` | Context + memory systems | 39 | ~400 |
| 4 | `toolsAndCapabilities()` | Tools for fetching data | 26 | ~250 |
| 5 | `prioritizationHierarchy()` | How to prioritize queries | 37 | ~350 |
| 6 | `roleAndIntelligence()` | Cross-system intelligence | 25 | ~240 |
| 7 | `criticalRules()` | Never violate rules | 11 | ~150 |
| 8 | `coreGuidelines()` | Behavioral guidelines | 15 | ~170 |
| 9 | `intelligentAnalysisExamples()` | Usage examples | 17 | ~150 |
| 10 | `communicationStyle()` | How to speak | 14 | ~140 |
| 11 | `documentFocusedRules()` | Document-specific rules | 19 | ~160 |
| 12 | `simpleChatRules()` | Simple chat rules | 10 | ~90 |

## Identified Overlaps

### 🔴 MAJOR OVERLAP: Unified Intelligence Layer

**Issue:** Core concept repeated in two components

**Component 1: `uniqueValue()` (lines 46-62)**
```
You are the UNIFIED INTELLIGENCE LAYER for this organization.

Your superpower: You have visibility across ALL data sources...
• Internal databases (...)
• Integrations (...)
• External connectors (...)

What makes you valuable:
✓ You can query across the ENTIRE connected ecosystem
✓ You connect information in different systems
✓ Single point of intelligence
```

**Component 2: `roleAndIntelligence()` (lines 188-211)**
```
You are the UNIFIED INTELLIGENCE LAYER - you sit on top of ALL connected systems.

Cross-System Intelligence:
- Query across MULTIPLE data sources simultaneously
- Connect information living in different systems
- Provide insights across entire ecosystem
- Break down data silos
```

**Overlap:** ~70% duplicate content
- Same "unified intelligence layer" concept
- Same cross-system capabilities message
- Same value proposition

**Recommendation:** 
- ✅ **KEEP** `uniqueValue()` - more comprehensive, better structured
- ❌ **REMOVE** unified intelligence section from `roleAndIntelligence()`
- 🔄 **RENAME** `roleAndIntelligence()` → `capabilities()` (focus on what you can do)

### 🟡 MODERATE OVERLAP: Prioritization

**Issue:** Prioritization mentioned in multiple places

**Component 1: `prioritizationHierarchy()` (lines 144-180)**
```
YOUR APPROACH (Prioritization Hierarchy):
1. PRIORITIZE CURRENT MATTER FIRST
2. START with system context
3. EXPAND CONTEXTUALLY
...
Priority Order:
   Priority 1: Current matter
   Priority 2: Related matters
   Priority 3: System-wide data
```

**Component 2: `coreGuidelines()` (lines 239-244)**
```
- PRIORITIZE the current matter context when in a matter conversation
- You have access to ALL data, but use contextual prioritization:
  • First: Current matter data
  • Second: Related matters
  • Third: System-wide data
```

**Overlap:** ~40% duplicate
- Same 3-tier prioritization
- Same "current matter first" message

**Recommendation:**
- ✅ **KEEP** detailed prioritization in `prioritizationHierarchy()`
- 🔄 **REMOVE** duplication from `coreGuidelines()` 
- ✅ **REFERENCE** instead: "Follow prioritization hierarchy above"

### 🟡 MODERATE OVERLAP: Tool Usage

**Issue:** Tool usage guidance scattered across multiple components

**Found in:**
1. `toolsAndCapabilities()` - Lists available tools
2. `prioritizationHierarchy()` line 154 - "USE MULTIPLE TOOLS in combination"
3. `criticalRules()` lines 223, 225 - Rules about when to use tools
4. `coreGuidelines()` lines 245-246 - "Combine multiple data sources"
5. `intelligentAnalysisExamples()` - Shows tool usage patterns

**Overlap:** ~30% duplicate concepts
- Multiple mentions of "use tools to fetch data"
- Multiple mentions of "combine multiple tools"
- Multiple mentions of tool usage patterns

**Recommendation:**
- ✅ **KEEP** tool list in `toolsAndCapabilities()`
- ✅ **KEEP** examples in `intelligentAnalysisExamples()`
- 🔄 **CONSOLIDATE** rules about tool usage into `criticalRules()`
- 🔄 **REMOVE** tool mentions from `coreGuidelines()` (already in rules)

### 🟢 MINOR OVERLAP: Memory Usage

**Issue:** Memory usage mentioned twice

**Component 1: `accessAndCapabilities()` (lines 101-106)**
```
How to Use Your Memory:
- Reference past conversations naturally: "As we discussed earlier..."
- Build on previous context: "Following up on..."
- Recall specific facts: "I remember you said..."
- Connect across time: "Similar to issue last week..."
- Don't repeat what was already discussed unless asked
```

**Component 2: `criticalRules()` (lines 226-229)**
```
7. For memory/recall: CHECK "REMEMBERED FACTS" and "CONVERSATION HISTORY" sections
8. Reference past conversations naturally: "As we discussed...", "You mentioned..."
9. Build on previous context - don't treat each message as isolated
```

**Overlap:** ~50% duplicate
- Both mention referencing past conversations
- Both mention building on context

**Recommendation:**
- ✅ **KEEP** "How to Use Memory" in `accessAndCapabilities()` (more comprehensive)
- 🔄 **SIMPLIFY** rule #7-9 in `criticalRules()` to: "Use memory systems (see above)"

### 🟢 MINOR OVERLAP: Data Sources

**Issue:** Capabilities/data sources listed twice

**Component 1: `uniqueValue()` (lines 48-52)**
```
Your superpower: You have visibility across ALL data sources:
• Internal databases (matters, documents, clients, ...)
• Integrations (CRM, marketing, ...)
• External connectors (Google, Microsoft, ...)
```

**Component 2: `roleAndIntelligence()` (lines 198-205)**
```
Your Capabilities:
- INTERNAL: matters, documents, clients, contacts, ...
- INTEGRATIONS: Actionstep, practice management, ...
- CONNECTORS: Any system via API
- MEMORY: Long-term, short-term, ...
- RECALL: Instant access to past conversations
- ANALYSIS: Cross-reference, pattern recognition
```

**Overlap:** ~60% duplicate
- Both list internal databases
- Both mention integrations
- Both mention connectors

**Recommendation:**
- ✅ **KEEP** high-level list in `uniqueValue()` (explains "why you're valuable")
- 🔄 **FOCUS** `capabilities()` on "what you can DO" vs "what you have access to"
- 🔄 **REMOVE** redundant INTERNAL/INTEGRATIONS/CONNECTORS list

## Recommendations

### Consolidation Plan

#### 1. **Merge & Refocus: `roleAndIntelligence()` → `capabilities()`**

**Current (25 lines, ~240 tokens):**
- Repeats "unified intelligence layer"
- Lists data sources (already in `uniqueValue`)
- Mixed purpose

**Proposed (15 lines, ~150 tokens):**
- Focus on ACTION-ORIENTED capabilities
- Remove unified intelligence duplication
- Remove data source duplication
- Keep: MEMORY, RECALL, ANALYSIS, INSIGHTS, CONTINUITY

**Token Savings:** ~90 tokens

#### 2. **Streamline: `coreGuidelines()`**

**Current (15 lines, ~170 tokens):**
- Repeats prioritization from `prioritizationHierarchy()`
- Repeats tool usage from other sections

**Proposed (10 lines, ~110 tokens):**
- Remove prioritization duplication (reference hierarchy instead)
- Remove tool usage duplication
- Focus on behavioral guidelines only

**Token Savings:** ~60 tokens

#### 3. **Simplify: `criticalRules()`**

**Current (11 lines, ~150 tokens):**
- Rules #7-9 repeat memory usage

**Proposed (9 lines, ~120 tokens):**
- Consolidate rules #7-9 into single rule referencing memory section

**Token Savings:** ~30 tokens

### Summary of Changes

| Action | Component | Change | Token Impact |
|--------|-----------|--------|--------------|
| 🔄 Refactor | `roleAndIntelligence()` → `capabilities()` | Remove duplications, focus on actions | -90 tokens |
| 🔄 Streamline | `coreGuidelines()` | Remove prioritization/tool duplications | -60 tokens |
| 🔄 Simplify | `criticalRules()` | Consolidate memory rules | -30 tokens |
| **TOTAL** | | | **-180 tokens (~7%)** |

### Updated Component Structure

```
1. identity() - Who you are [UNCHANGED]
2. uniqueValue() - Unified intelligence layer value prop [UNCHANGED]
3. accessAndCapabilities() - Context + memory [UNCHANGED]
4. toolsAndCapabilities() - Tools listing [UNCHANGED]
5. prioritizationHierarchy() - Prioritization approach [UNCHANGED]
6. capabilities() - What you can DO (refactored) [CHANGED]
7. criticalRules() - Never violate rules (simplified) [CHANGED]
8. coreGuidelines() - Behavioral guidelines (streamlined) [CHANGED]
9. intelligentAnalysisExamples() - Usage examples [UNCHANGED]
10. communicationStyle() - How to speak [UNCHANGED]
11. documentFocusedRules() - Document rules [UNCHANGED]
12. simpleChatRules() - Simple rules [UNCHANGED]
```

## Benefits of Consolidation

✅ **Reduced Token Count** - Save ~180 tokens (7% reduction)
✅ **Clearer Purpose** - Each component has distinct responsibility
✅ **No Repetition** - User gets each concept once, clearly
✅ **Better Flow** - Logical progression without redundancy
✅ **Easier Maintenance** - Update concept in one place only
✅ **More Focused** - Each component teaches one thing well

## Impact Analysis

### Before Consolidation
- Agentic Prompt: ~2,766 tokens
- Document Prompt: ~693 tokens
- Simple Prompt: ~343 tokens

### After Consolidation (Projected)
- Agentic Prompt: ~2,586 tokens (-180, -7%)
- Document Prompt: ~693 tokens (unchanged)
- Simple Prompt: ~343 tokens (unchanged)

Only agentic flow affected (uses most components).

## Next Steps

1. ✅ Review and approve consolidation plan
2. 🔄 Refactor `roleAndIntelligence()` → `capabilities()`
3. 🔄 Streamline `coreGuidelines()`
4. 🔄 Simplify `criticalRules()`
5. ✅ Test all flows
6. ✅ Update documentation

---

**Status:** Analysis Complete - Awaiting Approval for Refactoring
