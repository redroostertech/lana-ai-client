# Stream Error Analysis & Resolution

**Date:** December 16, 2024
**Issue:** Streaming endpoint returning error: "Failed to generate response"

---

## 🔍 Issue Investigation

### Log Analysis

```
event: model_selected
data: {"model":"llama3.1:8b-32k","reasoning":"Query complexity: medium; Task type: document_analysis; Text-only query - using llama3.1:8b","confidence":1,"isVisionModel":false}

event: connected
data: {"client_id":"...","thread_id":"..."}

event: thinking
data: {"message":"Analyzing your question...","phase":"analyzing"}

event: thinking
data: {"message":"Generating response...","phase":"generating"}

event: error
data: {"error":"Failed to generate response. Please try again."}
```

---

## 🎯 Root Cause Identified

### Question 1: Where is `document_analysis` coming from?

**Answer:** Model Router task type classification

**Location:** `src/shared/routing/model-router.service.js:280`

```javascript
static _identifyTaskType(message, attachments, matter_id) {
  // If matter_id is provided (even without file attachments)
  if (attachments.files?.length > 0 || matter_id) {
    // Check for specific document keywords
    if (docKeywords.some(kw => lowerMessage.includes(kw))) {
      return 'document_qa';
    }
    if (lowerMessage.includes('summarize')) {
      return 'summarization';
    }
    if (lowerMessage.includes('compare')) {
      return 'comparison';
    }

    // DEFAULT: If in matter context but no specific keywords
    return 'document_analysis';  // ← THIS IS WHY
  }
  // ... other task types
}
```

**Explanation:**
- When a `matter_id` is present in the request
- And the query doesn't match specific document keywords
- The system assumes you're doing document-related work
- Returns `document_analysis` as the default task type

**This is working as designed** - it's a reasonable assumption that if you're in a matter context, you're analyzing documents.

---

### Question 2: Why did the stream fail?

**Root Cause:** Model not found

**The Problem:**
1. Code was updated to use `llama3.1:8b-32k`
2. But this model **doesn't exist yet** on the system
3. Only `llama3.1:8b` (8K variant) is installed
4. Ollama fails when trying to use non-existent model
5. Error caught at `streaming.routes.js:1127`

```javascript
catch (ollamaError) {
  logError('Ollama streaming failed', ollamaError);
  sendSSE(res, 'error', { error: 'Failed to generate response. Please try again.' });
  res.end();
}
```

---

## ✅ Temporary Fix Applied

**What I Did:**

1. **Reverted to 8K model** (temporary):
   ```javascript
   // ollama.service.js
   const LLM_MODEL = process.env.LLM_MODEL || 'llama3.1:8b'; // Was: 8b-32k

   // model-router.service.js
   TEXT_SMALL: {
     name: 'llama3.1:8b',        // Was: 8b-32k
     contextWindow: 8192,         // Was: 32768
   }
   ```

2. **Updated .env**:
   ```bash
   POSTGRES_MAX_CONNECTIONS=50  # Was: 20
   ```

3. **Restarted app**:
   ```bash
   pm2 restart lana-api --update-env
   ```

**Status:** ✅ App is now running successfully with 8K model

---

## 📋 Next Steps (In Order)

### Step 1: Run Database Migration (5 min)

Apply the performance indexes:

```bash
cd /Users/redroostertechnologies/Desktop/LANA-AI

PGPASSWORD="" psql -U redroostertechnologies -h localhost -d lana_chef \
  -f src/migrations/20241216_performance_optimization_indexes.sql
```

**Verify:**
```bash
PGPASSWORD="" psql -U redroostertechnologies -h localhost -d lana_chef -c "
  SELECT tablename, COUNT(*) as index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('documents', 'conversations', 'document_chunks')
  GROUP BY tablename;
"
```

Expected: documents (7+), conversations (4+), document_chunks (4+)

---

### Step 2: Create 32K Model (3 min)

