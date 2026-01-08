# Intelligent Model Routing - Implementation Guide

**Date:** December 15, 2025
**Status:** Ready to Integrate
**Priority:** High (enables optimal model selection)

---

## Overview

Created an intelligent routing system that automatically selects the best model for each request based on:
- **Input modality** (text vs text+vision)
- **Query complexity** (simple vs complex reasoning)
- **Task type** (document QA, analysis, conversational)
- **Performance requirements** (speed vs quality)

---

## Available Models

Your Ollama installation has three specialized models:

| Model | Type | Context | Speed | Use Cases |
|-------|------|---------|-------|-----------|
| **llama3.1:8b** | Text | 8K | Fast (30 tok/s) | Simple QA, document QA, summarization |
| **qwen3-vl** | Vision | 32K | Medium (15 tok/s) | Screenshot analysis, OCR, visual QA, complex images |
| **llava:7b** | Vision | 4K | Fast (20 tok/s) | Simple image description, basic visual QA |

---

## Routing Logic

### Decision Tree

```
1. Does request contain images/screenshots?
   ├─ YES → Check visual complexity
   │   ├─ High complexity (analyze, OCR, multiple images)
   │   │   └─> qwen3-vl (primary vision model)
   │   └─ Low complexity (describe, identify)
   │       └─> llava:7b (fast vision model)
   │
   └─ NO → Check text complexity
       ├─ High (analyze, compare, multi-step)
       │   └─> llama3.1:8b (TODO: upgrade to 70b)
       ├─ Medium (summarize, explain)
       │   └─> llama3.1:8b
       └─ Low (hello, thanks, simple questions)
           └─> llama3.1:8b (fast path)
```

---

## Integration Steps

### Step 1: Import Model Router (1 minute)

**File:** `src/services/processor/routes/streaming.routes.js`
**Location:** Top of file with other imports

```javascript
// Add after other imports (around line 35)
const { ModelRouter } = require('../../../shared/routing/model-router.service');
```

### Step 2: Route Model Selection (5 minutes)

**File:** `src/services/processor/routes/streaming.routes.js`
**Location:** Around line 322-330 (where model is extracted from request)

**Replace this:**
```javascript
const {
  message,
  conversation_id,
  session_id,
  matter_id,
  model = 'llama3.1',
  temperature = 0.7,
  max_tokens,
  enable_tools = false,  // Disabled - tool calling creates long contexts that break Ollama
      attachments
} = req.body;
```

**With this:**
```javascript
const {
  message,
  conversation_id,
  session_id,
  matter_id,
  temperature = 0.7,
  max_tokens,
  enable_tools = false,
  attachments,
  performance = 'balanced' // New: 'speed', 'quality', or 'balanced'
} = req.body;

// ═══════════════════════════════════════════════════════════════
// INTELLIGENT MODEL ROUTING
// Automatically select optimal model based on request
// ═══════════════════════════════════════════════════════════════

const routing = ModelRouter.route({
  message,
  attachments,
  conversationHistory: [], // Will be populated later
  matter_id,
  enable_tools,
  performance
});

const model = routing.model;

logInfo('Model routing decision', {
  selectedModel: model,
  reasoning: routing.reasoning,
  confidence: routing.confidence,
  hasAttachments: !!attachments,
  messageLength: message.length
});

// Send routing info to client (optional - for transparency)
sendSSE(res, 'model_selected', {
  model: model,
  reasoning: routing.reasoning.join('; '),
  isVisionModel: ModelRouter.isVisionModel(model)
});
```

### Step 3: Handle Vision Model Inputs (10 minutes)

**File:** `src/services/processor/routes/streaming.routes.js`
**Location:** Around line 750 (where messages array is built for Ollama)

**Add image handling for vision models:**

```javascript
// PHASE 4: BUILD MESSAGES ARRAY
let messages = [];

// System message
let systemMessage = `You are Lana, an AI assistant.`;

if (systemContext) {
  systemMessage += `\n\n${systemContext}`;
}

if (conversationSummary) {
  systemMessage += `\n\n═══════════════════════════════════════
PREVIOUS CONVERSATION SUMMARY
═══════════════════════════════════════

