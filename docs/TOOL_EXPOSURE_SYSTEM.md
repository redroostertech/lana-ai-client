# Tool Exposure System - How Functions Are Made Available

## 🎯 Overview

The performant agent uses a **3-layer system** to identify and expose the right tools/functions to users:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Tool Registration (ToolRegistry)              │
│  All available tools in the system                      │
└───────────────────┬─────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Context-Based Scoping (context-tools.config)  │
│  Maps frontend contexts to relevant tool subsets        │
└───────────────────┬─────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Agent Execution (performant-agent.js)         │
│  LLM uses scoped tools dynamically                      │
└─────────────────────────────────────────────────────────┘
```

---

## 📋 Layer 1: Tool Registry (All Available Tools)

**Location:** `src/shared/tools/registry/tool-registry.js`

The ToolRegistry is a **singleton** that manages all tools in the system.

### How Tools Are Registered

```javascript
// Tools register themselves at startup
const ToolRegistry = require('./tool-registry');
const myTool = new SearchDocumentsTool();

ToolRegistry.register(myTool, 'documents'); // Register with category
```

### Available Operations

```javascript
// Get all registered tools
const allTools = ToolRegistry.getAllTools();
// Returns: Array of tool instances

// Get specific tool
const tool = ToolRegistry.getTool('search_documents');
// Returns: Tool instance or null

// Check if tool exists
const exists = ToolRegistry.hasTool('search_documents');
// Returns: boolean

// Get tools by category
const docTools = ToolRegistry.getToolsByCategory('documents');
// Returns: Array of document-related tools

// Get statistics
const stats = ToolRegistry.getStats();
// Returns: { totalTools: 35, toolNames: [...], categories: [...] }
```

### Tool Schema Format

Each tool must implement:

```javascript
class MyTool {
  getName() {
    return 'my_tool';
  }

  getDescription() {
    return 'What this tool does';
  }

  getParametersSchema() {
    return {
      type: 'object',
      properties: {
        param1: { type: 'string', description: '...' }
      },
      required: ['param1']
    };
  }

  validateParameters(params) {
    // Validation logic
  }

  async execute(params, context) {
    // Tool implementation
  }

  toOllamaSchema() {
    // Converts to Ollama's tool format
    return {
      name: this.getName(),
      description: this.getDescription(),
      parameters: this.getParametersSchema()
    };
  }
}
```

---

## 🎨 Layer 2: Context-Based Tool Scoping

**Location:** `src/services/processor/config/context-tools.config.js`

Maps **frontend context types** to **relevant tool subsets**.

### Context Mappings

```javascript
const CONTEXT_TOOL_MAPPINGS = {
  // Full chat - all tools available
  full_chat: {
    tools: [
      'search_documents',
      'get_document_summary',
      'list_tasks',
      'get_deadlines',
      'search_matters',
      'get_client',
      // ... 15+ tools
    ],
    needsDocuments: true,
    needsRAG: true,
    description: 'Full-featured chat'
  },

  // Document chat - only document tools
  document_chat: {
    tools: [
      'search_documents',
      'get_document_summary',
      'get_document',
      'list_documents'
    ],
    needsDocuments: true,
    needsRAG: true,
    description: 'Chat with documents'
  },

  // Task management - only task tools
  tasks_management: {
    tools: [
      'list_tasks',
      'get_deadlines',
      'list_workflows'
    ],
    needsDocuments: false,
    needsRAG: false,
    description: 'Manage tasks'
  },

  // General chat - no tools
  general_chat: {
    tools: [],
    needsDocuments: false,
    needsRAG: false,
    description: 'Simple conversation'
  }
};
```

### How Scoping Works

```javascript
// Frontend sends context_type in request
{
  "message": "Find documents about contracts",
  "context_type": "document_chat",  // ← Frontend declares context
  "matter_id": "MATT-00001"
}

// Backend resolves tools for that context
const tools = getToolsForContext('document_chat');
// Returns: [search_documents, get_document_summary, get_document, list_documents]

// Can also merge multiple contexts
const tools = getToolsForContext('document_chat', ['tasks_management']);
// Returns: document tools + task tools combined
```

### Key Functions

```javascript
/**
 * Get context configuration
 */
function getContextConfig(contextType) {
  return CONTEXT_TOOL_MAPPINGS[contextType] || CONTEXT_TOOL_MAPPINGS.full_chat;
}

/**
 * Get tools for a specific context
 */
function getToolsForContext(primaryContext, additionalContexts = []) {
  // 1. Get tool names from config
  const toolNames = ['search_documents', 'get_document', ...];
  
  // 2. Convert tool names to Ollama schemas
  const toolSchemas = convertToolNamesToSchemas(toolNames);
  
  // 3. Return ready-to-use tool objects
  return toolSchemas;
}

