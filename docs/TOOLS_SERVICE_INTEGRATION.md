# Tools Service Integration - How tools.service.js Works with /tools

## 🎯 Overview

Your system has **TWO parallel tool systems** that are being gradually unified:

1. **Legacy System**: `tools.service.js` (old, monolithic, 3195 lines)
2. **New System**: `/tools` folder (new, modular, SOLID architecture)

They work together through an **Adapter Pattern** during the migration period.

---

## 📊 Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                      PERFORMANT AGENT                                │
│                   (performant-agent.js)                              │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                ↓
                    Needs tool schemas + execution
                                │
                ┌───────────────┴───────────────┐
                │                               │
                ↓                               ↓
┌───────────────────────────────┐   ┌──────────────────────────────┐
│   NEW TOOL SYSTEM (/tools)    │   │  LEGACY TOOL SYSTEM          │
│                               │   │  (tools.service.js)          │
│  ┌─────────────────────────┐ │   │                              │
│  │  Tool Registry          │ │   │  AVAILABLE_TOOLS = {         │
│  │  (Central registry)     │ │   │    search_documents: {...},  │
│  └──────────┬──────────────┘ │   │    get_matter_details: {...},│
│             │                 │   │    list_tasks: {...},        │
│   ┌─────────┴────────┐        │   │    get_client: {...},        │
│   │                  │        │   │    ... 35+ tools             │
│   ↓                  ↓        │   │  }                           │
│  ┌──────┐      ┌──────────┐  │   │                              │
│  │ NEW  │      │ LEGACY   │  │   │  executeTool(name, params)   │
│  │TOOLS │      │ ADAPTER  │──┼───┼──→ AVAILABLE_TOOLS[name]    │
│  └──────┘      └──────────┘  │   │      .execute(params)        │
│                               │   │                              │
└───────────────────────────────┘   └──────────────────────────────┘
     ↑                                       ↑
     │                                       │
     └───────── Uses both systems ───────────┘
```

---

## 🔄 How They Work Together

### Phase 1: Tool Registration (Startup)

**File:** `src/shared/tools/tool-initializer.js`

```javascript
class ToolInitializer {
  static async initialize() {
    // Step 1: Register NEW SOLID-architecture tools
    const documentSearchTool = new DocumentSearchTool();
    ToolRegistry.register(documentSearchTool, 'documents');
    // ✅ This tool uses new RetrievalService architecture

    // Step 2: Import LEGACY tools from tools.service.js
    const legacyToolsService = require('../ai/tools.service');
    const AVAILABLE_TOOLS = legacyToolsService.AVAILABLE_TOOLS;

    // Step 3: Wrap LEGACY tools in adapters
    for (const [toolName, legacyTool] of Object.entries(AVAILABLE_TOOLS)) {
      if (toolName === 'search_documents') {
        // Skip - we already registered new version
        continue;
      }

      // Wrap in adapter and register
      const adapter = new LegacyToolAdapter(legacyTool);
      ToolRegistry.register(adapter, category);
      // ✅ Now legacy tool works with new system!
    }
  }
}
```

**What happens:**
1. New tools registered directly
2. Legacy tools imported from `tools.service.js`
3. Each legacy tool wrapped in `LegacyToolAdapter`
4. All tools (new + legacy) in single `ToolRegistry`

---

### Phase 2: Tool Exposure (Request Time)

**Flow:**

```javascript
// 1. Frontend sends request
POST /api/v1/streaming/chat/stream
{
  "message": "Find contract documents",
  "context_type": "document_chat"
}

// 2. Context resolution (streaming.routes.js)
const scopedTools = getToolsForContext('document_chat', [], {
  query: message,
  hasDocuments: true,
  documentCount: 42
});

// 3. getToolsForContext converts tool names to schemas
function convertToolNamesToSchemas(toolNames) {
  const schemas = [];
  for (const toolName of toolNames) {
    // Get tool from NEW registry (could be new or adapted legacy)
    const tool = ToolRegistry.getTool(toolName);
    
    // Convert to Ollama format
    const schema = tool.toOllamaSchema();
    schemas.push(schema);
  }
  return schemas;
}

// 4. Tool schemas provided to LLM
// LLM sees: search_documents, get_document_summary, etc.
// (doesn't know/care if they're new or legacy!)
```

---

### Phase 3: Tool Execution (Runtime)

**When LLM calls a tool:**

```javascript
// LLM decides to call: search_documents
{
  "name": "search_documents",
  "arguments": {
    "query": "contract",
    "matter_id": "MATT-00001"
  }
}

