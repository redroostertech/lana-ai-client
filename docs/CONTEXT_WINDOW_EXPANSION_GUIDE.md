# Context Window Expansion: 8K → 32K

**Model:** llama3.1:8b
**Hardware:** M4 Mac Mini
**Goal:** Expand from 8,192 tokens to 32,768 tokens
**Method:** Model configuration parameter change

---

## How It Works

### The Simple Truth

Expanding the context window is **just a configuration change**, not a model upgrade:

1. **No new download required** - Uses your existing llama3.1:8b model
2. **No retraining needed** - Same model weights
3. **Just changes a parameter** - `num_ctx` in the modelfile
4. **Creates a variant** - New model name with same weights

### Technical Explanation

The context window limit is set by a configuration parameter:

```
# Current (default)
PARAMETER num_ctx 8192

# Expanded
PARAMETER num_ctx 32768
```

**What happens:**
- Ollama loads the same 8B parameter model
- Allocates more memory for the context/KV cache
- Allows longer prompts and conversations
- Same model quality, just bigger buffer

**Analogy:** It's like increasing your browser's tab memory limit - same browser, more capacity.

---

## Step-by-Step Expansion

### Method 1: Using Our Script (Recommended)

```bash
# Make executable
chmod +x scripts/expand-context-window.sh

# Run expansion
./scripts/expand-context-window.sh
```

**What the script does:**
1. Exports current `llama3.1:8b` modelfile
2. Adds/updates `PARAMETER num_ctx 32768`
3. Creates new model: `llama3.1:8b-32k`
4. Verifies creation
5. Original model remains unchanged

**Output:**
```
✅ Context Window Expansion Complete!

Summary:
  • Original model: llama3.1:8b (8K context)
  • New model: llama3.1:8b-32k (32K context)
  • Context expanded: 8,192 → 32,768 tokens (4x increase)
```

---

### Method 2: Manual (Advanced Users)

```bash
# 1. Export current modelfile
ollama show llama3.1:8b --modelfile > /tmp/modelfile

# 2. Edit the file
echo "" >> /tmp/modelfile
echo "PARAMETER num_ctx 32768" >> /tmp/modelfile

# 3. Create new model
ollama create llama3.1:8b-32k -f /tmp/modelfile

# 4. Verify
ollama list | grep llama3.1
```

---

### Method 3: Direct Configuration (Temporary)

```bash
# Set environment variable (applies to current session)
export OLLAMA_NUM_CTX=32768

# Start Ollama with expanded context
ollama serve
```

**Note:** This is temporary and resets when Ollama restarts.

---

## Performance Impact on M4 Mac Mini

### Memory Impact

**RAM Usage Increase:**

| Context Size | Base Model | KV Cache | Total RAM | M4 Impact |
|--------------|------------|----------|-----------|-----------|
| 8K (default) | ~8 GB | ~0.5 GB | ~8.5 GB | ✅ Comfortable |
| 16K | ~8 GB | ~1 GB | ~9 GB | ✅ Good |
| 32K | ~8 GB | ~2 GB | ~10 GB | ✅ Fine |
| 64K | ~8 GB | ~4 GB | ~12 GB | ⚠️ Tight (if 16GB RAM) |

**Your M4 Mac Mini:**
```bash
# Check your RAM
sysctl hw.memsize | awk '{print $2/1024/1024/1024 " GB"}'
```

**Recommendations:**
- **16GB RAM or more:** ✅ Safe to go to 32K
- **32GB RAM or more:** ✅ Safe to go to 64K
- **8GB RAM:** ⚠️ Stick with 8K-16K

**Why the increase?**
The model needs to store the "Key-Value cache" for all tokens in context:
- More context = larger cache
- Cache size ≈ context_size × hidden_dim × num_layers × 2 bytes
- 32K context ≈ +2GB RAM vs 8K

---

### Speed Impact

**Inference Speed:**

| Context Size | Tokens/Second | Slowdown vs 8K | Real-World Impact |
|--------------|---------------|----------------|-------------------|
| 8K (default) | ~30 tok/s | Baseline | Fast |
| 16K | ~25 tok/s | -17% | Slightly slower |
| 32K | ~20 tok/s | -33% | Noticeably slower |
| 64K | ~15 tok/s | -50% | Much slower |

**Why slower?**
The attention mechanism has **quadratic complexity** with context size:
- 8K context: 64M attention operations
- 32K context: 1B attention operations (16x more!)
- Each token generation looks at ALL previous tokens

**Calculation:**
```
Attention operations = context_size²
8K:  8,192²  = 67M operations
32K: 32,768² = 1,073M operations (16x more)
```

**M4 Mac Mini Performance:**
- **CPU:** M4 10-core (very fast)
- **GPU:** M4 10-core Metal (accelerated)
- **Neural Engine:** 16-core (may help)
- **Unified Memory:** Fast bandwidth

