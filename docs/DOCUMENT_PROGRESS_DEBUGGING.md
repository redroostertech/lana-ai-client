# Document Progress Event Debugging Guide

## Overview
The document progress UI is working correctly, but events only show when:
1. You attach files to your message (using the # mention or file upload)
2. The Document Agent is triggered to analyze those files

## How to Test

### ✅ Correct Way (Will Show Progress):
1. Open chat.html
2. Open browser console (F12)
3. Upload a file OR use # to mention a document
4. Ask a question about that document
5. **Expected**: You'll see console logs like:
   ```
   [SSE] Document Progress: {stage: "metadata", progress: 0, message: "Loading..."}
   [SSE] Document Progress: {stage: "retrieval", progress: 30, message: "Searching..."}
   [SSE] Document Progress: {stage: "processing", progress: 60, message: "Analyzing..."}
   ```
6. **Expected UI**: A blue progress bar appears below the "thinking" indicator showing document analysis progress

### ❌ Wrong Way (No Progress):
1. Open chat.html
2. Ask a general question WITHOUT attaching files
3. **Result**: No document_progress events because Document Agent isn't triggered
4. **This is expected behavior** - document progress only shows for document-related queries

## Event Flow

```
User attaches file + asks question
    ↓
Backend: Routing decides to use Document Agent (streaming.routes.js:2971-3025)
    ↓
Backend: Document Agent runs (document-agent.js)
    ↓
Backend: Emits document_progress events (lines 71, 99, 111, 142, 189, etc.)
    ↓
Backend: SSE forwards events via trackedSendSSE (streaming.routes.js:2878-2901)
    ↓
Frontend: SSE handler receives document_progress (chat.html:2818-2830)
    ↓
Frontend: Calls showReasoning() with progress data (chat.html:3533-3620)
    ↓
Frontend: UI shows progress bar in reasoning panel
```

## Verification Checklist

### Backend (Server Console):
- [ ] Server logs show `[Smart Routing] Using Document Agent`
- [ ] Document Agent emits progress events (look for `document_progress` in logs)

### Frontend (Browser Console):
- [ ] Console shows `[SSE] Document Progress:` logs
- [ ] Console shows `[showReasoning] Displaying reasoning in:` logs

### UI (Visual):
- [ ] Blue progress bar appears in the activity panel
- [ ] Progress bar updates from 0% → 25% → 30% → 50% → 60% → 95% → 100%
- [ ] Stage changes: metadata → retrieval → processing → synthesis → complete

## Common Issues

### Issue 1: No Progress Bar Shown
**Symptom**: Asking questions about documents but no progress bar appears
**Cause**: Document Agent not being triggered
**Fix**: 
1. Make sure you're attaching files using # mentions or file upload
2. Check browser console for "[Smart Routing] No attachments" log
3. If you see that log, the Document Agent won't run

### Issue 2: Progress Bar Stuck
**Symptom**: Progress bar appears but never completes
**Cause**: Backend error or connection issue
**Fix**:
1. Check server console for errors
2. Check browser console for SSE connection errors
3. Hard refresh (Cmd+Shift+R / Ctrl+Shift+R)

### Issue 3: Console Shows Events But No UI
**Symptom**: `[SSE] Document Progress` logs appear but no progress bar
**Cause**: HTML panels missing or JavaScript error
**Fix**:
1. Check for JavaScript errors in console
2. Verify `activity-reasoning-panel` and `streaming-reasoning-panel` divs exist in DOM
3. Hard refresh browser

## Testing Command

To quickly test if document progress is working:

1. **Attach a document** (use # or upload)
2. **Ask**: "What is this document about?"
3. **Watch**: 
   - Browser console for progress logs
   - UI for blue progress bar
   - Server logs for Document Agent execution

## Files Involved

### Frontend:
- `public_html/chat.html` (lines 2818-2830, 3533-3620)
  - Receives document_progress events
  - Shows progress bar in reasoning panel

### Backend:
- `src/shared/agents/document-agent.js` (lines 71, 99, 111, 142, 189, etc.)
  - Emits document_progress events at each stage
  
- `src/services/processor/routes/streaming.routes.js` (lines 2971-3025)
  - Routes to Document Agent when files attached
  - Forwards all events via trackedSendSSE

## Conclusion

The document progress system is **working as designed**. It only shows progress when:
1. Files are attached to the message
2. The Document Agent is processing those files

If you're not seeing progress bars, verify you're testing with file attachments!