// Execution flow:
┌──────────────────────────────────────────────────┐
│ 1. ToolRegistry.getTool('search_documents')      │
│    Returns: DocumentSearchTool (NEW)             │
└───────────────────┬──────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│ 2. tool.execute(params, context)                 │
│    → DocumentSearchTool.execute()                │
│    → Uses RetrievalService (new architecture)   │
└───────────────────┬──────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│ 3. Returns ToolResult                            │
│    { success: true, data: [...results...] }      │
└──────────────────────────────────────────────────┘

// For a legacy tool like 'get_matter_details':
┌──────────────────────────────────────────────────┐
│ 1. ToolRegistry.getTool('get_matter_details')    │
│    Returns: LegacyToolAdapter                    │
└───────────────────┬──────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│ 2. adapter.execute(params, context)              │
│    → Calls: legacyTool.execute(params, context)  │
│    → Executes code from tools.service.js         │
└───────────────────┬──────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│ 3. Adapter wraps result in ToolResult            │
│    Legacy: { success: true, data: {...} }        │
│    → New: ToolResult.success(data)               │
└──────────────────────────────────────────────────┘
```

---

## 📝 Detailed Component Breakdown

### 1. tools.service.js (Legacy System)

**Location:** `src/shared/ai/tools.service.js` (3195 lines)

**Structure:**

```javascript
// Monolithic object with 35+ tools
const AVAILABLE_TOOLS = {
  search_documents: {
    name: 'search_documents',
    description: 'Search documents...',
    parameters: { /* JSON Schema */ },
    execute: async (params, context) => {
      // Implementation here (can be 50-200 lines)
      const results = await getRAGContext(...);
      return { success: true, data: results };
    }
  },

  get_matter_details: {
    name: 'get_matter_details',
    description: 'Get matter information...',
    parameters: { /* JSON Schema */ },
    execute: async (params, context) => {
      const result = await postgres.query(...);
      return { success: true, data: result.rows };
    }
  },

  // ... 33 more tools ...
};

// Helper functions
function executeTool(toolName, params, context) {
  const tool = AVAILABLE_TOOLS[toolName];
  return await tool.execute(params, context);
}

module.exports = {
  AVAILABLE_TOOLS,
  executeTool,
  getToolDefinitions,
  // ... more helpers
};
```

**Characteristics:**
- ✅ **Works**: All tools are production-ready
- ✅ **Complete**: Has rate limiting, validation, error handling
- ❌ **Monolithic**: 3195 lines in single file
- ❌ **Hard to test**: Tools coupled to implementation
- ❌ **Hard to extend**: Adding tools means editing giant file

---

### 2. /tools Folder (New System)

**Location:** `src/shared/tools/`

**Structure:**

```
/tools
├── base/                    # Interfaces & base classes
│   ├── tool.interface.js    # ITool interface (contract)
│   ├── tool-executor.base.js # Base class with validation
│   └── tool-result.js       # Standardized result format
│
├── registry/                # Central tool registry
│   └── tool-registry.js     # Singleton registry
│
├── adapters/                # Adapters for migration
│   ├── legacy-tool.adapter.js  # Wraps tools.service.js tools
│   └── json-tool.adapter.js    # Load tools from JSON
│
├── implementations/         # NEW tools (SOLID architecture)
│   └── document-search.tool.js # Example: new DocumentSearchTool
│
├── loaders/                 # Dynamic tool loading
│   └── json-tool.loader.js  # Load tools from JSON files
│
├── tool-manager.js          # Schema caching, context filtering
├── tool-initializer.js      # Startup initialization
└── index.js                 # Public API
```

**Key Files:**

#### tool.interface.js (Contract)

```javascript
class ITool {
  getName() { /* must implement */ }
  getDescription() { /* must implement */ }
  getParametersSchema() { /* must implement */ }
  validateParameters(params) { /* must implement */ }
  async execute(params, context) { /* must implement */ }
  
  // Helper methods
  toOllamaSchema() { /* pre-implemented */ }
  toFunctionSchema() { /* pre-implemented */ }
}
```

#### tool-registry.js (Central Registry)

```javascript
class ToolRegistry {
  constructor() {
    this.tools = new Map(); // toolName → toolInstance
    this.categories = new Map(); // category → Set<toolName>
  }

  register(tool, category) {
    this.tools.set(tool.getName(), tool);
    // Add to category for organization
  }

  getTool(toolName) {
    return this.tools.get(toolName);
  }

  getAllTools() {
    return Array.from(this.tools.values());
  }
}
```

#### legacy-tool.adapter.js (Bridge)

```javascript
class LegacyToolAdapter extends BaseToolExecutor {
  constructor(legacyTool) {
    this.legacyTool = legacyTool; // From tools.service.js
  }

  getName() {
    return this.legacyTool.name;
  }

  getDescription() {
    return this.legacyTool.description;
  }

  getParametersSchema() {
    return this.legacyTool.parameters;
  }