**Expected real-world speed on M4:**
- 8K context: ~30 tokens/second
- 32K context: ~18-22 tokens/second
- **~25-35% slower** than 8K

---

### Quality Impact

**Answer Quality:** ✅ **SAME**
- Same model weights
- Same training data
- Same capabilities
- No degradation in accuracy

**What you gain:**
- ✅ Can handle 4x longer conversations
- ✅ Can process 4x more document context
- ✅ Better multi-document synthesis
- ✅ No "context overflow" errors

**What you don't gain:**
- ❌ Not smarter/better reasoning
- ❌ Not more knowledgeable
- ❌ Same quality, just bigger buffer

---

## Real-World Performance Tests

### Test Setup
```bash
# Check current performance (8K)
time curl -X POST http://localhost:11434/api/generate \
  -d '{
    "model": "llama3.1:8b",
    "prompt": "'"$(head -c 1000 /dev/urandom | base64)"'",
    "stream": false
  }'
```

### Expected Results

**Short prompt (< 1K tokens):**
- 8K model: ~30 tok/s
- 32K model: ~30 tok/s
- **No difference** (context not used)

**Medium prompt (4K tokens):**
- 8K model: ~28 tok/s
- 32K model: ~26 tok/s
- **~7% slower**

**Long prompt (15K tokens):**
- 8K model: ❌ Error (exceeds context)
- 32K model: ~20 tok/s
- **Works!** (impossible before)

**Very long prompt (30K tokens):**
- 8K model: ❌ Error (exceeds context)
- 32K model: ~18 tok/s
- **Works!** (impossible before)

---

## When to Use 32K vs 8K

### Use 8K (Default) When:
- ✅ Short conversations (< 5 messages)
- ✅ Single document queries
- ✅ Speed is critical
- ✅ Simple Q&A

**Advantages:**
- Faster responses
- Lower RAM usage
- Sufficient for 90% of queries

---

### Use 32K When:
- ✅ Long conversations (15+ messages)
- ✅ Multiple document analysis
- ✅ Complex synthesis tasks
- ✅ Detailed summaries

**Advantages:**
- No context overflow
- Better multi-turn reasoning
- Can handle more documents

---

## Hybrid Approach (Recommended)

Keep **both models** and route intelligently:

```javascript
// In ModelRouter
TEXT_SMALL: {
  name: 'llama3.1:8b',      // Fast, 8K context
  contextWindow: 8192,
  speed: 'fast',
  use_cases: ['simple_qa', 'short_conversations']
},

TEXT_LARGE_CONTEXT: {
  name: 'llama3.1:8b-32k',  // Slower, 32K context
  contextWindow: 32768,
  speed: 'medium',
  use_cases: ['long_conversations', 'multi_document', 'complex_analysis']
}
```

**Routing logic:**
```javascript
// Count conversation history
const messageCount = conversationHistory.length;

// Count document chunks
const documentChunks = attachments?.files?.length || 0;

// Route to appropriate model
if (messageCount > 15 || documentChunks > 5) {
  model = 'llama3.1:8b-32k';  // Need more context
} else {
  model = 'llama3.1:8b';       // Fast path
}
```

**Best of both worlds:**
- Fast responses for simple queries (8K)
- Large context when needed (32K)
- Automatic routing
- Optimal resource usage

---

## Disk Space Impact

**Storage required:**

```bash
# Check current disk usage
ollama list

# Expected sizes
llama3.1:8b      → 4.7 GB (original)
llama3.1:8b-32k  → 4.7 GB (variant)
                   -------
Total            → 9.4 GB
```

**Why same size?**
- Same model weights (shared)
- Just different configuration
- Ollama may deduplicate (actual usage ~5GB)

**Check available space:**
```bash
df -h | grep -E 'Filesystem|/$'
```

**Recommendation:**
- Need at least 10GB free for safe operation
- Models stored in `~/.ollama/models/`

---

## How to Enable in Your App

### Option 1: Environment Variable (Simplest)

```bash
# Add to .env or environment
export LLM_MODEL=llama3.1:8b-32k

# Restart app
pm2 restart lana-ai
```

**Pros:**
- Quick and easy
- No code changes
- Works immediately

**Cons:**
- All queries use 32K (slower for simple ones)
- No intelligent routing

---

### Option 2: Update Model Router (Recommended)

**File:** `src/shared/routing/model-router.service.js`

```javascript
static MODELS = {
  TEXT_SMALL: {
    name: 'llama3.1:8b',      // Keep fast 8K for simple queries
    type: 'text',
    contextWindow: 8192,
    speed: 'fast',
    quality: 'good',
    use_cases: ['simple_qa', 'document_qa', 'summarization'],
    cost: 'low'
  },

  TEXT_LARGE_CONTEXT: {
    name: 'llama3.1:8b-32k',  // Add 32K for complex queries
    type: 'text',
    contextWindow: 32768,
    speed: 'medium',           // Slower
    quality: 'good',
    use_cases: ['long_conversations', 'multi_document', 'complex_analysis'],
    cost: 'medium'
  },

  // ... vision models stay the same
}
```