${conversationSummary}

The following are the most recent messages in full detail:
`;
}

// Add retrieved document context if RAG was performed
if (retrievedContext) {
  const docCount = parseInt(activeDocsResult.rows[0]?.count || 0);
  const docNames = activeDocsResult.rows[0]?.filenames || [];

  systemMessage += SmartRAGController.buildDocumentContextHeader(docCount, docNames);
  systemMessage += retrievedContext;
  systemMessage += SmartRAGController.generateRAGInstructions(true);
}

messages.push({
  role: 'system',
  content: systemMessage
});

// Add conversation history
conversationHistory.forEach(msg => {
  messages.push({
    role: msg.role,
    content: msg.content
  });
});

// ═══════════════════════════════════════════════════════════════
// NEW: Add user message with images if vision model
// ═══════════════════════════════════════════════════════════════
const isVisionModel = ModelRouter.isVisionModel(model);

if (isVisionModel && attachments?.images?.length > 0) {
  // Vision model - format with images
  messages.push({
    role: 'user',
    content: message,
    images: attachments.images.map(img => img.data || img.base64 || img.url)
  });

  logInfo('Vision model input prepared', {
    model,
    imageCount: attachments.images.length,
    messageLength: message.length
  });
} else {
  // Text-only model - standard format
  messages.push({
    role: 'user',
    content: message
  });
}
```

### Step 4: Update Token Budget for Vision Models (5 minutes)

**File:** `src/services/processor/routes/streaming.routes.js`
**Location:** Around line 384 (token budget initialization)

**Replace this:**
```javascript
const tokenBudget = new TokenBudgetManager(8192); // 8K context window for llama3.1
```

**With this:**
```javascript
// Get context window size from model config
const modelConfig = ModelRouter.getModelConfig(model);
const contextWindow = modelConfig.contextWindow;

const tokenBudget = new TokenBudgetManager(contextWindow);

logInfo('Token budget initialized', {
  model,
  contextWindow,
  budgets: tokenBudget.budgets
});
```

---

## Testing

### Test 1: Text-Only Query
```bash
curl -X POST "https://localhost:8080/api/v1/streaming/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is quantum computing?",
    "conversation_id": "uuid-here",
    "matter_id": "MATT-00001"
  }'
```

**Expected:**
- Model selected: `llama3.1:8b`
- Reasoning: "Text-only query - using llama3.1:8b"
- No vision processing

### Test 2: Simple Image Query
```bash
curl -X POST "https://localhost:8080/api/v1/streaming/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is in this image?",
    "conversation_id": "uuid-here",
    "attachments": {
      "images": [
        {
          "data": "base64-image-data-here",
          "filename": "screenshot.png"
        }
      ]
    }
  }'
```

**Expected:**
- Model selected: `llava:7b`
- Reasoning: "Simple visual query - using secondary vision model (llava:7b)"
- Image processed

### Test 3: Complex Visual Analysis
```bash
curl -X POST "https://localhost:8080/api/v1/streaming/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Analyze this document and extract all text using OCR",
    "conversation_id": "uuid-here",
    "attachments": {
      "images": [
        {
          "data": "base64-image-of-document",
          "filename": "contract.png"
        }
      ]
    }
  }'
```

**Expected:**
- Model selected: `qwen3-vl`
- Reasoning: "Visual content detected - using primary vision model (qwen3-vl); Image analysis complexity: high"
- OCR performed

### Test 4: Performance Preference
```bash
curl -X POST "https://localhost:8080/api/v1/streaming/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Describe this image",
    "performance": "speed",
    "attachments": {
      "images": [
        {
          "data": "base64-image-data",
          "filename": "photo.jpg"
        }
      ]
    }
  }'
```

**Expected:**
- Model selected: `llava:7b` (faster vision model)
- Even if complexity is medium/high, prioritize speed

---

## Frontend Integration

### Update Chat Frontend

**File:** `public_html/js/chat.js`

**Add model selection info to UI:**