/**
 * Check if context needs documents/RAG
 */
function needsDocumentsForContext(primaryContext, additionalContexts = []) {
  const config = getContextConfig(primaryContext);
  return config.needsDocuments;
}
```

### Tool Name → Schema Conversion

```javascript
function convertToolNamesToSchemas(toolNames) {
  const toolSchemas = [];
  
  for (const toolName of toolNames) {
    // Get tool from registry
    const tool = ToolRegistry.getTool(toolName);
    
    if (tool) {
      // Convert to Ollama format
      const schema = tool.toOllamaSchema();
      toolSchemas.push(schema);
    } else {
      logWarn('Tool not found', { toolName });
    }
  }
  
  return toolSchemas;
}
```

---

## 🤖 Layer 3: Agent Execution (Using Tools)

**Location:** `src/shared/agents/performant-agent.js`

The agent receives scoped tools and uses them dynamically.

### How It Works

```javascript
class PerformantAgent {
  async executeAgenticFlow(session, toolContext, eventCallback, startTime) {
    const { scopedTools } = session;
    
    // Build rich system prompt with tool information
    const systemPrompt = this.buildRichSystemPrompt(session, scopedTools);
    
    // Provide tools to LLM
    const chatResult = await ollamaService.generateChatWithTools(
      messages,
      { model, temperature, num_predict: max_tokens },
      scopedTools,  // ← LLM has access to these tools
      streamCallback,
      abortSignal,
      toolContext
    );
    
    // LLM decides which tools to call based on:
    // 1. The system prompt (explains what each tool does)
    // 2. The user's question
    // 3. The conversation context
  }
}
```

### Rich System Prompt Generation

```javascript
buildRichSystemPrompt(session, tools) {
  let prompt = systemPromptService.BASE_SYSTEM_PROMPT;
  
  // Add tool information
  if (tools.length > 0) {
    prompt += `\n\n## Available Tools\n`;
    tools.forEach(tool => {
      prompt += `\n### ${tool.name}\n`;
      prompt += `${tool.description}\n`;
      prompt += `Parameters: ${Object.keys(tool.parameters.properties).join(', ')}\n`;
    });
    
    prompt += `\n## Tool Usage Guidelines\n`;
    prompt += `1. Use tools when you need information\n`;
    prompt += `2. Call multiple tools if needed\n`;
    prompt += `3. Synthesize results into helpful answer\n`;
  }
  
  return prompt;
}
```

---

## 🔄 Complete Flow Example

### Example 1: Document Chat

```javascript
// 1. Frontend Request
POST /api/v1/streaming/chat/stream
{
  "message": "Find documents about contracts",
  "context_type": "document_chat",
  "matter_id": "MATT-00001"
}

// 2. Context Resolution (streaming.routes.js)
const contextConfig = getContextConfig('document_chat');
// Returns: { tools: ['search_documents', ...], needsDocuments: true }

const scopedTools = getToolsForContext('document_chat');
// Returns: [
//   { name: 'search_documents', description: '...', parameters: {...} },
//   { name: 'get_document_summary', description: '...', parameters: {...} },
//   ...
// ]

// 3. Agent Execution (performant-agent.js)
const systemPrompt = buildRichSystemPrompt(session, scopedTools);
// Includes descriptions of search_documents, get_document_summary, etc.

// 4. LLM Decision Making
// LLM reads: "User wants contracts, I have search_documents tool"
// LLM calls: search_documents({ query: "contracts", max_results: 5 })

// 5. Tool Execution
const result = await ToolRegistry.getTool('search_documents').execute(
  { query: "contracts", max_results: 5 },
  toolContext
);

// 6. Response Synthesis
// LLM receives tool results and generates natural response
```

### Example 2: Task Management

```javascript
// 1. Frontend Request
POST /api/v1/streaming/chat/stream
{
  "message": "What tasks are due this week?",
  "context_type": "tasks_management"
}

// 2. Context Resolution
const scopedTools = getToolsForContext('tasks_management');
// Returns: [
//   { name: 'list_tasks', ... },
//   { name: 'get_deadlines', ... }
// ]
// Note: NO document tools, only task-related tools!

// 3. LLM Decision
// LLM calls: get_deadlines({ filter: 'this_week' })

// 4. Response
// "You have 3 tasks due this week: ..."
```

---

## 📊 How to Check Available Tools

### 1. Check All Registered Tools

```javascript
// In code
const { ToolRegistry } = require('./shared/tools/registry/tool-registry');

