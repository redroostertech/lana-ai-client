# Deployment Checklist: Smart RAG + Performance Optimizations

**Date:** December 16, 2024
**Status:** Ready to Deploy
**Estimated Time:** 15-20 minutes

---

## 🎯 What We've Built (Code Complete)

✅ **Smart RAG Controller** - Intelligent retrieval decisions
✅ **Model Router** - Automatic vision/text model selection
✅ **32K Context Window** - 4x larger context (deployment integration ready)
✅ **Phase 1 Optimizations** - Critical performance fixes
✅ **Phase 2 Optimizations** - High-impact improvements

**All code is committed and ready. Now we need to deploy it.**

---

## 📋 DEPLOYMENT STEPS

### Step 1: Apply Database Migration (5 minutes)

The performance indexes migration needs to be run:

```bash
# Navigate to project
cd /Users/redroostertechnologies/Desktop/LANA-AI

# Apply migration
PGPASSWORD="" psql -U redroostertechnologies -h localhost -d lana_chef \
  -f src/migrations/20241216_performance_optimization_indexes.sql

# Verify indexes were created
PGPASSWORD="" psql -U redroostertechnologies -h localhost -d lana_chef -c "
  SELECT schemaname, tablename, COUNT(*) as index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('documents', 'conversations', 'document_chunks')
  GROUP BY schemaname, tablename
  ORDER BY tablename;
"
```

**Expected output:** Should show multiple indexes per table (documents: 7+, conversations: 4+, document_chunks: 4+)

---

### Step 2: Create 32K Context Model (5 minutes)

Run the context expansion script to create the llama3.1:8b-32k variant:

```bash
# Make script executable (if not already)
chmod +x scripts/expand-context-window.sh

# Run expansion
./scripts/expand-context-window.sh

# Verify 32K model exists
ollama list | grep llama3.1
```

**Expected output:**
```
llama3.1:8b-32k     [ID]    4.9 GB    [timestamp]
```

**Note:** The original `llama3.1:8b` will remain until you run `deploy-prod-mac.sh`, which will replace it with only the 32K variant.

---

### Step 3: Restart Application (2 minutes)

Restart to load all new optimizations:

```bash
# Restart PM2 process
pm2 restart lana-ai

# Watch logs for startup
pm2 logs lana-ai --lines 50
```

**What to look for in logs:**
- ✅ `Connection pool created` with `maxConnections: 50`
- ✅ `Context cache initialized`
- ✅ `Query cache initialized`
- ✅ No errors during startup

---

### Step 4: Verify Performance Improvements (3 minutes)

Test that optimizations are working:

```bash
# 1. Check PostgreSQL connection pool
PGPASSWORD="" psql -U redroostertechnologies -h localhost -d lana_chef -c "
  SELECT count(*) as active_connections, state
  FROM pg_stat_activity
  WHERE datname = 'lana_chef'
  GROUP BY state;
"

# 2. Check index usage (wait a few minutes after queries run)
PGPASSWORD="" psql -U redroostertechnologies -h localhost -d lana_chef -c "
  SELECT schemaname, tablename, indexname, idx_scan
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
    AND tablename = 'documents'
  ORDER BY idx_scan DESC
  LIMIT 10;
"

# 3. Monitor response times via logs
pm2 logs lana-ai | grep "duration"
```

---

## 🧪 TESTING PLAN

### Test 1: Smart RAG with Conversational Queries

**Purpose:** Verify Smart RAG Controller intelligently decides when to retrieve

**Test Cases:**

```bash
# Test A: Conversational query (should SKIP RAG)
curl -k -X POST https://localhost:8080/api/v1/streaming/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "Hello, how are you?",
    "conversation_id": "test-conv-1"
  }'
# Expected: No RAG retrieval, fast response

# Test B: Document query (should USE RAG)
curl -k -X POST https://localhost:8080/api/v1/streaming/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "What does the Revenue Blueprint document say about app monetization?",
    "matter_id": "MATT-00001",
    "conversation_id": "test-conv-2"
  }'
# Expected: RAG retrieval occurs, citations provided

# Test C: Specific document reference (should USE RAG)
curl -k -X POST https://localhost:8080/api/v1/streaming/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "Summarize the Leadli CRM discussion",
    "matter_id": "MATT-00001",
    "conversation_id": "test-conv-3"
  }'
# Expected: RAG retrieval, document content in response
```

**What to check in logs:**
- Look for: `Smart RAG decision` with `should: true/false`
- Look for: `reason: "conversational"` (skipped) or `reason: "document_query"` (performed)

---

### Test 2: Model Router with Vision Queries

**Purpose:** Verify intelligent model routing to vision models

**Test Cases:**

```bash
# Test A: Text-only query (should route to llama3.1:8b-32k)
curl -k -X POST https://localhost:8080/api/v1/streaming/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "Explain quantum computing",
    "conversation_id": "test-model-1"
  }'
# Expected: model = llama3.1:8b-32k

# Test B: Image analysis query (should route to qwen3-vl or llava:7b)
# Note: This requires actually uploading an image
# Check frontend at https://localhost:8080/chat.html
# Upload an image and ask "What's in this image?"
# Expected: model = qwen3-vl (primary vision model)
```