  async execute(params, context) {
    // Call legacy tool
    const result = await this.legacyTool.execute(params, context);
    
    // Convert legacy format to new format
    if (result.success) {
      return ToolResult.success(result.data);
    } else {
      return ToolResult.failure(result.error);
    }
  }
}
```

---

## 🔍 Complete Execution Flow Example

### Example: User asks about contracts

```javascript
// ═══════════════════════════════════════════════════════════
// STEP 1: Request arrives
// ═══════════════════════════════════════════════════════════
POST /api/v1/streaming/chat/stream
{
  "message": "Find documents about contracts",
  "context_type": "document_chat",
  "matter_id": "MATT-00001"
}

// ═══════════════════════════════════════════════════════════
// STEP 2: Tool scoping (streaming.routes.js)
// ═══════════════════════════════════════════════════════════
const contextConfig = getContextConfig('document_chat');
// Returns: {
//   tools: ['search_documents', 'get_document_summary', 'get_document', 'list_documents'],
//   needsDocuments: true,
//   needsRAG: true
// }

// AFTER document count is known (intelligent selection)
const scopedTools = getToolsForContext('document_chat', [], {
  query: message,
  hasDocuments: true,
  documentCount: 42
});

// ═══════════════════════════════════════════════════════════
// STEP 3: Convert tool names to schemas
// ═══════════════════════════════════════════════════════════
function convertToolNamesToSchemas(['search_documents', 'get_document_summary', ...]) {
  const schemas = [];
  
  for (const toolName of ['search_documents', 'get_document_summary', ...]) {
    // Get from ToolRegistry
    const tool = ToolRegistry.getTool(toolName);
    // Could be:
    // - DocumentSearchTool (new implementation)
    // - LegacyToolAdapter wrapping tools.service.js tool
    
    const schema = tool.toOllamaSchema();
    schemas.push(schema);
  }
  
  return schemas;
}

// Result:
scopedTools = [
  {
    name: 'search_documents',
    description: 'Search through indexed documents...',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', ... },
        matter_id: { type: 'string', ... },
        top_k: { type: 'number', ... }
      },
      required: ['query', 'matter_id']
    }
  },
  // ... more tools
];

// ═══════════════════════════════════════════════════════════
// STEP 4: Agent builds system prompt (performant-agent.js)
// ═══════════════════════════════════════════════════════════
buildRichSystemPrompt(session, scopedTools) {
  let prompt = systemPromptService.BASE_SYSTEM_PROMPT;
  
  // Add tool information
  prompt += `\n\n## Available Tools\n`;
  for (const tool of scopedTools) {
    prompt += `\n### ${tool.name}\n`;
    prompt += `${tool.description}\n`;
    prompt += `Parameters: ${Object.keys(tool.parameters.properties).join(', ')}\n`;
  }
  
  return prompt;
}

// ═══════════════════════════════════════════════════════════
// STEP 5: LLM decides to call tool
// ═══════════════════════════════════════════════════════════
// LLM reads the prompt and decides:
// "User wants contracts. I have search_documents tool. I should call it."

// LLM response:
{
  "tool_calls": [
    {
      "name": "search_documents",
      "arguments": {
        "query": "contracts",
        "matter_id": "MATT-00001",
        "top_k": 5
      }
    }
  ]
}

// ═══════════════════════════════════════════════════════════
// STEP 6: Agent executes tool (performant-agent.js)
// ═══════════════════════════════════════════════════════════
async executeToolsInParallel(toolCalls, toolContext) {
  const results = await Promise.all(
    toolCalls.map(async (toolCall) => {
      // Get tool from registry
      const tool = ToolRegistry.getTool('search_documents');
      // Returns: DocumentSearchTool instance (NEW implementation)
      
      // Execute tool
      const result = await tool.execute(
        { query: 'contracts', matter_id: 'MATT-00001', top_k: 5 },
        toolContext
      );
      
      return result;
    })
  );
}

// ═══════════════════════════════════════════════════════════
// STEP 7: Tool execution (document-search.tool.js)
// ═══════════════════════════════════════════════════════════
class DocumentSearchTool {
  async execute(params, context) {
    // New SOLID architecture
    const results = await RetrievalService.searchDocuments({
      query: params.query,
      matterId: params.matter_id,
      topK: params.top_k,
      ...context
    });
    
    return ToolResult.success(results, {
      toolName: 'search_documents',
      resultsCount: results.length
    });
  }
}

// ═══════════════════════════════════════════════════════════
// STEP 8: Results back to LLM
// ═══════════════════════════════════════════════════════════
// Agent receives ToolResult:
{
  success: true,
  data: [
    { chunk: "Section 3.2: Payment terms...", document_id: "DOC-001", ... },
    { chunk: "Contract renewal clause...", document_id: "DOC-003", ... },
    // ... 3 more results
  ],
  metadata: { toolName: 'search_documents', resultsCount: 5 }
}