// Get stats
const stats = ToolRegistry.getStats();
console.log(stats);
// Output: {
//   totalTools: 35,
//   totalCategories: 6,
//   toolNames: ['search_documents', 'list_tasks', ...],
//   categories: ['documents', 'tasks', 'matters', ...]
// }

// Get all tool names
const allToolNames = ToolRegistry.getAllTools().map(t => t.getName());
console.log(allToolNames);
```

### 2. Check Tools for Specific Context

```javascript
const { getToolsForContext, getContextConfig } = require('./config/context-tools.config');

// Get configuration
const config = getContextConfig('document_chat');
console.log(config);
// Output: {
//   tools: ['search_documents', 'get_document_summary', ...],
//   needsDocuments: true,
//   needsRAG: true,
//   description: 'Chat with documents'
// }

// Get actual tool schemas
const tools = getToolsForContext('document_chat');
console.log(tools.map(t => t.name));
// Output: ['search_documents', 'get_document_summary', ...]
```

### 3. Check via API Endpoint

```bash
# Get available tools
GET /api/v1/streaming/tools

# Response:
{
  "tools": [
    {
      "name": "search_documents",
      "description": "Search through documents for specific content",
      "parameters": { ... }
    },
    ...
  ],
  "count": 35,
  "enabled": true
}
```

### 4. Check Available Contexts

```javascript
const { getAvailableContexts } = require('./config/context-tools.config');

const contexts = getAvailableContexts();
console.log(contexts);
// Output: [
//   'full_chat',
//   'document_chat',
//   'tasks_management',
//   'matter_chat',
//   'analytics_dashboard',
//   'calendar_management',
//   'general_chat'
// ]
```

---

## 🛠️ Adding New Tools

### Step 1: Create Tool Class

```javascript
// src/shared/tools/my-new-tool.js
const { BaseTool } = require('./base-tool');

class MyNewTool extends BaseTool {
  getName() {
    return 'my_new_tool';
  }

  getDescription() {
    return 'Does something amazing';
  }

  getParametersSchema() {
    return {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'What to process'
        }
      },
      required: ['input']
    };
  }

  async execute(params, context) {
    // Implementation
    return {
      success: true,
      data: { result: 'Amazing result!' }
    };
  }
}

module.exports = { MyNewTool };
```

### Step 2: Register Tool

```javascript
// src/shared/tools/index.js
const { ToolRegistry } = require('./registry/tool-registry');
const { MyNewTool } = require('./my-new-tool');

// Register on startup
ToolRegistry.register(new MyNewTool(), 'custom');
```

### Step 3: Add to Context Mapping

```javascript
// src/services/processor/config/context-tools.config.js
const CONTEXT_TOOL_MAPPINGS = {
  full_chat: {
    tools: [
      'search_documents',
      'list_tasks',
      'my_new_tool',  // ← Add your tool here
      // ...
    ],
    // ...
  }
};
```

### Step 4: Test

```javascript
// Check registration
const tool = ToolRegistry.getTool('my_new_tool');
console.log(tool ? 'Registered!' : 'Not found');

// Check in context
const tools = getToolsForContext('full_chat');
const hasMyTool = tools.some(t => t.name === 'my_new_tool');
console.log(hasMyTool ? 'Available!' : 'Not available');

// Use in chat
POST /api/v1/streaming/chat/stream
{
  "message": "Use my new tool",
  "context_type": "full_chat"
}
// LLM will see my_new_tool and can call it!
```

---

## 🎯 Summary

### How Tools Are Identified

1. **Registration**: Tools register with `ToolRegistry` at startup
2. **Scoping**: `context-tools.config.js` maps contexts to tool subsets
3. **Resolution**: Frontend sends `context_type`, backend resolves tools
4. **Exposure**: Tools provided to LLM in system prompt
5. **Usage**: LLM dynamically decides which tools to call

### Key Files

- **Tool Registry**: `src/shared/tools/registry/tool-registry.js`
- **Context Config**: `src/services/processor/config/context-tools.config.js`
- **Agent**: `src/shared/agents/performant-agent.js`
- **Tool Definitions**: `src/shared/tools/*.js`

### Benefits of This System

✅ **Zero latency** - No AI classification needed  
✅ **100% accuracy** - Frontend knows the context  
✅ **Reduced tokens** - Only relevant tools in prompt  
✅ **Easy maintenance** - Single config file  
✅ **Type safety** - Tool schemas validated at registration  
✅ **Flexibility** - Can merge multiple contexts  
✅ **Observability** - Can inspect tools at any layer  

---

## 📚 Related Documentation

- [Performant Agent Architecture](./PERFORMANT_AGENTIC_ARCHITECTURE.md)
- [Tool Registry API](../src/shared/tools/registry/README.md)
- [Context-Based Tool Scoping](../src/services/processor/config/README.md)