```javascript
// Listen for model_selected event
eventSource.addEventListener('model_selected', (event) => {
  const data = JSON.parse(event.data);

  console.log('Model selected:', data.model);
  console.log('Reasoning:', data.reasoning);

  // Optional: Show in UI
  if (data.isVisionModel) {
    showNotification(`Using vision AI (${data.model}) for image analysis`, 'info');
  }
});
```

### Send Images with Request

```javascript
// When sending message with images
const formData = new FormData();

// Add text message
formData.append('message', userMessage);
formData.append('conversation_id', conversationId);

// Add images
const images = [];
for (const file of selectedFiles) {
  if (file.type.startsWith('image/')) {
    const base64 = await fileToBase64(file);
    images.push({
      data: base64,
      filename: file.name,
      type: file.type
    });
  }
}

if (images.length > 0) {
  formData.append('attachments', JSON.stringify({
    images: images
  }));
}

// Send request
fetch('/api/v1/streaming/chat/stream', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

---

## Routing Examples

### Example 1: Document Question (Text Only)

**Input:**
```json
{
  "message": "What does section 3.2 say about termination?",
  "matter_id": "MATT-00045"
}
```

**Routing Decision:**
```
Model: llama3.1:8b
Reasoning:
  - Query complexity: medium
  - Task type: document_qa
  - Text-only query - using llama3.1:8b
Confidence: 1.0
```

### Example 2: Screenshot Analysis

**Input:**
```json
{
  "message": "What error message is shown in this screenshot?",
  "attachments": {
    "images": [{ "data": "...", "filename": "error.png" }]
  }
}
```

**Routing Decision:**
```
Model: llava:7b
Reasoning:
  - Visual content detected - using secondary vision model (llava:7b)
  - Image analysis complexity: low
Confidence: 1.0
```

### Example 3: Complex Document OCR

**Input:**
```json
{
  "message": "Extract all text from these contract pages and summarize the key terms",
  "attachments": {
    "images": [
      { "data": "...", "filename": "page1.jpg" },
      { "data": "...", "filename": "page2.jpg" },
      { "data": "...", "filename": "page3.jpg" }
    ]
  }
}
```

**Routing Decision:**
```
Model: qwen3-vl
Reasoning:
  - Visual content detected - using primary vision model (qwen3-vl)
  - Image analysis complexity: high
  - Multiple images detected (3 images)
Confidence: 1.0
Fallback: llava:7b
```

### Example 4: Complex Analysis (Text)

**Input:**
```json
{
  "message": "Compare and analyze the differences between these two contracts, highlighting any contradictions and assessing the legal implications",
  "matter_id": "MATT-00045",
  "performance": "quality"
}
```

**Routing Decision:**
```
Model: llama3.1:8b
Reasoning:
  - Query complexity: high
  - Task type: comparison
  - Text-only query - using llama3.1:8b
  - ⚠️ High complexity query - would benefit from larger model (llama3.1:70b)