**What to check in logs:**
- Look for: `Model routing decision`
- Look for: `selectedModel: llama3.1:8b-32k` (text) or `qwen3-vl` (vision)
- Look for: `reasoning` explaining why that model was chosen

---

### Test 3: 32K Context Window

**Purpose:** Verify expanded context window handles long conversations

**Test Case:**

```bash
# Use the ollama-test-request.json file (already configured for 32K)
curl -X POST http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d @ollama-test-request.json

# Or test with very long conversation history
# Create a conversation with 20+ messages, then send another message
# Should not get "context overflow" errors
```

**What to check:**
- No "context window exceeded" errors
- Response includes full conversation history
- Model parameter `num_ctx: 32768` in logs

---

### Test 4: Performance Benchmarks

**Purpose:** Verify 40-60% improvement in response times

**Baseline Test (before optimizations):**
```bash
# Run this first to establish baseline (if you didn't already)
time curl -k -X POST https://localhost:8080/api/v1/streaming/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "What matters do I have access to?",
    "conversation_id": "test-perf-1"
  }'
```

**After Optimizations:**
```bash
# Same query, should be 40-60% faster
time curl -k -X POST https://localhost:8080/api/v1/streaming/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "What matters do I have access to?",
    "conversation_id": "test-perf-2"
  }'
```

**Expected Improvement:**
- Before: ~800ms - 1200ms
- After: ~300ms - 500ms
- **Target: 40-60% faster**

---

## 🔍 MONITORING CHECKLIST

After deployment, monitor these for 24-48 hours:

### Database Performance

```bash
# Run every hour
PGPASSWORD="" psql -U redroostertechnologies -h localhost -d lana_chef -c "
  SELECT
    count(*) FILTER (WHERE state = 'active') as active,
    count(*) FILTER (WHERE state = 'idle') as idle,
    count(*) as total
  FROM pg_stat_activity
  WHERE datname = 'lana_chef';
"
```

**Healthy State:**
- Active: 2-10 (during usage)
- Idle: 10-40 (warm pool)
- Total: < 50 (under max)

---

### Cache Hit Rates

```bash
# Check application logs
pm2 logs lana-ai | grep "Cache hit" | wc -l
pm2 logs lana-ai | grep "Cache miss" | wc -l

# Calculate hit rate
# Hit rate should be >70% after 1 hour of usage
```

---

### Slow Query Detection

```bash
# Monitor for slow queries
pm2 logs lana-ai | grep "Slow query detected"

# Should be rare (<1% of queries)
```

---

### Memory Usage

```bash
# Check Node.js memory usage
ps aux | grep node | grep lana

# Expected: 1.8-2.0 GB (down from 2.5 GB before)
```

---

## ⚠️ ROLLBACK PLAN (If Issues Occur)

If you encounter problems:

### 1. Rollback Code Changes

```bash
git stash
pm2 restart lana-ai
```

### 2. Rollback Database Migration

```bash
# Drop performance indexes
PGPASSWORD="" psql -U redroostertechnologies -h localhost -d lana_chef -c "
  DROP INDEX IF EXISTS idx_documents_org_matter_status;
  DROP INDEX IF EXISTS idx_documents_filename_trgm;
  DROP INDEX IF EXISTS idx_documents_checksum;
  -- ... (drop all indexes from migration)
"
```

### 3. Revert to 8K Model

```bash
ollama pull llama3.1:8b
ollama rm llama3.1:8b-32k
```

---

## ✅ SUCCESS CRITERIA

Deployment is successful when:

- ✅ Database migration applied without errors
- ✅ 32K model created and verified
- ✅ Application restarted successfully
- ✅ No errors in PM2 logs
- ✅ Smart RAG working (conversational queries skip RAG)
- ✅ Model Router working (vision queries route to vision models)
- ✅ API response times 40-60% faster
- ✅ Cache hit rates >70% after warmup
- ✅ No slow queries (>100ms) in hot paths
- ✅ Memory usage reduced to ~2GB

---

## 📊 PERFORMANCE TARGETS

| Metric | Before | Target | How to Measure |
|--------|--------|--------|----------------|
| API Response Time | 800ms | 300-400ms | `time curl ...` |
| Database Connections | 20 max | 50 max | `pg_stat_activity` |
| Cache Hit Rate | 0% | >70% | Application logs |
| Memory Usage | 2.5GB | ~2GB | `ps aux \| grep node` |
| Network Payload | 100% | 35% | Browser DevTools |
| Slow Queries | Many | <1% | Logs: "Slow query" |

---

## 🎯 NEXT STEPS AFTER DEPLOYMENT

Once deployed and verified:

1. **Run for 24-48 hours** to collect performance data
2. **Review metrics** against targets above
3. **Gather user feedback** on perceived performance
4. **Consider Phase 3 optimizations** if additional gains needed

**Phase 3 Options (Future):**
- API request batching (60-70% faster page loads)
- Prepared statements (10-20% faster queries)
- Document processor concurrency (3x throughput)
- MinIO connection pooling (20-30% faster uploads)

---

## 📞 SUPPORT

If you encounter issues:

1. Check logs: `pm2 logs lana-ai --lines 100`
2. Check database: `PGPASSWORD="" psql -U redroostertechnologies -h localhost -d lana_chef`
3. Review this checklist
4. Use rollback plan if needed

**You're ready to deploy!** 🚀