**Update routing logic:**
```javascript
// In route() method
if (queryComplexity === 'high' || conversationHistory.length > 15) {
  routing.model = this.MODELS.TEXT_LARGE_CONTEXT.name;
  routing.reasoning.push('Complex query or long conversation - using 32K context');
} else {
  routing.model = this.MODELS.TEXT_SMALL.name;
  routing.reasoning.push('Standard query - using 8K context (faster)');
}
```

**Pros:**
- Intelligent routing
- Fast when possible
- Large context when needed
- Best performance

**Cons:**
- Requires code changes
- Need to maintain both models

---

## Performance Monitoring

### Monitor RAM Usage

```bash
# Check Ollama memory usage
ps aux | grep ollama

# Watch in real-time
watch -n 1 'ps aux | grep ollama | grep -v grep'

# M4-specific memory stats
sudo powermetrics --samplers smc -i1 -n1 | grep -i memory
```

### Monitor Speed

```bash
# Time a generation
time curl -X POST http://localhost:11434/api/generate \
  -d '{
    "model": "llama3.1:8b-32k",
    "prompt": "Explain quantum computing in detail",
    "stream": false
  }' | jq -r '.response'
```

### Compare 8K vs 32K

```bash
# Test 8K
time ollama run llama3.1:8b "Explain AI in 100 words"

# Test 32K
time ollama run llama3.1:8b-32k "Explain AI in 100 words"

# Compare times
```

---

## Recommendations for M4 Mac Mini

### If You Have 16GB RAM:

✅ **Safe to use 32K** for:
- Long conversations
- Multi-document analysis
- Complex queries

✅ **Keep 8K** for:
- Simple queries
- Fast responses
- General chat

**Best approach:** Hybrid (both models)

---

### If You Have 32GB+ RAM:

✅ **Can use 32K by default**
- Plenty of RAM
- Performance hit acceptable
- Simplifies setup

✅ **Or go even bigger:**
- Consider 64K context if needed
- Test performance first

---

### If You Have 8GB RAM:

⚠️ **Stick with 8K**
- 32K may cause swapping
- Slower performance
- Risk of OOM errors

⚠️ **Or use 16K as compromise:**
```bash
# Create 16K variant
ollama show llama3.1:8b --modelfile > /tmp/modelfile
echo "PARAMETER num_ctx 16384" >> /tmp/modelfile
ollama create llama3.1:8b-16k -f /tmp/modelfile
```

---

## Decision Matrix

| Your RAM | Recommended | Max Safe | Performance |
|----------|-------------|----------|-------------|
| 8GB | 8K | 16K | Fast |
| 16GB | 8K + 32K hybrid | 32K | Good |
| 32GB | 32K default | 64K | Excellent |
| 64GB+ | 64K | 128K | Excellent |

---

## Quick Start Guide

### Step 1: Check Your RAM

```bash
sysctl hw.memsize | awk '{print $2/1024/1024/1024 " GB"}'
```

### Step 2: Decide Context Size

- **< 16GB RAM:** Stick with 8K (or try 16K)
- **16GB RAM:** Hybrid approach (8K + 32K)
- **32GB+ RAM:** Go to 32K

### Step 3: Run Expansion

```bash
# For 32K
./scripts/expand-context-window.sh

# Or for 16K (edit script first)
# Change: PARAMETER num_ctx 16384
```

### Step 4: Test Performance

```bash
# Quick test
ollama run llama3.1:8b-32k "Tell me a joke"

# Long context test
ollama run llama3.1:8b-32k "$(cat large-document.txt) \n\nSummarize this"
```

### Step 5: Monitor

```bash
# Watch RAM
watch -n 1 'ps aux | grep ollama'

# Check speed
# Compare response times between 8K and 32K
```

---

## Summary

**What is 32K expansion?**
- Configuration parameter change
- Same model, bigger context buffer
- Creates new model variant

**Performance Impact on M4:**
- **RAM:** +2GB for KV cache (~10GB total)
- **Speed:** 25-35% slower (~20 tok/s vs 30 tok/s)
- **Quality:** Same (no degradation)

**When to use:**
- Long conversations (15+ messages)
- Multi-document analysis
- Complex synthesis tasks

**Recommendation:**
- **Keep both 8K and 32K**
- Route intelligently
- Fast when possible, large when needed

**Next step:**
Run the expansion script and test:
```bash
./scripts/expand-context-window.sh
```

The slowdown is worth it for the capability gain!