Confidence: 0.7
```

**Note:** The warning indicates that upgrading to llama3.1:70b would improve results.

---

## Monitoring & Analytics

### Track Model Usage

**Add to database:**
```sql
-- Track which models are used for what queries
CREATE TABLE IF NOT EXISTS model_routing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  conversation_id UUID,
  message_id UUID,
  selected_model VARCHAR(100),
  query_complexity VARCHAR(20),
  task_type VARCHAR(50),
  has_vision_input BOOLEAN,
  routing_confidence FLOAT,
  response_time_ms INT,
  user_rating INT,  -- 1-5 stars
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Log routing decisions:**
```javascript
// After model routing
await postgres.query(`
  INSERT INTO model_routing_logs (
    user_id, conversation_id, message_id,
    selected_model, query_complexity, task_type,
    has_vision_input, routing_confidence
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`, [
  req.user.id,
  conversation_id,
  messageId,
  model,
  routing.complexity,
  routing.taskType,
  !!attachments?.images,
  routing.confidence
]);
```

### Analytics Queries

**Most used models:**
```sql
SELECT
  selected_model,
  COUNT(*) as usage_count,
  AVG(response_time_ms) as avg_response_time,
  AVG(user_rating) as avg_rating
FROM model_routing_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY selected_model
ORDER BY usage_count DESC;
```

**Model performance by task type:**
```sql
SELECT
  task_type,
  selected_model,
  COUNT(*) as count,
  AVG(response_time_ms) as avg_time,
  AVG(user_rating) as avg_rating
FROM model_routing_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY task_type, selected_model
ORDER BY task_type, avg_rating DESC;
```

---

## Future Enhancements

### Phase 1: Add llama3.1:70b Support (Next Week)

**Update ModelRouter.MODELS:**
```javascript
TEXT_LARGE: {
  name: 'llama3.1:70b-instruct-q4_K_M',
  type: 'text',
  contextWindow: 131072, // 128K
  speed: 'slow',         // ~5-8 tokens/sec
  quality: 'excellent',
  use_cases: ['complex_reasoning', 'multi_step', 'detailed_analysis'],
  cost: 'high'
}
```

**Update routing logic:**
```javascript
// In route() method, after assessing complexity
if (queryComplexity === 'high' && performance !== 'speed') {
  routing.model = this.MODELS.TEXT_LARGE.name;
  routing.reasoning.push('High complexity - using llama3.1:70b for best reasoning');
} else {
  routing.model = this.MODELS.TEXT_SMALL.name;
  routing.reasoning.push('Standard complexity - using llama3.1:8b');
}
```

### Phase 2: Performance-Based Routing

```javascript
// Route based on historical performance
static async routeWithPerformanceData(request, performanceHistory) {
  const baseRouting = this.route(request);

  // Check if selected model is overloaded
  const modelLoad = await this.checkModelLoad(baseRouting.model);

  if (modelLoad > 0.8 && baseRouting.fallback) {
    // Model is busy, use fallback
    return {
      ...baseRouting,
      model: baseRouting.fallback,
      reasoning: [...baseRouting.reasoning, 'Primary model overloaded, using fallback']
    };
  }

  return baseRouting;
}
```

### Phase 3: User Preference Learning

```javascript
// Learn user preferences over time
static async routeWithUserPreferences(request, userId) {
  const baseRouting = this.route(request);

  // Check user's historical preferences
  const userPrefs = await this.getUserModelPreferences(userId);

  // If user consistently rates a different model higher, adjust
  if (userPrefs.preferredModel !== baseRouting.model) {
    return {
      ...baseRouting,
      model: userPrefs.preferredModel,
      reasoning: [...baseRouting.reasoning, 'Using user-preferred model based on history']
    };
  }

  return baseRouting;
}
```

---

## Benefits

### Immediate Benefits

✅ **Optimal Model Selection**
- Right model for each task automatically
- Vision models only when needed
- Fast models for simple queries

✅ **Better Resource Utilization**
- Don't waste GPU on simple text queries
- Use powerful vision models only when beneficial
- Balance speed vs quality automatically

✅ **Improved User Experience**
- Faster responses for simple queries
- Better analysis for complex queries
- Image/screenshot support automatically

### Future Benefits (with 70b)

✅ **Intelligent Load Balancing**
- Route to different models based on load
- Optimize for cost and performance

✅ **Quality-Speed Tradeoff**
- User can choose speed vs quality
- System learns user preferences

✅ **Cost Optimization**
- Track model usage and costs
- Optimize routing for budget

---

## Rollout Plan

### Week 1: Basic Integration
- [ ] Integrate ModelRouter into streaming.routes.js
- [ ] Test text-only routing (should all go to llama3.1:8b)
- [ ] Verify no regressions

### Week 2: Vision Support
- [ ] Add image attachment handling
- [ ] Test vision model routing (llava:7b vs qwen3-vl)
- [ ] Update frontend for image uploads

### Week 3: Analytics
- [ ] Add routing logs to database
- [ ] Create analytics dashboard
- [ ] Monitor model usage patterns

### Week 4: Optimization
- [ ] Add llama3.1:70b for complex queries
- [ ] Implement performance-based routing
- [ ] Fine-tune routing thresholds

---

## Next Steps

1. **Review this implementation guide**
2. **Integrate Steps 1-4 into streaming.routes.js** (20-30 minutes)
3. **Test with sample queries** (10 minutes)
4. **Deploy and monitor** (ongoing)

The Model Router is ready to use - just needs integration into the streaming endpoint!