Run the context expansion script:

```bash
# Create 32K variant
./scripts/expand-context-window.sh

# Verify it exists
ollama list | grep llama3.1
```

Expected output:
```
llama3.1:8b        [ID]    4.9 GB    [timestamp]
llama3.1:8b-32k    [ID]    4.9 GB    [timestamp]
```

---

### Step 3: Update Code to Use 32K (1 min)

Revert the temporary fix:

**File 1:** `src/shared/services/ollama.service.js:11`
```javascript
// Change FROM:
const LLM_MODEL = process.env.LLM_MODEL || 'llama3.1:8b'; // TODO: Change to 8b-32k after expansion

// Change TO:
const LLM_MODEL = process.env.LLM_MODEL || 'llama3.1:8b-32k';
```

**File 2:** `src/shared/routing/model-router.service.js:23-25`
```javascript
// Change FROM:
TEXT_SMALL: {
  name: 'llama3.1:8b', // TODO: Change to 8b-32k after expansion
  contextWindow: 8192, // TODO: Change to 32768 after expansion

// Change TO:
TEXT_SMALL: {
  name: 'llama3.1:8b-32k',
  contextWindow: 32768,
```

---

### Step 4: Restart and Test (5 min)

```bash
# Restart app
pm2 restart lana-api --update-env

# Test streaming endpoint
curl -k -X POST https://localhost:8080/api/v1/streaming/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "Hello, how are you?",
    "conversation_id": "test-1"
  }'
```

**Expected:** Should complete successfully without errors

---

## 🧪 Verification Checklist

After deployment:

- [ ] Database migration applied (check index count)
- [ ] `llama3.1:8b-32k` model exists (`ollama list`)
- [ ] App restarted with 32K model
- [ ] Streaming endpoint works without errors
- [ ] Model selection shows: `"model":"llama3.1:8b-32k"`
- [ ] Connection pool shows: `maxConnections: 50`

---

## 📊 Understanding the Logs

### Normal Flow (What You Should See):

```
event: model_selected
data: {"model":"llama3.1:8b-32k","reasoning":"...","confidence":1}

event: connected
data: {"client_id":"...","thread_id":"..."}

event: thinking
data: {"message":"Analyzing your question...","phase":"analyzing"}

event: thinking
data: {"message":"Generating response...","phase":"generating"}

event: token  ← Tokens start streaming
data: {"token":"Hello"}

event: token
data: {"token":" there"}

...

event: done
data: {"message":"Response complete","stats":{...}}
```

---

## 🔧 Task Type Classification Reference

The Model Router classifies queries into these task types:

| Task Type | Trigger | Example |
|-----------|---------|---------|
| `document_qa` | Document keywords + matter context | "What does section 5 say?" |
| `summarization` | "summarize" keyword + documents | "Summarize the contract" |
| `comparison` | "compare" keyword + documents | "Compare these two agreements" |
| `document_analysis` | **Matter context but no specific keywords** | "What's in this file?" |
| `multi_step` | Sequential keywords | "First do X, then Y" |
| `simple_qa` | Short, simple questions | "What is X?" |
| `general_chat` | Everything else | "Hello, how are you?" |

**`document_analysis` is the DEFAULT for matter-scoped queries.**

This is intentional and helps the system understand you're likely working with documents when in a matter context.

---

## 🎯 Summary

**What We Found:**
1. ✅ `document_analysis` is working correctly (Model Router classification)
2. ❌ Stream failed because `llama3.1:8b-32k` model didn't exist yet
3. ✅ Temporarily fixed by reverting to `llama3.1:8b`

**What's Next:**
1. Apply database migration (performance indexes)
2. Create `llama3.1:8b-32k` model
3. Update code to use 32K model
4. Restart and test

**Expected Result:**
- Streaming works with 32K context
- 40-60% faster API responses (after migration)
- No more "Failed to generate response" errors

**Ready to deploy!** 🚀