// Agent formats for LLM:
messages.push({
  role: 'tool',
  content: JSON.stringify(toolResult.data)
});

// ═══════════════════════════════════════════════════════════
// STEP 9: LLM synthesizes response
// ═══════════════════════════════════════════════════════════
// LLM reads tool results and generates:
"I found 5 contract-related documents in this matter:

1. **Section 3.2: Payment Terms** (DOC-001)
   - Details the payment schedule and terms

2. **Contract Renewal Clause** (DOC-003)
   - Covers automatic renewal conditions

... etc."
```

---

## 🔄 Migration Strategy

### Current State: Hybrid System

```
┌─────────────────────────────────────────────────┐
│  35+ Tools Total                                │
├─────────────────────────────────────────────────┤
│  NEW:    1 tool  (document_search)              │
│  LEGACY: 34 tools (via LegacyToolAdapter)       │
└─────────────────────────────────────────────────┘
```

### Migration Process (Gradual)

**Step 1: Tool works in legacy system** ✅
```javascript
// tools.service.js
AVAILABLE_TOOLS.get_matter_details = {
  name: 'get_matter_details',
  execute: async (params, context) => { /* ... */ }
};
```

**Step 2: Wrap with adapter** ✅
```javascript
// tool-initializer.js
const legacyTool = AVAILABLE_TOOLS.get_matter_details;
const adapter = new LegacyToolAdapter(legacyTool);
ToolRegistry.register(adapter, 'matters');
// ✅ Tool now works in BOTH systems
```

**Step 3: Create new implementation** (Future)
```javascript
// implementations/matter-details.tool.js
class MatterDetailsTool extends BaseToolExecutor {
  async execute(params, context) {
    // New SOLID implementation
  }
}

// tool-initializer.js
ToolRegistry.register(new MatterDetailsTool(), 'matters');
// ✅ New implementation replaces adapter
```

**Step 4: Remove from tools.service.js** (Future)
```javascript
// tools.service.js
// AVAILABLE_TOOLS.get_matter_details = { ... }; ← DELETED
// Tool only exists in /tools folder now
```

### Migration Benefits

| Aspect | Legacy (tools.service.js) | New (/tools folder) |
|--------|---------------------------|---------------------|
| **File size** | 3195 lines (monolithic) | ~100 lines per tool |
| **Testability** | Hard (coupled) | Easy (isolated) |
| **Maintainability** | Low (one file) | High (modular) |
| **Extensibility** | Hard (edit giant file) | Easy (add new file) |
| **Type safety** | None | Interface-based |
| **Reusability** | Coupled to tools.service | Standalone classes |

---

## 🎯 Key Takeaways

### How tools.service.js Works With /tools

1. **tools.service.js** = Legacy monolithic tool definitions
2. **/tools** = New modular SOLID architecture
3. **LegacyToolAdapter** = Bridge between old and new
4. **ToolRegistry** = Single source of truth (holds both)
5. **ToolInitializer** = Startup registration (wraps legacy tools)
6. **Agent** = Doesn't care about legacy vs new (uses registry)

### Execution Flow Summary

```
User Request
    ↓
Context Resolution (which tools?)
    ↓
Tool Name → Schema Conversion (ToolRegistry.getTool)
    ↓
Agent Receives Schemas (old + new unified)
    ↓
LLM Calls Tool
    ↓
ToolRegistry.getTool(name)
    ↓
    ├─ NEW tool → Execute directly
    │  └─ Uses new architecture (RetrievalService, etc.)
    │
    └─ LEGACY tool → LegacyToolAdapter
       └─ Calls tools.service.js AVAILABLE_TOOLS[name].execute()
       └─ Wraps result in ToolResult
    ↓
Results back to LLM
```

### Why This Design?

✅ **Zero downtime** - Legacy tools keep working  
✅ **Gradual migration** - Migrate one tool at a time  
✅ **Unified interface** - Agent sees all tools the same way  
✅ **Better architecture** - New tools follow SOLID principles  
✅ **Backward compatible** - Old code still works  
✅ **Forward compatible** - New tools can replace old ones transparently  

---

## 📚 Related Files

- **Legacy System**: `src/shared/ai/tools.service.js`
- **New System**: `src/shared/tools/`
- **Registry**: `src/shared/tools/registry/tool-registry.js`
- **Adapter**: `src/shared/tools/adapters/legacy-tool.adapter.js`
- **Initializer**: `src/shared/tools/tool-initializer.js`
- **Context Config**: `src/services/processor/config/context-tools.config.js`
- **Agent**: `src/shared/agents/performant-agent.js`





